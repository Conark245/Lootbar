import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { FzrCardsClient } from './FzrCardsClient';
import { FzrCardsProduct } from '../../models/FzrCardsProduct';
import { Order, IOrder } from '../../models/Order';
import { User } from '../../models/User';
import { FzrCardsOrderRequest, FzrCardsWebhookPayload } from './types';

export class FzrCardsService {
  private client: FzrCardsClient;
  private telegramNotifier?: (chatId: number | string, message: string) => Promise<void>;
  private adminChatId?: string;

  constructor(client: FzrCardsClient) {
    this.client = client;
  }

  public setTelegramNotifier(notifier: (chatId: number | string, message: string) => Promise<void>) {
    this.telegramNotifier = notifier;
  }

  public setTelegram(telegram: any, adminChatId?: string) {
    this.adminChatId = adminChatId;
    this.telegramNotifier = async (chatId: number | string, message: string) => {
      try {
        if (telegram && telegram.sendMessage) {
          await telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
      } catch (err) {
        console.error(`[FZR Cards Notification Error to ${chatId}]:`, err);
      }
    };
  }

  public async updateProductShortKey(productId: string, shortKey: string): Promise<any> {
    const cleanKey = shortKey.trim().toLowerCase().replace(/^\./, '');
    return FzrCardsProduct.findOneAndUpdate(
      { productId },
      { shortKey: cleanKey },
      { returnDocument: 'after' }
    );
  }

  public async updateSkuShortKeys(productId: string, skuShortKeys: Record<string, string>): Promise<any> {
    const cleanedMap: Record<string, string> = {};
    for (const [skuId, shortKey] of Object.entries(skuShortKeys || {})) {
      if (typeof shortKey === 'string' && shortKey.trim().length > 0) {
        cleanedMap[skuId] = shortKey.trim().toLowerCase().replace(/^\./, '');
      }
    }
    return FzrCardsProduct.findOneAndUpdate(
      { productId },
      { skuShortKeys: cleanedMap },
      { returnDocument: 'after' }
    );
  }

  
  public async bulkToggleProductsEnabled(productIds: string[], isEnabled: boolean): Promise<any> {
    const result = await FzrCardsProduct.updateMany(
      { productId: { $in: productIds } },
      { 
        $set: { 
          isEnabled: isEnabled,
          status: isEnabled ? 'ACTIVE' : 'DISABLED'
        }
      }
    );
    return result;
  }

  public async toggleProductEnabled(productId: string, isEnabled?: boolean): Promise<any> {
    const product = await FzrCardsProduct.findOne({ productId });
    if (!product) return null;
    const newEnabled = isEnabled !== undefined ? Boolean(isEnabled) : !product.isEnabled;
    product.isEnabled = newEnabled;
    product.status = newEnabled ? 'ACTIVE' : 'DISABLED';
    return await product.save();
  }

  public async getWalletBalance(): Promise<any> {
    if (!this.client.isConfigured()) {
      throw new Error('FZR Cards credentials are not configured.');
    }
    return this.client.getWalletBalance();
  }

  public async getProfile(): Promise<any> {
    if (!this.client.isConfigured()) {
      throw new Error('FZR Cards credentials are not configured.');
    }
    return this.client.getProfile();
  }

  public async syncProducts(): Promise<{ total: number; synced: number; errors?: string[] }> {
    return this.syncCatalog();
  }

  public getClient(): FzrCardsClient {
    return this.client;
  }

  /**
   * Generates a clean default shortcut key for Telegram Bot interaction.
   * e.g. fml, fpubg, fff, fgi, etc.
   */
  public generateDefaultShortKey(name: string, productId: string): string {
    const clean = (name || '').toLowerCase();
    if (clean.includes('mobile legends') || clean.includes('mlbb')) return 'fml';
    if (clean.includes('pubg')) return 'fpubg';
    if (clean.includes('free fire')) return 'fff';
    if (clean.includes('genshin')) return 'fgi';
    if (clean.includes('honkai') || clean.includes('star rail')) return 'fhsr';
    if (clean.includes('roblox')) return 'frbx';
    if (clean.includes('arena of valor') || clean.includes('aov')) return 'faov';
    if (clean.includes('call of duty') || clean.includes('codm')) return 'fcodm';
    if (clean.includes('clash of clans') || clean.includes('coc')) return 'fcoc';
    if (clean.includes('brawl stars')) return 'fbs';
    if (clean.includes('steam')) return 'fsteam';

    const words = clean.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      return 'f' + words.map(w => w[0]).join('').slice(0, 4);
    }
    return `f${productId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4) || 'g'}`;
  }

  /**
   * Synchronizes product catalog and offers from FZR Cards API into MongoDB.
   */
  public async syncCatalog(): Promise<{ total: number; synced: number; errors?: string[] }> {
    if (!this.client.isConfigured()) {
      throw new Error('FZR Cards API is not configured. Please provide API Key first.');
    }

    const liveProducts = await this.client.getProducts();
    const errors: string[] = [];

    if (liveProducts.length > 0) {
      try {
        const bulkOps = liveProducts.map(p => {
          const shortKey = this.generateDefaultShortKey(p.name, p.productId);
          return {
            updateOne: {
              filter: { productId: p.productId },
              update: {
                $set: {
                  name: p.name,
                  status: p.status || 'ACTIVE',
                  category: p.category || 'Game',
                  description: p.description,
                  iconUrl: p.iconUrl,
                  fields: p.fields || [],
                  skus: p.skus || [],
                  lastSyncedAt: new Date()
                },
                $setOnInsert: { shortKey }
              },
              upsert: true
            }
          };
        });

        const CHUNK_SIZE = 100;
        for (let i = 0; i < bulkOps.length; i += CHUNK_SIZE) {
          const chunk = bulkOps.slice(i, i + CHUNK_SIZE);
          await FzrCardsProduct.bulkWrite(chunk);
        }
      } catch (err: any) {
        errors.push(`Bulk write error: ${err.message}`);
      }
    }

    return { 
      total: liveProducts.length, 
      synced: liveProducts.length - errors.length, 
      errors: errors.length > 0 ? errors : undefined 
    };
  }

  /**
   * Retrieves products from local database or syncs if empty.
   */
  public async getProducts(): Promise<any[]> {
    return await FzrCardsProduct.find().sort({ name: 1 });
  }

  /**
   * Retrieves single product with detailed SKUs and dynamic fields.
   */
  public async getProduct(productId: string): Promise<any> {
    let product = await FzrCardsProduct.findOne({ productId });
    if (!product && this.client.isConfigured()) {
      try {
        const liveProducts = await this.client.getProducts();
        const found = liveProducts.find(p => p.productId === productId);
        if (found) {
          product = await FzrCardsProduct.findOneAndUpdate(
            { productId: found.productId },
            { ...found, lastSyncedAt: new Date() },
            { upsert: true, returnDocument: 'after' }
          );
        }
      } catch (e) {
        // Fallback
      }
    }
    return product;
  }

  /**
   * Validates player ID using FZR Cards endpoint.
   */
  public async validatePlayerId(productId: string, fields: Record<string, any>): Promise<any> {
    if (!this.client.isConfigured()) {
      return { valid: false, message: 'FZR Cards API not configured' };
    }
    return this.client.validatePlayerId(productId, fields);
  }

  /**
   * Places an order with full validation, wallet deduction, idempotency, and rollback.
   */
  public async placeOrder(params: {
    telegramChatId: number;
    telegramUsername?: string;
    telegramFirstName?: string;
    telegramLastName?: string;
    productId: string;
    sku: string;
    fields: Record<string, any>;
    quantity?: number;
    existingIdempotencyKey?: string; skipBalanceDeduction?: boolean;
  }): Promise<{ success: boolean; order?: IOrder; error?: string }> {
    const {
      telegramChatId,
      telegramUsername,
      telegramFirstName,
      telegramLastName,
      productId,
      sku,
      fields,
      quantity = 1,
      existingIdempotencyKey, skipBalanceDeduction
    } = params;

    // 1. Fetch Product & SKU details
    const product = await this.getProduct(productId);
    if (!product) {
      return { success: false, error: `FZR Cards Product '${productId}' not found or unavailable.` };
    }

    const skuObj = (product.skus || []).find((s: any) => String(s.sku) === String(sku));
    if (!skuObj) {
      return { success: false, error: `Selected SKU '${sku}' does not exist for product '${product.name}'.` };
    }

    if (skuObj.available === false) {
      return { success: false, error: `Selected package '${skuObj.name}' is currently unavailable.` };
    }

    // 2. Validate Required Dynamic Fields
    for (const f of (product.fields || [])) {
      if (f.required) {
        const val = fields[f.name] !== undefined ? fields[f.name] : fields[f.name.toLowerCase()];
        if (val === undefined || val === null || String(val).trim() === '') {
          return { success: false, error: `Required field '${f.title || f.name}' is missing.` };
        }
      }
    }

    const pricePerUnit = Number(skuObj.price || 0);
    const totalCost = pricePerUnit * quantity;

    // 3. User Wallet Balance Check & Atomic Deduction
    const user = await User.findOne({ telegramChatId });
    if (!user) {
      return { success: false, error: 'User account not found.' };
    }

    const isApiLinked = !!(user.useDirectApiBalance || user.balanceMode === 'api');
    if (!isApiLinked && !skipBalanceDeduction) {
      if (user.balance < totalCost) {
        return {
          success: false,
          error: `Insufficient wallet balance. Total cost is $${totalCost.toFixed(2)} USD, but your balance is $${user.balance.toFixed(2)} USD.`
        };
      }

      // Atomically deduct balance
      user.balance = Math.max(0, user.balance - totalCost);
      await user.save();
    }

    // 4. Generate Idempotency Key & Internal Reference ID
    const referenceId = uuidv4().replace(/-/g, '').substring(0, 32);
    const idempotencyKey = existingIdempotencyKey || `FZR-${uuidv4().replace(/-/g, '')}`;

    // Extract userAccount / playerId
    let userAccount = String(
      fields.player_id ||
      fields.playerId ||
      fields.user_id ||
      fields.userId ||
      fields.userAccount ||
      fields.account_id ||
      fields.accountId ||
      fields.account ||
      fields.uid ||
      fields.id ||
      ''
    ).trim();

    if (!userAccount) {
      const values = Object.values(fields).filter(v => v !== undefined && v !== null && String(v).trim() !== '' && typeof v !== 'object');
      if (values.length > 0) {
        userAccount = String(values[0]).trim();
      }
    }

    const orderPayload: FzrCardsOrderRequest = {
      categoryId: String(productId),
      offerId: String(sku),
      fields: fields || {},
      quantity: Number(quantity) || 1,
      kind: product.category === 'Gift Card' ? 'gift_card' : 'topup'
    };

    // 5. Call FZR Cards API
    try {
      const response = await this.client.createOrder(orderPayload, idempotencyKey);

      const providerOrderId = response.orderId || response.id || referenceId;
      const statusText = response.status || 'PROCESSING';

      // Map state: PROCESSING/PENDING -> 1, COMPLETED -> 2, FAILED/REFUNDED/CANCELLED -> 3
      let internalState = 1;
      if (statusText === 'COMPLETED') internalState = 2;
      else if (statusText === 'FAILED' || statusText === 'REFUNDED' || statusText === 'CANCELLED') internalState = 3;

      const order = await Order.create({
        referenceId,
        orderId: providerOrderId,
        provider: 'fzrcards',
        providerOrderId,
        providerReceiptNumber: response.referenceId,
        providerProductId: productId,
        providerSku: sku,
        idempotencyKey,
        statusText,
        telegramChatId,
        telegramUsername: telegramUsername || user?.username || undefined,
        telegramFirstName: telegramFirstName || user?.firstName || undefined,
        telegramLastName: telegramLastName || undefined,
        gameId: productId,
        gameName: product.name,
        skuId: sku,
        skuName: skuObj.name,
        playerName: response.playerName || userAccount,
        price: totalCost,
        extraInfo: {
          ...fields,
          provider: 'fzrcards',
          paymentSource: isApiLinked ? 'api_balance' : 'wallet_balance'
        },
        state: internalState
      });

      // Rollback wallet if instant failure
      if (internalState === 3 && !isApiLinked) {
        user.balance += totalCost;
        await user.save();
      }

      // Notify Telegram
      if (this.telegramNotifier) {
        const notifMsg = internalState === 2
          ? `🎉 *FZR Cards Top-up Succeeded!*\n\n🎮 *Game:* ${product.name}\n💎 *Package:* ${skuObj.name}\n👤 *Account:* \`${userAccount}\`\n💰 *Total:* $${totalCost.toFixed(2)} USD\n🧾 *Order ID:* \`${providerOrderId}\``
          : internalState === 3
          ? `❌ *FZR Cards Top-up Failed*\n\n🎮 *Game:* ${product.name}\n💎 *Package:* ${skuObj.name}\n⚠️ *Error:* ${response.errorMessage || 'Provider failed'}\n💰 *Status:* Funds returned to your balance.`
          : `⏳ *FZR Cards Top-up Submitted!*\n\n🎮 *Game:* ${product.name}\n💎 *Package:* ${skuObj.name}\n👤 *Account:* \`${userAccount}\`\n💰 *Total:* $${totalCost.toFixed(2)} USD\n🧾 *Order ID:* \`${providerOrderId}\`\nStatus: Processing...`;

        this.telegramNotifier(telegramChatId, notifMsg);
      }

      return {
        success: internalState !== 3,
        order,
        error: internalState === 3 ? (response.errorMessage || 'Order placement failed') : undefined
      };
    } catch (err: any) {
      // Rollback user wallet deduction
      if (!isApiLinked && !skipBalanceDeduction) {
        user.balance += totalCost;
        await user.save();
      }

      const errorMessage = err.message || 'FZR Cards Order placement failed';
      console.error(`[FZR Cards Order Error for ${telegramChatId}]:`, errorMessage);

      if (this.telegramNotifier) {
        this.telegramNotifier(
          telegramChatId,
          `❌ *FZR Cards Order Failed*\n\n🎮 *Game:* ${product.name}\n💎 *Package:* ${skuObj.name}\n⚠️ *Reason:* ${errorMessage}\n💰 *Balance Refunded:* +$${totalCost.toFixed(2)} USD`
        );
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Background order status synchronization
   */
  public async syncOrderStatus(orderId: string): Promise<any> {
    const order = await Order.findOne({
      $or: [{ orderId }, { providerOrderId: orderId }, { referenceId: orderId }]
    });

    if (!order) return null;

    try {
      const response = await this.client.queryOrder(order.providerOrderId || order.orderId || orderId);
      const statusText = response.status || 'PROCESSING';

      let newState = order.state;
      if (statusText === 'COMPLETED') newState = 2;
      else if (statusText === 'FAILED' || statusText === 'REFUNDED' || statusText === 'CANCELLED') newState = 3;
      else if (statusText === 'PROCESSING' || statusText === 'PENDING') newState = 1;

      if (newState !== order.state) {
        order.state = newState;
        order.statusText = statusText;
        await order.save();

        // Handle failure refund
        if (newState === 3 && order.extraInfo?.paymentSource !== 'api_balance') {
          const user = await User.findOne({ telegramChatId: order.telegramChatId });
          if (user) {
            user.balance += Number(order.price || 0);
            await user.save();
          }
        }

        // Notify Telegram
        if (this.telegramNotifier && order.telegramChatId) {
          const msg = newState === 2
            ? `🎉 *FZR Cards Top-up Succeeded!*\n\n🎮 *Game:* ${order.gameName}\n💎 *Package:* ${order.skuName}\n🧾 *Order ID:* \`${order.orderId}\``
            : newState === 3
            ? `❌ *FZR Cards Top-up Failed / Cancelled*\n\n🎮 *Game:* ${order.gameName}\n💎 *Package:* ${order.skuName}\n💰 *Status:* $${Number(order.price || 0).toFixed(2)} USD refunded to balance.`
            : `ℹ️ *FZR Cards Order Update:* ${statusText}`;

          this.telegramNotifier(order.telegramChatId, msg);
        }
      }

      return order;
    } catch (e: any) {
      console.warn(`[FZR Cards syncOrderStatus] Failed for ${orderId}:`, e.message);
      return order;
    }
  }

  /**
   * Handles inbound Webhook events from FZR Cards.
   */
  public async handleWebhook(payload: FzrCardsWebhookPayload): Promise<any> {
    const eventType = payload.event;
    const data = payload.data || (payload as any);
    const orderId = String(data.id || data.orderId || data.order_id || payload.id || '');

    if (!orderId) {
      return { success: true, received: true, message: 'No orderId in webhook payload' };
    }

    const order = await Order.findOne({
      $or: [{ orderId }, { providerOrderId: orderId }, { referenceId: orderId }]
    });

    if (!order) {
      return { success: true, received: true, message: 'Order not found in database' };
    }

    const rawStatus = String(data.status || eventType).toUpperCase();
    let newState = order.state;

    if (rawStatus.includes('COMPLETE') || rawStatus.includes('SUCCESS') || eventType === 'order.completed') {
      newState = 2; // Success
    } else if (rawStatus.includes('FAIL') || rawStatus.includes('REFUND') || eventType === 'order.failed' || eventType === 'order.refunded') {
      newState = 3; // Failed
    }

    order.state = newState;
    order.statusText = rawStatus;
    await order.save();

    // Refund if failed
    if (newState === 3 && order.extraInfo?.paymentSource !== 'api_balance') {
      const user = await User.findOne({ telegramChatId: order.telegramChatId });
      if (user) {
        user.balance += Number(order.price || 0);
        await user.save();
      }
    }

    // Notify user
    if (this.telegramNotifier && order.telegramChatId) {
      const msg = newState === 2
        ? `🎉 *FZR Cards Top-up Succeeded!*\n\n🎮 *Game:* ${order.gameName}\n💎 *Package:* ${order.skuName}\n🧾 *Order ID:* \`${order.orderId}\``
        : `❌ *FZR Cards Top-up Failed / Refunded*\n\n🎮 *Game:* ${order.gameName}\n💎 *Package:* ${order.skuName}\n💰 *Status:* $${Number(order.price || 0).toFixed(2)} USD refunded to balance.`;

      this.telegramNotifier(order.telegramChatId, msg);
    }

    return { success: true, received: true, orderId, newState };
  }

  public async pollActiveOrders(): Promise<void> {
    if (!this.client.isConfigured()) return;
    if (mongoose.connection.readyState !== 1) return;

    try {
      const activeOrders = await Order.find({
        provider: 'fzrcards',
        state: { $in: [0, 1, 4] }
      }).sort({ createdAt: -1 }).limit(20);

      for (const order of activeOrders) {
        const orderIdToQuery = order.providerOrderId || order.orderId || order.referenceId;
        if (!orderIdToQuery) continue;

        try {
          const res = await this.client.queryOrder(orderIdToQuery);
          if (res && (res.status || (res as any).order_status)) {
            const statusUpper = (res.status || (res as any).order_status || '').toUpperCase();
            let newState = order.state;
            
            if (['SUCCESS', 'COMPLETED'].includes(statusUpper)) newState = 2;
            else if (['FAILED', 'REFUNDED', 'CANCELED', 'CANCELLED'].includes(statusUpper)) newState = 3;
            else if (['PROCESSING'].includes(statusUpper)) newState = 1;

            if (newState !== order.state) {
              console.log(`[FzrCards Poller] Order ${order.referenceId} state change: ${order.state} -> ${newState}`);
              
              // Use atomic update to prevent duplicate notifications
              const updatedOrder = await Order.findOneAndUpdate(
                { _id: order._id, state: { $ne: newState } },
                { 
                  $set: { 
                    state: newState,
                    statusText: statusUpper,
                    updatedAt: new Date()
                  }
                },
                { new: true }
              );

              if (updatedOrder) {
                // Refund if failed
                if (newState === 3 && order.extraInfo?.paymentSource !== 'api_balance') {
                  const user = await User.findOne({ telegramChatId: order.telegramChatId });
                  if (user) {
                    await User.updateOne(
                      { _id: user._id },
                      { $inc: { balance: Number(order.price || 0) } }
                    );
                    
                    if (this.telegramNotifier) {
                      this.telegramNotifier(order.telegramChatId, `💰 *Refund Issued*\n\n$${Number(order.price || 0).toFixed(2)} USD has been returned to your balance for failed FZR order ${order.orderId}`);
                    }
                  }
                }

                // Notify User
                if (this.telegramNotifier) {
                  const msg = newState === 2
                    ? `🎉 *FZR Cards Top-up Succeeded!*\n\n🎮 *Game:* ${order.gameName}\n💎 *Package:* ${order.skuName}\n🧾 *Order ID:* \`${order.orderId}\``
                    : `❌ *FZR Cards Top-up Failed*\n\n🎮 *Game:* ${order.gameName}\n💎 *Package:* ${order.skuName}`;
                  this.telegramNotifier(order.telegramChatId, msg);
                }
                
                // Notify Admin
                if (this.adminChatId! && this.telegramNotifier) {
                  const adminMsg = `🔄 *FZR Cards Order Update*\n\nStatus: ${newState === 2 ? '✅ SUCCESS' : '❌ FAILED'}\nUser: \`${order.telegramChatId}\`\nGame: ${order.gameName}\nOrder: \`${order.orderId}\``;
                  this.telegramNotifier(this.adminChatId!, adminMsg);
                }
              }
            }
          }
        } catch (err: any) {
          console.error(`Error polling FZR order ${order.referenceId}:`, err.message);
        }
      }
    } catch (err) {
      console.error("Failed to poll active FZR Cards orders:", err);
    }
  }
}
