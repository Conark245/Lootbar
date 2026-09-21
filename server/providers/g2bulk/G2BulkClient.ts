import axios, { AxiosInstance } from 'axios';
import { G2BulkConfig, G2BulkProduct } from './types';

export class G2BulkClient {
  private client: AxiosInstance;
  private apiKey: string;
  private baseUrl: string;

  constructor(config?: G2BulkConfig) {
    this.apiKey = config?.apiKey || process.env.G2BULK_API_KEY || '';
    
    let base = (config?.baseUrl || process.env.G2BULK_BASE_URL || 'https://api.g2bulk.com/v1').trim();
    base = base.replace(/\/+$/, '');
    if (base === 'https://api.g2bulk.com') base = 'https://api.g2bulk.com/v1';
    this.baseUrl = base;

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

  public updateCredentials(config: { apiKey: string; baseUrl?: string }) {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      let base = config.baseUrl.trim().replace(/\/+$/, '');
      if (base === 'https://api.g2bulk.com') base = 'https://api.g2bulk.com/v1';
      this.baseUrl = base;
      this.client.defaults.baseURL = this.baseUrl;
    }
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
    
    try {
      const mergedHeaders = { ...headers, 'X-API-Key': this.apiKey };
      const response = await this.client.request<T>({
        method,
        url: endpoint,
        data,
        headers: mergedHeaders
      });
      return response.data;
    } catch (error: any) {
      if (error.response?.data?.message) {
        throw new Error(`G2Bulk API Error: ${error.response.data.message}`);
      }
      throw error;
    }
  }

  public async getBalance(): Promise<number> {
    const res = await this.request<any>('GET', '/getMe');
    if (!res.success) throw new Error(res.message || 'Failed to fetch balance');
    return Number(res.balance) || 0;
  }

  public async getProducts(): Promise<G2BulkProduct[]> {
    const res = await this.request<any>('GET', '/products');
    if (!res.success) throw new Error(res.message || 'Failed to fetch products');
    
    const items = res.products || [];
    const grouped = new Map<string, G2BulkProduct>();

    for (const item of items) {
      const catId = String(item.category_id);
      
      if (!grouped.has(catId)) {
        grouped.set(catId, {
          productId: catId,
          name: item.category_title || 'Unknown Category',
          status: 'ACTIVE',
          category: 'Game',
          fields: [
            { name: 'player_id', title: 'Player ID', required: true, type: 'string' },
            { name: 'server_id', title: 'Server ID (Optional)', required: false, type: 'string' }
          ],
          skus: []
        });
      }
      
      const p = grouped.get(catId)!;
      p.skus.push({
        sku: String(item.id),
        name: item.title,
        price: Number(item.unit_price) || 0,
        available: item.stock === null ? true : Number(item.stock) > 0
      });
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
