import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import {
  FzrCardsConfig,
  FzrCardsProduct,
  FzrCardsFieldDefinition,
  FzrCardsSku,
  FzrCardsOrderRequest,
  FzrCardsOrderResponse,
  FzrCardsWalletBalance,
  FzrCardsProfile,
  FzrCardsValidateIdResponse
} from './types';

export class FzrCardsClient {
  private apiKey: string;
  private baseUrl: string;
  private webhookSecret: string;
  private isEnabled: boolean;
  private client: AxiosInstance;

  private sanitizeBaseUrl(url?: string): string {
    let base = (url || process.env.FZRCARDS_BASE_URL || 'https://api.fzr.cards/api/v2').trim();
    base = base.replace(/\/+$/, '');
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
      base = `https://${base}`;
    }
    // Ensure /api/v2 suffix if user provided only root domain
    if (!base.includes('/api/v2') && !base.includes('/api/v1')) {
      base = `${base}/api/v2`;
    }
    return base;
  }

  constructor(config?: Partial<FzrCardsConfig>) {
    this.apiKey = config?.apiKey || process.env.FZRCARDS_API_KEY || '';
    this.baseUrl = this.sanitizeBaseUrl(config?.baseUrl);
    this.webhookSecret = config?.webhookSecret || process.env.FZRCARDS_WEBHOOK_SECRET || '';
    this.isEnabled = config?.isEnabled !== undefined ? config.isEnabled : true;
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }

  public updateCredentials(config: Partial<FzrCardsConfig>) {
    if (config.apiKey !== undefined) this.apiKey = config.apiKey.trim();
    if (config.baseUrl !== undefined) {
      this.baseUrl = this.sanitizeBaseUrl(config.baseUrl);
    }
    if (config.webhookSecret !== undefined) this.webhookSecret = config.webhookSecret.trim();
    if (config.isEnabled !== undefined) this.isEnabled = config.isEnabled;

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  public getStatus(): { isConfigured: boolean; isEnabled: boolean; baseUrl: string; hasWebhookSecret: boolean } {
    return {
      isConfigured: this.isConfigured(),
      isEnabled: this.isEnabled,
      baseUrl: this.baseUrl,
      hasWebhookSecret: Boolean(this.webhookSecret)
    };
  }

  /**
   * Internal generic request helper with authentication headers and retry handling.
   */
  private async request<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: any,
    headers: Record<string, string> = {},
    retryCount: number = 0
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error('FZR Cards API credentials are not configured. Please enter API Key in Settings.');
    }

    const cleanKey = this.apiKey.trim();
    const requestHeaders: Record<string, string> = {
      'X-API-Key': cleanKey,
      'Authorization': `Bearer ${cleanKey}`,
      ...headers
    };

    try {
      const response = await this.client.request<T>({
        method,
        url: endpoint,
        data: data || undefined,
        headers: requestHeaders
      });

      return response.data;
    } catch (error: any) {
      // 429 Rate Limit backoff
      if (error.response?.status === 429 && retryCount < 3 && method === 'GET') {
        const retryAfterHeader = error.response.headers?.['retry-after'];
        const delaySeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : Math.pow(2, retryCount) + 1;
        console.warn(`[FZR Cards] Rate limit (429). Retrying in ${delaySeconds}s (attempt ${retryCount + 1})...`);
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        return this.request<T>(method, endpoint, data, headers, retryCount + 1);
      }

      const status = error.response?.status;
      const responseBody = error.response?.data;
      const apiError = responseBody?.error || responseBody?.message || responseBody?.detail || responseBody?.code;
      const detailedMessage = typeof apiError === 'string' ? apiError : (error.message || `FZR Cards HTTP Error ${status}`);

      const enhancedError: any = new Error(`[FZR Cards ${status || 'Error'}]: ${detailedMessage}`);
      enhancedError.status = status;
      enhancedError.responseData = responseBody;
      throw enhancedError;
    }
  }

  /**
   * GET /balance (or fallback to /me)
   * Retrieves wallet balance in USD.
   */
  public async getWalletBalance(): Promise<FzrCardsWalletBalance> {
    try {
      const res = await this.request<any>('GET', '/balance');
      const balanceVal = res?.balance !== undefined ? res.balance : (res?.data?.balance !== undefined ? res.data.balance : (res?.usd !== undefined ? res.usd : res?.amount));
      const balNum = parseFloat(String(balanceVal || '0'));
      
      return {
        balance: isNaN(balNum) ? 0 : balNum,
        currency: res?.currency || res?.data?.currency || 'USD',
        availableBalance: isNaN(balNum) ? 0 : balNum
      };
    } catch (err) {
      // Try /me as profile fallback
      const profile = await this.getProfile();
      return {
        balance: profile.balance || 0,
        currency: profile.currency || 'USD',
        availableBalance: profile.balance || 0
      };
    }
  }

  public async getBalance(): Promise<FzrCardsWalletBalance> {
    return this.getWalletBalance();
  }

  /**
   * GET /me
   * Retrieves account profile and summary stats.
   */
  public async getProfile(): Promise<FzrCardsProfile> {
    const res = await this.request<any>('GET', '/me');
    const data = res?.data || res || {};
    const balNum = parseFloat(String(data.balance !== undefined ? data.balance : (data.wallet_balance || data.wallet || '0')));
    
    return {
      login: data.login || data.username || data.name,
      email: data.email,
      plan: data.plan || data.tier || 'Standard',
      balance: isNaN(balNum) ? 0 : balNum,
      currency: data.currency || 'USD',
      totalSpent: parseFloat(String(data.total_spent || data.totalSpent || '0')),
      totalOrders: parseInt(String(data.total_orders || data.totalOrders || '0'), 10)
    };
  }

  /**
   * GET /topups
   * Retrieves all top-up categories/games.
   */
  
  public async getCategories(): Promise<any[]> {
    let allCategories: any[] = [];
    
    // Fetch Topups
    try {
      let cursor: string | null = null;
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        let url = '/topups';
        if (cursor) {
          url = `/topups?cursor=${encodeURIComponent(cursor)}`;
        } else if (page > 1) {
          url = `/topups?page=${page}`;
        }
        
        const res = await this.request<any>('GET', url);
        
        // Extract items
        if (res?.items) {
          allCategories = allCategories.concat(res.items.map((i: any) => ({ ...i, _kind: 'topup' })));
        } else if (res?.data && Array.isArray(res.data)) {
          allCategories = allCategories.concat(res.data.map((i: any) => ({ ...i, _kind: 'topup' })));
        } else if (Array.isArray(res)) {
          allCategories = allCategories.concat(res.map((i: any) => ({ ...i, _kind: 'topup' })));
        }
        
        // Check pagination
        if (res?.meta?.has_more && res?.meta?.next_cursor) {
          cursor = res.meta.next_cursor;
        } else if (res?.meta?.current_page && res?.meta?.last_page && res.meta.current_page < res.meta.last_page) {
          page = res.meta.current_page + 1;
          cursor = null;
        } else {
          hasMore = false;
        }
      }
    } catch (e) {
      console.error('Failed to fetch topup categories:', e);
    }
    
    // Fetch Giftcards
    try {
      let cursor: string | null = null;
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        let url = '/giftcards';
        if (cursor) {
          url = `/giftcards?cursor=${encodeURIComponent(cursor)}`;
        } else if (page > 1) {
          url = `/giftcards?page=${page}`;
        }
        
        const res = await this.request<any>('GET', url);
        
        // Extract items
        if (res?.items) {
          allCategories = allCategories.concat(res.items.map((i: any) => ({ ...i, _kind: 'gift_card' })));
        } else if (res?.data && Array.isArray(res.data)) {
          allCategories = allCategories.concat(res.data.map((i: any) => ({ ...i, _kind: 'gift_card' })));
        } else if (Array.isArray(res)) {
          allCategories = allCategories.concat(res.map((i: any) => ({ ...i, _kind: 'gift_card' })));
        }
        
        // Check pagination
        if (res?.meta?.has_more && res?.meta?.next_cursor) {
          cursor = res.meta.next_cursor;
        } else if (res?.meta?.current_page && res?.meta?.last_page && res.meta.current_page < res.meta.last_page) {
          page = res.meta.current_page + 1;
          cursor = null;
        } else {
          hasMore = false;
        }
      }
    } catch (e) {
      console.error('Failed to fetch giftcard categories:', e);
    }
    
    return allCategories;
  }


  /**
   * GET /topups/offers?category_id=...
   * Retrieves available offers / SKUs and dynamic fields definitions for a category.
   */
  
  public async getOffers(categoryId: string, kind: string = 'topup'): Promise<{ offers: any[]; fields: any[] }> {
    let url = `/topups/offers?category_id=${encodeURIComponent(categoryId)}`;
    if (kind === 'gift_card') {
      url = `/giftcards/cards?category_id=${encodeURIComponent(categoryId)}`;
    }
    
    const res = await this.request<any>('GET', url);
    const offers = res?.offers || res?.data?.offers || res?.items || (Array.isArray(res) ? res : []);
    const fields = res?.fields || res?.data?.fields || [];
    return {
      offers: Array.isArray(offers) ? offers : [],
      fields: Array.isArray(fields) ? fields : []
    };
  }

  /**
   * Retrieves full catalog by fetching categories and their offers.
   */
  public async getProducts(): Promise<FzrCardsProduct[]> {
    const categories = await this.getCategories();
    const products: FzrCardsProduct[] = [];

    const CHUNK_SIZE = 5;
    for (let i = 0; i < categories.length; i += CHUNK_SIZE) {
      const chunk = categories.slice(i, i + CHUNK_SIZE);
      const chunkPromises = chunk.map(async (cat) => {
        const catId = String(cat.category_id || cat.id || cat.slug || cat.code);
        const catName = cat.name || cat.title || cat.category_name || 'Game Top-up';
        
        let offers: any[] = [];
        let fields: any[] = cat.fields || [];

        try {
          const offerData = await this.getOffers(catId, cat._kind);
          offers = offerData.offers;
          if (offerData.fields && offerData.fields.length > 0) {
            fields = offerData.fields;
          }
        } catch (err: any) {
          console.warn(`[FZR Cards] Could not fetch offers for category ${catId} (${catName}):`, err.message);
        }

        // Map fields
        const mappedFields: FzrCardsFieldDefinition[] = fields.map((f: any) => ({
          name: f.name || f.key || f.field_name || 'account_id',
          title: f.title || f.label || f.name || 'Account ID',
          type: f.type === 'select' || f.type === 'number' || f.type === 'text' ? f.type : 'string',
          required: f.required !== undefined ? Boolean(f.required) : true,
          placeholder: f.placeholder || f.hint || '',
          options: Array.isArray(f.options) ? f.options.map((opt: any) => ({
            label: typeof opt === 'string' ? opt : (opt.label || opt.name || String(opt.value)),
            value: typeof opt === 'string' ? opt : String(opt.value !== undefined ? opt.value : opt.id)
          })) : undefined,
          description: f.description || ''
        }));

        // Default fields fallback if empty (e.g. Player ID)
        if (mappedFields.length === 0) {
          mappedFields.push({
            name: 'player_id',
            title: 'Player ID / User ID',
            type: 'string',
            required: true,
            placeholder: 'Enter in-game ID'
          });
        }

        // Map SKUs
        const mappedSkus: FzrCardsSku[] = offers.map((o: any) => {
          const skuId = String(o.offer_id || o.id || o.sku_id || o.sku || o.code);
          const skuName = o.name || o.title || o.offer_name || `${o.amount || ''} Package`;
          const priceVal = o.price_usd !== undefined ? o.price_usd : (o.price !== undefined ? o.price : (o.reseller_price || o.cost || 0));
          const price = parseFloat(String(priceVal || '0'));
          const available = o.availability !== undefined ? Boolean(o.availability) : (o.available !== undefined ? Boolean(o.available) : (o.status !== 'disabled'));

          return {
            sku: skuId,
            name: skuName,
            price: isNaN(price) ? 0 : price,
            currency: o.currency || 'USD',
            available,
            minQuantity: o.min_quantity || o.minQuantity || 1,
            maxQuantity: o.max_quantity || o.maxQuantity || 100
          };
        });

        return {
          productId: catId,
          name: catName,
          status: (cat.status || 'ACTIVE').toUpperCase(),
          category: cat._kind === 'gift_card' ? 'Gift Card' : 'Game Top-up',
          description: cat.description || cat.guide || '',
          iconUrl: cat.icon || cat.image || cat.icon_url || cat.logo || '',
          fields: mappedFields,
          skus: mappedSkus,
          isEnabled: cat.status !== 'DISABLED' && cat.status !== 'disabled',
          lastSyncedAt: new Date()
        };
      });

      const chunkResults = await Promise.all(chunkPromises);
      products.push(...chunkResults);
    }

    return products;
  }

  /**
   * POST /topups/validate-id
   * Validates player ID and retrieves in-game nickname before ordering.
   */
  public async validatePlayerId(categoryId: string, fields: Record<string, any>): Promise<FzrCardsValidateIdResponse> {
    try {
      const payload = {
        category_id: categoryId,
        fields
      };
      const res = await this.request<any>('POST', '/topups/validate-id', payload);
      const data = res?.data || res || {};

      return {
        valid: Boolean(data.valid !== undefined ? data.valid : (res.ok !== false && (data.name || data.player_name))),
        name: data.name || data.player_name || data.nickname || data.username,
        region: data.region || data.zone || data.server,
        message: data.message || res.message,
        raw: data
      };
    } catch (err: any) {
      return {
        valid: false,
        message: err.message || 'Validation request failed',
        raw: err.responseData
      };
    }
  }

  /**
   * POST /topups/order
   * Places a top-up order with optional idempotency key.
   */
  
  public async createOrder(
    orderData: FzrCardsOrderRequest,
    idempotencyKey?: string
  ): Promise<FzrCardsOrderResponse> {
    const headers: Record<string, string> = {};
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
      headers['X-IDEMPOTENCY-KEY'] = idempotencyKey;
    }

    let url = '/topups/order';
    let payload: any = {};

    if (orderData.kind === 'gift_card') {
      url = '/giftcards/order';
      payload = {
        category_id: orderData.categoryId,
        card_id: orderData.offerId,
        quantity: orderData.quantity || 1
      };
    } else {
      url = '/topups/order';
      payload = {
        category_id: orderData.categoryId,
        offer_id: orderData.offerId,
        fields: orderData.fields || {}
      };
    }

    const res = await this.request<any>('POST', url, payload, headers);

    const data = res?.data || res?.order || res || {};

    const orderId = String(data.order_id || data.id || data.orderId || '');
    const rawStatus = String(data.status || data.state || 'PROCESSING').toUpperCase();
    
    // Normalize status string
    let normalizedStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'CANCELLED' = 'PROCESSING';
    if (rawStatus.includes('SUCCESS') || rawStatus.includes('COMPLETE') || rawStatus === 'DONE') {
      normalizedStatus = 'COMPLETED';
    } else if (rawStatus.includes('FAIL') || rawStatus.includes('ERROR')) {
      normalizedStatus = 'FAILED';
    } else if (rawStatus.includes('REFUND')) {
      normalizedStatus = 'REFUNDED';
    } else if (rawStatus.includes('CANCEL')) {
      normalizedStatus = 'CANCELLED';
    } else if (rawStatus.includes('PENDING')) {
      normalizedStatus = 'PENDING';
    }

    return {
      id: orderId,
      orderId: orderId,
      referenceId: data.reference_id || data.referenceId || idempotencyKey,
      categoryId: String(orderData.categoryId),
      offerId: String(orderData.offerId),
      status: normalizedStatus,
      amount: data.amount ? parseFloat(data.amount) : (data.price ? parseFloat(data.price) : undefined),
      currency: data.currency || 'USD',
      userAccount: data.fields?.player_id || data.fields?.user_id || data.userAccount,
      playerName: data.player_name || data.name || data.fields?.name,
      quantity: orderData.quantity || 1,
      errorMessage: data.error || data.error_message || (res.ok === false ? res.error : undefined),
      createdAt: data.created_at || data.createdAt,
      updatedAt: data.updated_at || data.updatedAt,
      raw: data
    };
  }

  /**
   * GET /orders/:id (or /order/:id)
   * Queries status and details of an existing order.
   */
  public async queryOrder(orderId: string): Promise<FzrCardsOrderResponse> {
    let res: any;
    try {
      res = await this.request<any>('GET', `/orders/${encodeURIComponent(orderId)}`);
    } catch (e) {
      // Try singular /order/:id
      res = await this.request<any>('GET', `/order/${encodeURIComponent(orderId)}`);
    }

    const data = res?.data || res?.order || res || {};
    const rawStatus = String(data.status || data.state || 'PROCESSING').toUpperCase();

    let normalizedStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'CANCELLED' = 'PROCESSING';
    if (rawStatus.includes('SUCCESS') || rawStatus.includes('COMPLETE') || rawStatus === 'DONE') {
      normalizedStatus = 'COMPLETED';
    } else if (rawStatus.includes('FAIL') || rawStatus.includes('ERROR')) {
      normalizedStatus = 'FAILED';
    } else if (rawStatus.includes('REFUND')) {
      normalizedStatus = 'REFUNDED';
    } else if (rawStatus.includes('CANCEL')) {
      normalizedStatus = 'CANCELLED';
    } else if (rawStatus.includes('PENDING')) {
      normalizedStatus = 'PENDING';
    }

    return {
      id: String(data.order_id || data.id || orderId),
      orderId: String(data.order_id || data.id || orderId),
      referenceId: data.reference_id || data.referenceId,
      categoryId: String(data.category_id || data.categoryId || ''),
      offerId: String(data.offer_id || data.offerId || ''),
      status: normalizedStatus,
      amount: data.amount ? parseFloat(data.amount) : (data.price ? parseFloat(data.price) : undefined),
      currency: data.currency || 'USD',
      userAccount: data.fields?.player_id || data.fields?.user_id || data.userAccount,
      playerName: data.player_name || data.name,
      errorMessage: data.error || data.error_message,
      createdAt: data.created_at || data.createdAt,
      updatedAt: data.updated_at || data.updatedAt,
      raw: data
    };
  }

  /**
   * Verifies incoming Webhook signature (HMAC-SHA256).
   */
  public verifyWebhookSignature(timestamp: string | number, rawBody: string, signature: string): boolean {
    if (!this.webhookSecret) {
      console.warn('[FZR Cards Webhook] Verification skipped: No webhookSecret configured.');
      return true; // Allow if no secret is set yet
    }

    if (!rawBody || !signature) {
      return false;
    }

    // Try HMAC SHA256 against rawBody or timestamp.rawBody
    const expectedSigRaw = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody, 'utf8')
      .digest('hex')
      .toLowerCase();

    const expectedSigWithTs = timestamp ? crypto
      .createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.${rawBody}`, 'utf8')
      .digest('hex')
      .toLowerCase() : '';

    const cleanSig = signature.toLowerCase().replace(/^sha256=/, '').trim();

    return cleanSig === expectedSigRaw || cleanSig === expectedSigWithTs;
  }
}
