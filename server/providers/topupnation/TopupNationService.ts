import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import { TopupNationClient } from './TopupNationClient';
import { TopupNationProduct } from '../../models/TopupNationProduct';
import { TopupNationWebhookEvent } from '../../models/TopupNationWebhookEvent';
import { Order, IOrder } from '../../models/Order';
import { User } from '../../models/User';
import { TopupNationWebhookPayload, TopupNationOrderRequest } from './types';

export class TopupNationService {
  private client: TopupNationClient;
  private telegramNotifier?: (chatId: number | string, message: string) => Promise<void>;

  constructor(client: TopupNationClient) {
    this.client = client;
  }

  public setTelegramNotifier(notifier: (chatId: number | string, message: string) => Promise<void>) {
    this.telegramNotifier = notifier;
  }

  public setTelegram(telegram: any, adminChatId?: string) {
    this.telegramNotifier = async (chatId: number | string, message: string) => {
      try {
        if (telegram && telegram.sendMessage) {
          await telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
      } catch (err) {
        console.error(`[TopupNation Notification Error to ${chatId}]:`, err);
      }
    };
  }

  public async updateProductShortKey(productId: string, shortKey: string): Promise<any> {
    const cleanKey = shortKey.trim().toLowerCase().replace(/^\./, '');
    return TopupNationProduct.findOneAndUpdate(
      { productId },
      { shortKey: cleanKey },
      { returnDocument: 'after' }
    );
  }

  public async toggleProductEnabled(productId: string, isEnabled?: boolean): Promise<any> {
    const product = await TopupNationProduct.findOne({ productId });
    if (!product) return null;
    const newEnabled = isEnabled !== undefined ? Boolean(isEnabled) : !product.isEnabled;
    product.isEnabled = newEnabled;
    product.status = newEnabled ? 'ACTIVE' : 'DISABLED';
    return await product.save();
  }

  public async getWalletBalance(): Promise<any> {
    if (!this.client.isConfigured()) {
      throw new Error('TopupNation credentials are not configured.');
    }
    return this.client.getWalletBalance();
  }

  public async syncProducts(): Promise<{ total: number; synced: number; errors?: string[] }> {
    return this.syncCatalog();
  }

  public getClient(): TopupNationClient {
    return this.client;
  }

  /**
   * Generates a clean default short key for Telegram bot interaction.
   */
  public generateDefaultShortKey(name: string, productId: string): string {
    const clean = (name || '').toLowerCase();
    if (clean.includes('pubg')) return 'tp';
    if (clean.includes('mobile legends') || clean.includes('mlbb')) return 'tml';
    if (clean.includes('free fire')) return 'tff';
    if (clean.includes('genshin')) return 'tgi';
    if (clean.includes('honkai') || clean.includes('star rail')) return 'thsr';
    if (clean.includes('roblox')) return 'trbx';
    if (clean.includes('arena of valor') || clean.includes('aov')) return 'taov';
    if (clean.includes('call of duty') || clean.includes('codm')) return 'tcodm';
    if (clean.includes('clash of clans') || clean.includes('coc')) return 'tcoc';
    if (clean.includes('brawl stars')) return 'tbs';

    const words = clean.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      return 't' + words.map(w => w[0]).join('').slice(0, 4);
    }
    return `t${productId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4) || 'g'}`;
  }

  /**
   * Synchronizes product catalog from TopupNation API into MongoDB.
   */
  public async syncCatalog(): Promise<{ total: number; synced: number; errors?: string[] }> {
    if (!this.client.isConfigured()) {
      throw new Error('TopupNation API is not configured. Please provide API Key and Secret first.');
    }

    const liveProducts = await this.client.getProducts();
    let synced = 0;
    const errors: string[] = [];

    for (const p of liveProducts) {
      try {
        const shortKey = this.generateDefaultShortKey(p.name, p.productId);
        await TopupNationProduct.findOneAndUpdate(
          { productId: p.productId },
          {
            name: p.name,
            status: p.status || 'ACTIVE',
            category: p.category || 'Game',
            description: p.description,
            iconUrl: p.iconUrl,
            fields: p.fields || [],
            skus: p.skus || [],
            $setOnInsert: { shortKey },
            lastSyncedAt: new Date()
          },
          { upsert: true, returnDocument: 'after' }
        );
        synced++;
      } catch (err: any) {
        errors.push(`Product ${p.productId} (${p.name}): ${err.message}`);
      }
    }

    return { total: liveProducts.length, synced, errors: errors.length > 0 ? errors : undefined };
  }

  /**
   * Retrieves products from local database or syncs if empty.
   */
  public async getProducts(): Promise<any[]> {
    let items = await TopupNationProduct.find().sort({ name: 1 });
    if (items.length === 0 && this.client.isConfigured()) {
      try {
        await this.syncCatalog();
        items = await TopupNationProduct.find().sort({ name: 1 });
      } catch (e) {
        console.warn('Auto-sync products on getProducts failed:', e);
      }
    }
    return items;
  }

  /**
   * Retrieves single product with detailed SKUs and dynamic fields.
   */
  public async getProduct(productId: string): Promise<any> {
    let product = await TopupNationProduct.findOne({ productId });
    if (!product && this.client.isConfigured()) {
      try {
        const live = await this.client.getProduct(productId);
        product = await TopupNationProduct.findOneAndUpdate(
          { productId: live.productId },
          { ...live, lastSyncedAt: new Date() },
          { upsert: true, returnDocument: 'after' }
        );
      } catch (e) {
        // Fallback
      }
    }
    return product;
  }

  /**
   * Places an order with full validation, wallet balance deduction, idempotency, and rollback.
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
      return { success: false, error: `Product '${productId}' not found or unavailable.` };
    }

    const skuObj = (product.skus || []).find((s: any) => String(s.sku) === String(sku));
    if (!skuObj) {
      return { success: false, error: `Selected SKU '${sku}' does not exist for product '${product.name}'.` };
    }

    if (skuObj.available === false || skuObj.availability === false) {
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
    const idempotencyKey = existingIdempotencyKey || `TPN-${uuidv4().replace(/-/g, '')}`;

    // Robust extraction of userAccount (Player ID / User ID / Account)
    let userAccount: string = String(
      fields.userAccount ||
      fields.user_account ||
      fields.uid ||
      fields.userId ||
      fields.userid ||
      fields.user_id ||
      fields.account_id ||
      fields.accountId ||
      fields.playerId ||
      fields.player_id ||
      fields.playerid ||
      fields.account ||
      fields.id ||
      fields.login ||
      fields.email ||
      ''
    ).trim();

    // Fallback: search any key that looks like user / account / player / id
    if (!userAccount) {
      for (const [k, v] of Object.entries(fields)) {
        const lk = k.toLowerCase();
        if (v && (lk.includes('user') || lk.includes('account') || lk.includes('player') || lk.includes('uid') || lk === 'id')) {
          userAccount = String(v).trim();
          break;
        }
      }
    }

    // Fallback: take the first non-empty primitive value in fields
    if (!userAccount) {
      const values = Object.values(fields).filter(v => v !== undefined && v !== null && String(v).trim() !== '' && typeof v !== 'object');
      if (values.length > 0) {
        userAccount = String(values[0]).trim();
      }
    }

    // Robust extraction of server / zoneId
    let server: string | undefined = fields.server || fields.server_id || fields.serverId || fields.zoneId || fields.zone_id || fields.zoneid || fields.serverid || fields.region;
    if (!server) {
      for (const [k, v] of Object.entries(fields)) {
        const lk = k.toLowerCase();
        if (v && (lk.includes('zone') || lk.includes('server') || lk.includes('region'))) {
          server = String(v).trim();
          break;
        }
      }
    }

    // Robust extraction of role / nickname
    let role: string | null = fields.role || fields.role_name || fields.roleName || fields.playerName || fields.player_name || fields.nickname || fields.nick_name || null;
    if (!role) {
      for (const [k, v] of Object.entries(fields)) {
        const lk = k.toLowerCase();
        if (v && (lk.includes('role') || lk.includes('name') || lk.includes('nick'))) {
          role = String(v).trim();
          break;
        }
      }
    }

    // Clean fields and construct official TopupNation Reseller API order payload
    const cleanFields: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        cleanFields[k] = v;
      }
    }

    const orderPayload: TopupNationOrderRequest = {
      ...cleanFields,
      productId: String(productId),
      sku: String(sku),
      userAccount: String(userAccount),
      quantity: Number(quantity) || 1
    };

    if (server) {
      orderPayload.server = String(server);
    }
    if (role) {
      orderPayload.role = String(role);
    }

    // Final verification that userAccount is present
    if (!orderPayload.userAccount || orderPayload.userAccount.trim() === '') {
      if (!isApiLinked && !skipBalanceDeduction) {
        user.balance += totalCost;
        await user.save();
      }
      return {
        success: false,
        error: 'Missing required account field: Player ID / User Account is required.'
      };
    }

    // 5. Call TopupNation API
    try {
      const response = await this.client.createOrder(orderPayload, idempotencyKey);
      
      const providerOrderId = response.id;
      const statusText = response.status || 'PENDING';
      
      // Map state: PENDING/PROCESSING -> 1, SUCCESS -> 2, FAILED/REFUNDED -> 3
      let internalState = 1; // Processing / In Transaction
      if (statusText === 'SUCCESS') internalState = 2;
      else if (statusText === 'FAILED' || statusText === 'REFUNDED') internalState = 3;

      const order = await Order.create({
        referenceId,
        orderId: providerOrderId || referenceId,
        provider: 'topupnation',
        providerOrderId,
        providerReceiptNumber: response.receiptNumber,
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
        playerName: role || userAccount,
        price: totalCost,
        extraInfo: {
          ...fields,
          provider: 'topupnation',
          receiptNumber: response.receiptNumber,
          paymentSource: isApiLinked ? 'api_balance' : 'wallet_balance'
        },
        state: internalState
      });

      return { success: true, order };
    } catch (apiError: any) {
      console.error('[TopupNation] Order creation failed:', apiError);

      // Refund balance immediately if the API rejected order placement
      if (!isApiLinked && !skipBalanceDeduction) {
        user.balance += totalCost;
        await user.save();
      }

      return { 
        success: false, 
        error: apiError.message || 'TopupNation rejected order creation.' 
      };
    }
  }

  /**
   * Processes incoming Webhook events with deduplication and state mapping.
   */
  public async handleWebhook(
    payload: TopupNationWebhookPayload,
    signature?: string,
    rawBody?: string,
    eventIdHeader?: string
  ): Promise<{ success: boolean; duplicate?: boolean; order?: any; error?: string }> {
    // If webhook secret is configured and signature is provided, verify it
    if (signature && rawBody && this.client.getStatus().hasWebhookSecret) {
      const timestamp = payload.timestamp || Math.floor(Date.now() / 1000);
      const isValid = this.client.verifyWebhookSignature(timestamp, rawBody, signature);
      if (!isValid) {
        return { success: false, error: "Invalid signature" };
      }
    }

    const eventId = eventIdHeader || payload.eventId || payload.id || `${payload.event}-${payload.data?.id}-${Date.now()}`;
    
    // Check Deduplication
    const existingEvent = await TopupNationWebhookEvent.findOne({ eventId });
    if (existingEvent) {
      return { success: true, duplicate: true };
    }

    // Save event for idempotency
    await TopupNationWebhookEvent.create({
      eventId,
      eventType: payload.event,
      orderId: payload.data?.id,
      payload,
      processedAt: new Date()
    });

    const orderData = payload.data;
    if (!orderData || !orderData.id) {
      return { success: true };
    }

    const providerOrderId = orderData.id;
    const status = String(orderData.status || '').toUpperCase();

    // Find corresponding order
    const order = await Order.findOne({
      $or: [
        { providerOrderId },
        { orderId: providerOrderId },
        { referenceId: orderData.receiptNumber }
      ]
    });

    if (!order) {
      console.warn(`[TopupNation Webhook] No matching order found for providerOrderId: ${providerOrderId}`);
      return { success: true };
    }

        // Process state change
    let newState = 1; // Default processing
    if (status === 'SUCCESS') {
      newState = 2; // Completed
    } else if (status === 'FAILED' || status === 'REFUNDED') {
      newState = 3; // Failed
    } else if (status === 'PROCESSING') {
      newState = 1;
    }

    // Atomic update to prevent duplicate notifications from concurrent webhook/polling
    const updatedOrder = await Order.findOneAndUpdate(
      {
        _id: order._id,
        state: { $ne: newState } // Only update if the state is actually different
      },
      { 
        $set: { 
          state: newState, 
          statusText: status,
          ...(orderData.receiptNumber ? { providerReceiptNumber: orderData.receiptNumber } : {})
        } 
      },
      { returnDocument: 'after' }
    );

    if (!updatedOrder) {
      // It means either order not found, OR state was already updated. 
      // We can just exit gracefully without sending duplicate notifications.
      return { success: true };
    }

    // Handle refunds if it just transitioned to Failed
    if (newState === 3) {
      const isApiLinked = order.extraInfo?.paymentSource === 'api_balance';
      if (!isApiLinked && order.price > 0) {
        const user = await User.findOne({ telegramChatId: order.telegramChatId });
        if (user) {
          user.balance += order.price;
          await user.save();
        }
      }
    }

    // Trigger Notification
    if (this.telegramNotifier) {
      if (newState === 2) {
        const safeGame = (order.gameName || 'Game').replace(/[*_`\[\]]/g, '');
        const safeSku = (order.skuName || 'Top-up').replace(/[*_`\[\]]/g, '');
        const msg = `🎉 *TopupNation Order Completed!*\n` +
          `═════════════════════════\n` +
          `├── 🆔 Order ID: \`${order.providerOrderId || order.orderId}\`\n` +
          `├── 🎮 Game: *${safeGame}*\n` +
          `├── 📦 Package: *${safeSku}*\n` +
          (order.playerName ? `├── 👤 Player: \`${order.playerName.replace(/[*_`\[\]]/g, '')}\`\n` : '') +
          `├── ✅ Status: *COMPLETED*\n` +
          `└── 💬 Message: _Fulfilled successfully via TopupNation_\n` +
          `═════════════════════════`;
        await this.telegramNotifier(order.telegramChatId, msg);
      } else if (newState === 3) {
        const isApiLinked = order.extraInfo?.paymentSource === 'api_balance';
        const msg = `❌ *TopupNation Order Failed*\n` +
          `═════════════════════════\n` +
          `├── 🆔 Order ID: \`${order.providerOrderId || order.orderId}\`\n` +
          `├── 🎮 Game: *${(order.gameName || 'Game').replace(/[*_`\[\]]/g, '')}*\n` +
          `├── ❌ Status: *FAILED*\n` +
          `└── 💬 Message: _Could not be fulfilled_${!isApiLinked ? ` (Refunded $${order.price.toFixed(2)} USD to your wallet)` : ''}\n` +
          `═════════════════════════`;
        await this.telegramNotifier(order.telegramChatId, msg);
      }
    }

    return { success: true, order };
  }

  /**
   * Background polling fallback for active orders.
   */
  public async pollActiveOrders(): Promise<void> {
    if (!this.client.isConfigured()) return;
    if (mongoose.connection.readyState !== 1) return;

    try {
      const activeOrders = await Order.find({
        provider: 'topupnation',
        state: { $in: [0, 1, 4] }
      }).sort({ createdAt: -1 }).limit(20);

      for (const order of activeOrders) {
        const orderIdToQuery = order.providerOrderId || order.orderId;
        if (!orderIdToQuery) continue;

        try {
          const res = await this.client.queryOrder(orderIdToQuery);
          if (res && res.status) {
            const statusUpper = res.status.toUpperCase();
            let newState = order.state;
            
            if (statusUpper === 'SUCCESS') newState = 2;
            else if (statusUpper === 'FAILED' || statusUpper === 'REFUNDED') newState = 3;
            else if (statusUpper === 'PROCESSING') newState = 1;

            if (newState !== order.state) {
              console.log(`[TopupNation Poller] Order ${order.referenceId} state change: ${order.state} -> ${newState}`);
              
              // Use atomic update to prevent duplicate notifications
              const updatedOrder = await Order.findOneAndUpdate(
                { _id: order._id, state: { $ne: newState } },
                { 
                  $set: { 
                    state: newState, 
                    statusText: statusUpper,
                    ...(res.receiptNumber ? { providerReceiptNumber: res.receiptNumber } : {})
                  } 
                },
                { returnDocument: 'after' }
              );

              if (!updatedOrder) {
                 continue; // State was already updated by webhook or another poller
              }

              if (newState === 3) {
                const isApiLinked = order.extraInfo?.paymentSource === 'api_balance';
                if (!isApiLinked && order.price > 0) {
                  const user = await User.findOne({ telegramChatId: order.telegramChatId });
                  if (user) {
                    user.balance += order.price;
                    await user.save();
                  }
                }
              }

              // Send Notification
              if (this.telegramNotifier) {
                if (newState === 2) {
                  const msg = `🎉 *TopupNation Order Completed!*\n` +
                    `═════════════════════════\n` +
                    `├── 🆔 Order ID: \`${order.providerOrderId || order.orderId}\`\n` +
                    `├── 🎮 Game: *${(order.gameName || 'Game').replace(/[*_`\[\]]/g, '')}*\n` +
                    `├── 📦 Package: *${(order.skuName || 'Top-up').replace(/[*_`\[\]]/g, '')}*\n` +
                    `├── ✅ Status: *COMPLETED*\n` +
                    `└── 💬 Message: _Fulfilled successfully via TopupNation_\n` +
                    `═════════════════════════`;
                  await this.telegramNotifier(order.telegramChatId, msg);
                } else if (newState === 3) {
                  const isApiLinked = order.extraInfo?.paymentSource === 'api_balance';
                  const msg = `❌ *TopupNation Order Failed*\n` +
                    `═════════════════════════\n` +
                    `├── 🆔 Order ID: \`${order.providerOrderId || order.orderId}\`\n` +
                    `├── ❌ Status: *FAILED*\n` +
                    `└── 💬 Message: _Could not be fulfilled_${!isApiLinked ? ` (Refunded $${order.price.toFixed(2)} USD to your wallet)` : ''}\n` +
                    `═════════════════════════`;
                  await this.telegramNotifier(order.telegramChatId, msg);
                }
              }
            }
          }
        } catch (queryErr) {
          // Continue to next order
        }
      }
    } catch (err) {
      console.error('[TopupNation] Polling cycle error:', err);
    }
  }
}
