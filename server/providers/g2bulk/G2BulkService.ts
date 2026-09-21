import { v4 as uuidv4 } from 'uuid';
import { G2BulkClient } from './G2BulkClient';
import { G2BulkProduct } from '../../models/G2BulkProduct';
import { Order } from '../../models/Order';
import { User } from '../../models/User';
import mongoose from 'mongoose';

export class G2BulkService {
  private client: G2BulkClient;
  private telegramNotifier?: (chatId: number, msg: string) => void;
  private webhookBaseUrl: string;

  constructor(client: G2BulkClient, webhookBaseUrl: string = process.env.BASE_URL || '') {
    this.client = client;
    this.webhookBaseUrl = webhookBaseUrl;
  }

  public setTelegramNotifier(notifier: (chatId: number | string, msg: string) => void) {
    this.telegramNotifier = notifier;
  }

  public setTelegram(telegram: any, adminChatId?: string) {
    this.telegramNotifier = async (chatId: number | string, message: string) => {
      try {
        if (telegram && telegram.sendMessage) {
          await telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
      } catch (err) {
        console.error(`[G2Bulk Notification Error to ${chatId}]:`, err);
      }
    };
  }

  public getClient() {
    return this.client;
  }

  
  public async pollActiveOrders(): Promise<void> {
    if (!this.client.isConfigured()) return;
    if (mongoose.connection.readyState !== 1) return;

    try {
      const activeOrders = await Order.find({
        provider: 'g2bulk',
        state: { $in: [0, 1] }
      }).sort({ createdAt: -1 }).limit(20);

      for (const order of activeOrders) {
        if (!order.providerOrderId) continue;
        try {
          const liveOrder = await this.client.getOrder(order.providerOrderId);
          // TODO: confirm the exact status field name/values G2Bulk's /orders endpoint
          // returns (check the reseller API docs) before trusting this mapping in production.
          const liveStatus = String(liveOrder?.status || '').toUpperCase();
          if (!liveStatus) continue;

          let newState = order.state;
          if (liveStatus === 'COMPLETED' || liveStatus === 'SUCCESS') newState = 2;
          else if (liveStatus === 'FAILED' || liveStatus === 'REFUNDED' || liveStatus === 'CANCELLED') newState = 3;

          if (newState !== order.state) {
            await Order.findOneAndUpdate(
              { _id: order._id, state: { $ne: newState } },
              { $set: { state: newState, statusText: liveStatus } }
            );
            if (newState === 3) {
              const user = await User.findOne({ telegramChatId: order.telegramChatId });
              if (user) {
                user.balance += (order.price || 0);
                await user.save();
              }
            }
          }
        } catch (err) {
          console.error(`[G2Bulk Poller] Failed to check order ${order.providerOrderId}:`, err);
        }
      }
    } catch (err) {
      console.error('[G2Bulk Poller] Error:', err);
    }
  }

  public async syncCatalog() {
    if (!this.client.getStatus().isConfigured) return;
    
    const liveProducts = await this.client.getProducts();
    const ops = liveProducts.map(lp => ({
      updateOne: {
        filter: { productId: lp.productId },
        update: { $set: { ...lp, lastSyncedAt: new Date() } },
        upsert: true
      }
    }));

    if (ops.length > 0) {
      await G2BulkProduct.bulkWrite(ops);
    }
  }


  public async getProducts(): Promise<any[]> {
    let items = await G2BulkProduct.find().sort({ name: 1 });
    if (items.length === 0 && this.client.isConfigured()) {
      try {
        await this.syncCatalog();
        items = await G2BulkProduct.find().sort({ name: 1 });
      } catch (e) {
        console.warn('Auto-sync G2Bulk products on getProducts failed:', e);
      }
    }
    return items;
  }

  public async syncProducts(): Promise<{ total: number; synced: number }> {
    const liveProducts = await this.client.getProducts();
    await this.syncCatalog();
    return { total: liveProducts.length, synced: liveProducts.length };
  }

  public async updateProductShortKey(productId: string, shortKey: string): Promise<any> {
    const cleanKey = shortKey.trim().toLowerCase().replace(/^\./, '');
    return G2BulkProduct.findOneAndUpdate(
      { productId },
      { shortKey: cleanKey },
      { returnDocument: 'after' }
    );
  }

  public async toggleProductEnabled(productId: string, isEnabled?: boolean): Promise<any> {
    const product = await G2BulkProduct.findOne({ productId });
    if (!product) return null;
    const newEnabled = isEnabled !== undefined ? Boolean(isEnabled) : !product.isEnabled;
    product.isEnabled = newEnabled;
    product.status = newEnabled ? 'ACTIVE' : 'DISABLED';
    return await product.save();
  }

  public async bulkToggleProductsEnabled(productIds: string[], isEnabled: boolean): Promise<any> {
    return G2BulkProduct.updateMany(
      { productId: { $in: productIds } },
      { $set: { isEnabled, status: isEnabled ? 'ACTIVE' : 'DISABLED' } }
    );
  }

  public async getCatalog() {
    return G2BulkProduct.find({ isEnabled: { $ne: false } }).sort({ name: 1 });
  }

  public async placeOrder(
    userAccount: string, 
    userId: string, 
    productId: string, 
    skuId: string, 
    fields: any, 
    telegramChatId?: number
  ) {
    if (!this.client.getStatus().isConfigured) {
      return { success: false, error: 'G2Bulk API is not configured' };
    }

    let deductedCost = 0;
    try {
      const product = await G2BulkProduct.findOne({ productId });
      if (!product) throw new Error('Product not found in database');

      const skuObj = product.skus.find(s => s.sku === skuId);
      if (!skuObj) throw new Error('SKU not found');

      const user = await User.findById(userId);
      if (!user) throw new Error('User not found');

      const totalCost = Number(skuObj.price) || 0;
      deductedCost = totalCost;

      // Atomic balance deduction
      const deductedUser = await User.findOneAndUpdate(
        { _id: userId, balance: { $gte: totalCost } },
        { $inc: { balance: -totalCost } },
        { returnDocument: 'after' }
      );
      if (!deductedUser) {
        throw new Error(`Insufficient wallet balance. Need $${totalCost.toFixed(3)} USD, have $${user.balance.toFixed(3)} USD.`);
      }

      const callbackUrl = this.webhookBaseUrl ? `${this.webhookBaseUrl.replace(/\/+$/, '')}/api/webhooks/g2bulk` : undefined;

      const orderData = await this.client.placeOrder(productId, skuId, fields, callbackUrl);

      let providerOrderId = '';
      let internalState = 1; // 1 = Processing — matches the Order.state convention shared by every provider
      let statusText = 'PENDING';

      if (orderData.success && orderData.order) {
        providerOrderId = String(orderData.order.order_id || orderData.order.id);
        statusText = orderData.order.status || 'PROCESSING';
        internalState = (statusText === 'COMPLETED' || statusText === 'SUCCESS') ? 2 : 1;
      } else if (orderData.success === false) {
        throw new Error(orderData.message || 'API rejected the order');
      }

      const referenceId = uuidv4().replace(/-/g, '').substring(0, 32);

      const newOrder = await Order.create({
        referenceId,
        orderId: providerOrderId || referenceId,
        provider: 'g2bulk',
        providerOrderId,
        gameId: productId,
        gameName: product.name,
        skuId: skuId,
        skuName: skuObj.name,
        playerName: userAccount,
        telegramChatId: telegramChatId || user.telegramChatId,
        price: totalCost,
        extraInfo: { ...fields, provider: 'g2bulk' },
        state: internalState,
        statusText
      });

      if (this.telegramNotifier && telegramChatId) {
        const msg = internalState === 2
          ? `🎉 *G2Bulk Top-up Succeeded!*\n\n🎮 *Game:* ${product.name}\n💎 *Package:* ${skuObj.name}\n👤 *Account:* \`${userAccount}\`\n💰 *Total:* $${totalCost.toFixed(3)} USD\n🧾 *Order ID:* \`${providerOrderId}\``
          : `⏳ *G2Bulk Top-up Submitted!*\n\n🎮 *Game:* ${product.name}\n💎 *Package:* ${skuObj.name}\n👤 *Account:* \`${userAccount}\`\n💰 *Total:* $${totalCost.toFixed(3)} USD\n🧾 *Order ID:* \`${providerOrderId}\`\nStatus: Processing...`;
        this.telegramNotifier(telegramChatId, msg);
      }

      return { success: true, order: newOrder };

    } catch (err: any) {
      if (deductedCost > 0) {
        await User.updateOne({ _id: userId }, { $inc: { balance: deductedCost } }).catch(() => {});
      }

      if (this.telegramNotifier && telegramChatId) {
        this.telegramNotifier(telegramChatId, `❌ *G2Bulk Order Failed*\n\n⚠️ *Reason:* ${err.message}`);
      }

      return { success: false, error: err.message };
    }
  }

  public async handleWebhook(payload: any) {
    if (!payload || !payload.order_id) return;
    
    const orderId = String(payload.order_id);
    const status = (payload.status || '').toUpperCase();
    
    const order = await Order.findOne({ provider: 'g2bulk', providerOrderId: orderId });
    if (!order) return;
    
    if (order.state === 2 || order.state === 3) return; // already completed or failed — ignore duplicate webhooks

    if (status === 'COMPLETED' || status === 'SUCCESS') {
      order.state = 2;
      order.statusText = 'Completed via Webhook';
      await order.save();
      
      if (this.telegramNotifier && order.telegramChatId) {
        this.telegramNotifier(order.telegramChatId, `✅ *G2Bulk Order Completed!*\n\n🧾 *Order ID:* \`${orderId}\`\n💎 *Package:* ${order.skuName}`);
      }
    } else if (status === 'FAILED' || status === 'REFUNDED' || status === 'CANCELED' || status === 'CANCELLED') {
      order.state = 3;
      order.statusText = 'Failed/Refunded via Webhook';
      await order.save();

      // Refund
      const user = await User.findOne({ telegramChatId: order.telegramChatId });
      if (user) {
        user.balance += (order.price || 0);
        await user.save();
        if (this.telegramNotifier && order.telegramChatId) {
          this.telegramNotifier(order.telegramChatId, `❌ *G2Bulk Order Failed*\n\n🧾 *Order ID:* \`${orderId}\`\n💰 *Refunded:* $${Number(order.price || 0).toFixed(3)} USD`);
        }
      }
    }
  }
}
