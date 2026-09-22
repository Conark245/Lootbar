import axios, { AxiosInstance } from 'axios';
import { G2BulkConfig, G2BulkProduct } from './types';

function sanitizeG2BulkBaseUrl(raw?: string): string {
  let url = (raw || '').trim();
  if (!url) return 'https://api.g2bulk.com/api/v2';
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/docs$/i, '');
  url = url.replace(/\/+$/, '');

  if (url === 'https://api.g2bulk.com' || url === 'http://api.g2bulk.com') {
    return 'https://api.g2bulk.com/api/v2';
  }
  return url;
}

export class G2BulkClient {
  private client: AxiosInstance;
  private apiKey: string;
  private baseUrl: string;

  constructor(config?: G2BulkConfig) {
    this.apiKey = config?.apiKey || process.env.G2BULK_API_KEY || process.env.G2BULK_KEY || '';
    
    const raw = config?.baseUrl || process.env.G2BULK_BASE_URL || process.env.G2BULK_API_URL || process.env.G2BULK_URL || 'https://api.g2bulk.com/v2';
    this.baseUrl = sanitizeG2BulkBaseUrl(raw);

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      }
    });
  }

  public isConfigured(): boolean {
    return !!this.apiKey;
  }

  public updateCredentials(config: { apiKey?: string; baseUrl?: string }) {
    if (config.apiKey !== undefined) {
      this.apiKey = config.apiKey || process.env.G2BULK_API_KEY || process.env.G2BULK_KEY || '';
    }
    
    const raw = config.baseUrl || process.env.G2BULK_BASE_URL || process.env.G2BULK_API_URL || process.env.G2BULK_URL || 'https://api.g2bulk.com/v2';
    this.baseUrl = sanitizeG2BulkBaseUrl(raw);
    this.client.defaults.baseURL = this.baseUrl;
  }

  public getStatus() {
    return {
      isConfigured: !!this.apiKey,
      baseUrl: this.baseUrl,
      isEnabled: true
    };
  }

  private async request<T = any>(method: string, endpoint: string, data?: any, headers: any = {}): Promise<T> {
    if (!this.apiKey) throw new Error('G2Bulk API key is missing');
    
    const mergedHeaders = { 
      'X-API-Key': this.apiKey, 
      'x-api-key': this.apiKey, 
      'Authorization': `Bearer ${this.apiKey}`,
      ...headers 
    };

    const candidateUrls = [
      this.baseUrl,
      'https://api.g2bulk.com/api/v2',
      'https://api.g2bulk.com/v2',
      'https://api.g2bulk.com/api/v1',
      'https://api.g2bulk.com/v1'
    ];
    // Remove duplicates while keeping order
    const uniqueCandidates = Array.from(new Set(candidateUrls.filter(Boolean)));

    let lastError: any = null;

    for (const baseUrl of uniqueCandidates) {
      try {
        const fullUrl = `${baseUrl.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;
        const response = await axios.request<T>({
          method,
          url: fullUrl,
          data,
          headers: mergedHeaders,
          timeout: 25000
        });
        return response.data;
      } catch (error: any) {
        lastError = error;
        // If it's a 401 or 403, switching base URLs won't help if key is wrong, but we keep trying in case API version endpoint requires specific format
        if (error.response?.status === 400 || error.response?.status === 422) {
          // Validation error specific to endpoint — throw early if response has message
          if (error.response?.data?.message || error.response?.data?.error) {
            break;
          }
        }
      }
    }

    if (lastError?.response?.data?.message) {
      throw new Error(`G2Bulk API Error: ${lastError.response.data.message}`);
    }
    if (lastError?.response?.data?.error) {
      throw new Error(`G2Bulk API Error: ${lastError.response.data.error}`);
    }
    throw lastError || new Error('G2Bulk API Request Failed');
  }

  public async getBalance(): Promise<number> {
    let res: any;
    try {
      res = await this.request<any>('GET', '/getMe');
    } catch (e: any) {
      try {
        res = await this.request<any>('GET', '/getme');
      } catch (e2) {
        try {
          res = await this.request<any>('GET', '/me');
        } catch (e3) {
          res = await this.request<any>('GET', '/user/balance');
        }
      }
    }

    if (!res) throw new Error('Failed to fetch G2Bulk balance response');

    const val = 
      res.balance ?? 
      res.data?.balance ?? 
      res.user?.balance ?? 
      res.data?.user?.balance ?? 
      res.wallet_balance ?? 
      res.data?.wallet ?? 
      res.data?.credit ?? 
      res.credit ?? 
      res.data?.amount ?? 
      res.amount;

    if (val !== undefined && val !== null && !isNaN(Number(val))) {
      return Number(val);
    }

    if (typeof res === 'number') return res;
    if (res.success === false) throw new Error(res.message || res.error || 'Failed to fetch G2Bulk balance');

    return 0;
  }

  public async getProducts(): Promise<G2BulkProduct[]> {
    let res: any;
    try {
      res = await this.request<any>('GET', '/products');
    } catch (err) {
      try {
        res = await this.request<any>('GET', '/categories');
      } catch (err2) {
        res = await this.request<any>('GET', '/services');
      }
    }

    if (!res) throw new Error('Failed to fetch G2Bulk products response');

    const items: any[] = Array.isArray(res) 
      ? res 
      : (res.products || res.data || res.categories || res.items || res.result || []);

    const grouped = new Map<string, G2BulkProduct>();

    for (const item of items) {
      // Determine Product/Category ID
      const rawCatId = item.category_id ?? item.product_id ?? item.game_id ?? item.category ?? item.id;
      const catId = rawCatId !== undefined && rawCatId !== null ? String(rawCatId) : `item_${Math.random().toString(36).substring(2, 7)}`;

      // Determine Product/Category Name
      const catName = 
        item.category_title || 
        item.category_name || 
        item.product_name || 
        item.game_name || 
        item.title || 
        item.name || 
        item.category || 
        `Product #${catId}`;

      // Determine category type (Game vs Gift Card)
      const rawCatStr = String(item.category || item.category_name || item.type || catName).toLowerCase();
      const isGiftCard = rawCatStr.includes('gift') || rawCatStr.includes('card') || rawCatStr.includes('voucher') || rawCatStr.includes('code');
      const categoryType = isGiftCard ? 'Gift Card' : 'Game';

      if (!grouped.has(catId)) {
        grouped.set(catId, {
          productId: catId,
          name: catName,
          status: 'ACTIVE',
          category: categoryType,
          fields: [
            { name: 'player_id', title: 'Player ID / Account', required: true, type: 'string' },
            { name: 'server_id', title: 'Server ID (Optional)', required: false, type: 'string' }
          ],
          skus: []
        });
      }

      const p = grouped.get(catId)!;

      // Determine SKU info
      if (Array.isArray(item.skus) && item.skus.length > 0) {
        for (const skuItem of item.skus) {
          const sId = String(skuItem.id || skuItem.sku || skuItem.sku_id || skuItem.code);
          p.skus.push({
            sku: sId,
            name: skuItem.title || skuItem.name || skuItem.sku_name || `Package #${sId}`,
            price: Number(skuItem.unit_price || skuItem.price || skuItem.cost || skuItem.amount) || 0,
            available: skuItem.stock === null || skuItem.stock === undefined ? true : Number(skuItem.stock) > 0
          });
        }
      } else if (Array.isArray(item.packages) && item.packages.length > 0) {
        for (const skuItem of item.packages) {
          const sId = String(skuItem.id || skuItem.sku || skuItem.sku_id || skuItem.code);
          p.skus.push({
            sku: sId,
            name: skuItem.title || skuItem.name || skuItem.sku_name || `Package #${sId}`,
            price: Number(skuItem.unit_price || skuItem.price || skuItem.cost || skuItem.amount) || 0,
            available: skuItem.stock === null || skuItem.stock === undefined ? true : Number(skuItem.stock) > 0
          });
        }
      } else {
        const skuId = String(item.id || item.sku || item.sku_id || item.code || '1');
        const skuName = item.title || item.name || item.sku_name || item.package_name || catName;
        const skuPrice = Number(item.unit_price || item.price || item.cost || item.amount) || 0;
        const isAvailable = item.stock === null || item.stock === undefined ? true : Number(item.stock) > 0;

        p.skus.push({
          sku: skuId,
          name: skuName,
          price: skuPrice,
          available: isAvailable
        });
      }
    }

    return Array.from(grouped.values());
  }

  public async placeOrder(productId: string, skuId: string, fields: any, callbackUrl?: string) {
    const payload = {
      ...fields,
      callback_url: callbackUrl
    };
    
    // Some products need quantity. We assume 1 for basic items.
    payload.quantity = 1;
    
    // Avoid double mapping fields if they use different names, but we asked for player_id, server_id.
    const res = await this.request<any>('POST', `/products/${encodeURIComponent(skuId)}/purchase`, payload);
    return res;
  }

  public async getOrder(orderId: string) {
    const res = await this.request<any>('GET', `/orders?limit=100`);
    // G2Bulk's /orders endpoint returns a paginated list. Let's see if we can find it.
    if (res.success && Array.isArray(res.data)) {
        const order = res.data.find((o: any) => String(o.order_id || o.id) === String(orderId));
        if (order) return order;
    }
    // Try without parsing, returning null if not found.
    return null;
  }
}
