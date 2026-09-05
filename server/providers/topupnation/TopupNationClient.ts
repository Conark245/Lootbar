import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import crypto from 'crypto';
import { 
  TopupNationConfig, 
  TopupNationProduct, 
  TopupNationOrderRequest, 
  TopupNationOrderResponse, 
  TopupNationWalletBalance 
} from './types';

export class TopupNationClient {
  private apiKey: string;
  private apiSecret: string;
  private webhookSecret: string;
  private baseUrl: string;
  private isEnabled: boolean;
  private client: AxiosInstance;

  private sanitizeBaseUrl(url?: string): string {
    let base = (url || process.env.TOPUPNATION_BASE_URL || 'https://topupnation.io').trim();
    // Normalize invalid subdomain api.topupnation.io to topupnation.io
    base = base.replace(/api\.topupnation\.io/gi, 'topupnation.io');
    // Strip trailing /api/v1 since endpoints in this client already have /api/v1 prefix
    base = base.replace(/\/api\/v1\/?$/i, '').replace(/\/+$/, '');
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
      base = `https://${base}`;
    }
    return base;
  }

  constructor(config?: Partial<TopupNationConfig>) {
    this.apiKey = config?.apiKey || process.env.TOPUPNATION_API_KEY || '';
    this.apiSecret = config?.apiSecret || process.env.TOPUPNATION_API_SECRET || '';
    this.webhookSecret = config?.webhookSecret || process.env.TOPUPNATION_WEBHOOK_SECRET || '';
    this.baseUrl = this.sanitizeBaseUrl(config?.baseUrl);
    this.isEnabled = config?.isEnabled !== undefined ? config.isEnabled : true;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 25000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }

  public updateCredentials(config: Partial<TopupNationConfig>) {
    if (config.apiKey !== undefined) this.apiKey = config.apiKey;
    if (config.apiSecret !== undefined) this.apiSecret = config.apiSecret;
    if (config.webhookSecret !== undefined) this.webhookSecret = config.webhookSecret;
    if (config.baseUrl !== undefined) {
      this.baseUrl = this.sanitizeBaseUrl(config.baseUrl);
      this.client = axios.create({
        baseURL: this.baseUrl,
        timeout: 25000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
    }
    if (config.isEnabled !== undefined) this.isEnabled = config.isEnabled;
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
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
   * Generates the official HMAC-SHA256 canonical signature.
   * Format:
   * METHOD\n
   * PATH\n
   * TIMESTAMP\n
   * BODY
   */
  public generateSignature(method: string, path: string, timestamp: string | number, bodyString: string = ''): string {
    const cleanMethod = method.toUpperCase().trim();
    // Exclude domain and query parameters from path
    const cleanPath = path.split('?')[0];
    const cleanTimestamp = String(timestamp).trim();
    const cleanBody = bodyString || '';

    const canonicalString = `${cleanMethod}\n${cleanPath}\n${cleanTimestamp}\n${cleanBody}`;
    
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(canonicalString, 'utf8')
      .digest('hex')
      .toLowerCase();
  }

  /**
   * Performs an authenticated API request with signing and automatic 429 backoff handling.
   */
  private async request<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: any,
    headers: Record<string, string> = {},
    retryCount: number = 0
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error('TopupNation API credentials are not configured. Please enter API Key and Secret in Settings.');
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodyString = data ? JSON.stringify(data) : '';
    const signature = this.generateSignature(method, endpoint, timestamp, bodyString);

    const requestHeaders: Record<string, string> = {
      'X-API-KEY': this.apiKey,
      'X-TIMESTAMP': timestamp,
      'X-SIGNATURE': signature,
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
      // Handle Rate Limiting (429) with jittered exponential backoff
      if (error.response?.status === 429 && retryCount < 3 && method === 'GET') {
        const retryAfterHeader = error.response.headers?.['retry-after'];
        const delaySeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : Math.pow(2, retryCount) + Math.random();
        console.warn(`[TopupNation] Rate limit hit (429). Retrying in ${delaySeconds}s (attempt ${retryCount + 1})...`);
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        return this.request<T>(method, endpoint, data, headers, retryCount + 1);
      }

      // Map machine-readable error codes cleanly
      const status = error.response?.status;
      let apiError = error.response?.data?.error || error.response?.data?.message || error.response?.data?.code;
      if (typeof apiError === 'object' && apiError !== null) {
        apiError = apiError.code || apiError.message || JSON.stringify(apiError);
      }
      const detailedMessage = error.response?.data?.detail || error.response?.data?.errorMessage || error.message;

      const errorMessage = apiError ? `[${apiError}] ${detailedMessage}` : detailedMessage;
      const enhancedError: any = new Error(errorMessage || `TopupNation API Error (${status || 'Network Error'})`);
      enhancedError.status = status;
      enhancedError.code = apiError;
      enhancedError.responseData = error.response?.data;
      throw enhancedError;
    }
  }

  /**
   * GET /api/v1/reseller/products
   * Retrieves full catalog of products, dynamic fields, and SKUs.
   */
  public async getProducts(): Promise<TopupNationProduct[]> {
    const res = await this.request<any>('GET', '/api/v1/reseller/products');
    const items = res?.data || res?.products || res?.items || (Array.isArray(res) ? res : []);
    
    return items.map((item: any) => ({
      productId: String(item.productId || item.id || item.product_id),
      name: item.name || item.product_name || 'Game Product',
      status: item.status || 'ACTIVE',
      category: item.category || 'Game',
      description: item.description || '',
      iconUrl: item.iconUrl || item.icon || item.image || '',
      fields: Array.isArray(item.fields) ? item.fields : [],
      skus: Array.isArray(item.skus) ? item.skus.map((s: any) => ({
        sku: String(s.sku || s.id || s.sku_id),
        name: s.name || s.skuName || s.sku_name || 'Package',
        price: parseFloat(s.price || s.reseller_price || '0'),
        currency: s.currency || 'USD',
        available: s.available !== undefined ? s.available : (s.availability !== undefined ? s.availability : true),
        minQuantity: s.minQuantity || 1,
        maxQuantity: s.maxQuantity || 100
      })) : [],
      lastSyncedAt: new Date()
    }));
  }

  /**
   * GET /api/v1/reseller/products/:productId
   * Retrieves single product details with dynamic fields and SKU lists.
   */
  public async getProduct(productId: string): Promise<TopupNationProduct> {
    const res = await this.request<any>('GET', `/api/v1/reseller/products/${encodeURIComponent(productId)}`);
    const item = res?.data || res?.product || res;

    return {
      productId: String(item.productId || item.id || productId),
      name: item.name || item.product_name || 'Game Product',
      status: item.status || 'ACTIVE',
      category: item.category || 'Game',
      description: item.description || '',
      iconUrl: item.iconUrl || item.icon || item.image || '',
      fields: Array.isArray(item.fields) ? item.fields : [],
      skus: Array.isArray(item.skus) ? item.skus.map((s: any) => ({
        sku: String(s.sku || s.id || s.sku_id),
        name: s.name || s.skuName || s.sku_name || 'Package',
        price: parseFloat(s.price || s.reseller_price || '0'),
        currency: s.currency || 'USD',
        available: s.available !== undefined ? s.available : (s.availability !== undefined ? s.availability : true),
        minQuantity: s.minQuantity || 1,
        maxQuantity: s.maxQuantity || 100
      })) : [],
      lastSyncedAt: new Date()
    };
  }

  /**
   * GET /api/v1/reseller/wallet/balance
   * Retrieves TopupNation reseller wallet balance.
   */
    /**
   * GET /api/v1/reseller/products/:productId/validate
   * Validates user account and returns role/player name.
   */
  public async validateUser(productId: string, userAccount: string, server?: string): Promise<{ success: boolean; role?: string; error?: string }> {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('userAccount', userAccount);
      if (server) {
        queryParams.append('server', server);
      }
      const res = await this.request<any>('GET', `/api/v1/reseller/products/${encodeURIComponent(productId)}/validate?${queryParams.toString()}`);
      const data = res?.data || res;
      const role = data?.role || data?.roleName || data?.playerName || data?.name;
      if (role) {
        return { success: true, role: String(role) };
      }
      return { success: false, error: 'Validation returned success but no role was found.' };
    } catch (error: any) {
      return { success: false, error: error.message || 'Validation failed' };
    }
  }

  public async getWalletBalance(): Promise<TopupNationWalletBalance> {
    const res = await this.request<any>('GET', '/api/v1/reseller/wallet/balance');
    const data = res?.data || res;
    return {
      balance: parseFloat(data.balance || data.amount || '0'),
      currency: data.currency || 'USD',
      availableBalance: data.availableBalance !== undefined ? parseFloat(data.availableBalance) : parseFloat(data.balance || '0')
    };
  }

  public async getBalance(): Promise<TopupNationWalletBalance> {
    return this.getWalletBalance();
  }

  /**
   * POST /api/v1/reseller/orders
   * Creates a new order with mandatory X-IDEMPOTENCY-KEY.
   */
  public async createOrder(
    orderData: TopupNationOrderRequest,
    idempotencyKey: string
  ): Promise<TopupNationOrderResponse> {
    if (!idempotencyKey) {
      throw new Error('X-IDEMPOTENCY-KEY is mandatory for TopupNation order creation.');
    }

    const headers = {
      'X-IDEMPOTENCY-KEY': idempotencyKey
    };

    const res = await this.request<any>('POST', '/api/v1/reseller/orders', orderData, headers);
    const data = res?.data || res?.order || res;

    return {
      id: String(data.id || data.orderId || data.order_id || ''),
      receiptNumber: data.receiptNumber || data.receipt_number || data.referenceId,
      productId: String(data.productId || orderData.productId),
      sku: String(data.sku || orderData.sku),
      status: String(data.status || data.state || 'PENDING').toUpperCase(),
      amount: data.amount ? parseFloat(data.amount) : undefined,
      currency: data.currency || 'USD',
      userAccount: data.userAccount || orderData.userAccount,
      server: data.server || orderData.server,
      role: data.role || orderData.role,
      quantity: data.quantity || orderData.quantity || 1,
      errorMessage: data.errorMessage || data.error,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    };
  }

  /**
   * GET /api/v1/reseller/orders/:orderId
   * Queries status of an existing order.
   */
  public async queryOrder(orderId: string): Promise<TopupNationOrderResponse> {
    const res = await this.request<any>('GET', `/api/v1/reseller/orders/${encodeURIComponent(orderId)}`);
    const data = res?.data || res?.order || res;

    return {
      id: String(data.id || data.orderId || orderId),
      receiptNumber: data.receiptNumber || data.receipt_number,
      productId: String(data.productId || ''),
      sku: String(data.sku || ''),
      status: String(data.status || data.state || 'PENDING').toUpperCase(),
      amount: data.amount ? parseFloat(data.amount) : undefined,
      currency: data.currency || 'USD',
      userAccount: data.userAccount,
      server: data.server,
      role: data.role,
      quantity: data.quantity,
      errorMessage: data.errorMessage || data.error,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    };
  }

  /**
   * Verifies incoming Webhook signatures with timing-safe comparison.
   * Input signature format: HMAC-SHA256(timestamp + "." + rawBody, webhookSecret)
   */
  public verifyWebhookSignature(timestamp: string | number, rawBody: string, signature: string): boolean {
    if (!this.webhookSecret) {
      console.warn('[TopupNation Webhook] Verification skipped: No webhookSecret configured.');
      return false;
    }

    if (!timestamp || !rawBody || !signature) {
      return false;
    }

    // Timestamp freshness verification (5-minute window)
    const tsNum = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - tsNum) > 300) {
      console.warn(`[TopupNation Webhook] Timestamp outside 300s window: now=${now}, header=${tsNum}`);
      return false;
    }

    const payload = `${timestamp}.${rawBody}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload, 'utf8')
      .digest('hex')
      .toLowerCase();

    const sigA = Buffer.from(signature.toLowerCase().trim(), 'utf8');
    const sigB = Buffer.from(expectedSignature, 'utf8');

    if (sigA.length !== sigB.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigA, sigB);
  }
}
