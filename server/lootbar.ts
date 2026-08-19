import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';

export class LootBarClient {
  private nickname: string;
  private email: string;
  private password: string;
  private baseUrl: string;
  private callbackBaseUrl?: string;
  
  private token: string | null = null;
  public callbackKey: string | null = null;
  private expireAt: number = 0;
  
  private client: AxiosInstance;
  private authPromise: Promise<void> | null = null;

  constructor(nickname: string, email: string, password: string, baseUrl: string = "https://api.lootbar.gg", callbackBaseUrl?: string) {
    this.nickname = nickname;
    this.email = email;
    this.password = password;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.callbackBaseUrl = callbackBaseUrl ? callbackBaseUrl.replace(/\/$/, '') : undefined;
    this.client = axios.create({ baseURL: this.baseUrl });
  }

  public updateCredentials(nickname: string, email: string, password: string) {
    this.nickname = nickname;
    this.email = email;
    this.password = password;
    this.token = null;
    this.callbackKey = null;
    this.expireAt = 0;
  }

  public isConfigured(): boolean {
    return !!(this.nickname && this.email && this.password);
  }

  private async ensureAuth(): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error("LootBar credentials are not configured. Please log in first.");
    }

    const currentTime = Math.floor(Date.now() / 1000);
    
    // If token is valid and not expiring within 60 seconds, return
    if (this.token && currentTime < this.expireAt - 60) {
      return;
    }

    // Prevent concurrent login requests
    if (!this.authPromise) {
      this.authPromise = this.login().finally(() => {
        this.authPromise = null;
      });
    }
    return this.authPromise;
  }

  public async testLogin(): Promise<void> {
    await this.login();
  }

  private async login(): Promise<void> {
    if (!this.nickname || !this.email || !this.password) {
      throw new Error("LootBar nickname, email, and password are required.");
    }

    try {
      const response = await this.client.post('/api/reseller/login', {
        nickname: this.nickname,
        email: this.email,
        password: this.password
      });
      
      if (response.data?.status && response.data.status !== 'ok' && response.data.status !== 'Success') {
        throw new Error(response.data.msg || "Failed to login to LootBar API");
      }
      
      if (response.data && response.data.data) {
        this.token = response.data.data.token;
        this.callbackKey = response.data.data.callback_key;
        this.expireAt = response.data.data.expire_at;
      } else {
        throw new Error(response.data?.msg || "Invalid response format from LootBar API");
      }
    } catch (error: any) {
      if (error.response?.data?.msg) {
        throw new Error(error.response.data.msg);
      }
      if (error.response?.status === 404) {
        throw new Error("LootBar API endpoint returned 404. Please verify LootBar service status or credentials.");
      }
      throw error;
    }
  }

  private async request(method: string, endpoint: string, data?: any): Promise<any> {
    await this.ensureAuth();
    
    try {
      const response = await this.client.request({
        method,
        url: endpoint,
        data,
        headers: {
          'authorization': `PS ${this.token}`
        }
      });
      
      if (response.data?.status && response.data.status !== 'ok' && response.data.status !== 'Success') {
        throw new Error(response.data.msg || `LootBar API Error on ${endpoint}`);
      }
      
      return response.data;
    } catch (error: any) {
      if (error.response?.data?.msg) {
        throw new Error(error.response.data.msg);
      }
      if (error.response?.status === 404) {
        throw new Error(`LootBar API ${endpoint} returned 404 Not Found.`);
      }
      throw error;
    }
  }

  async getGames(pageNum: number = 1, pageSize: number = 100): Promise<any> {
    return this.request('GET', `/api/reseller/games?page_num=${pageNum}&page_size=${pageSize}`);
  }

  async getSkus(gameId: string): Promise<any> {
    return this.request('GET', `/api/reseller/skus?game_id=${gameId}`);
  }

  async createOrder(referenceId: string, gameId: string, skuId: string, quantity: number, extraInfo: Record<string, string>): Promise<any> {
    return this.request('POST', '/api/reseller/create_order', {
      reference_id: referenceId,
      game_id: gameId,
      product: [{ sku_id: skuId, num: quantity }],
      extra_info: extraInfo,
      callback_url: this.callbackBaseUrl || undefined
    });
  }

  async queryOrder(referenceId: string): Promise<any> {
    return this.request('POST', '/api/reseller/query_order', { reference_id: referenceId });
  }

  async queryAsset(): Promise<any> {
    return this.request('GET', '/api/reseller/query_asset');
  }

  async checkRole(gameId: string, extraInfo: Record<string, string>): Promise<{ success: boolean; playerName?: string; error?: string }> {
    try {
      const res = await this.request('POST', '/api/reseller/check_role', {
        game_id: gameId,
        extra_info: extraInfo
      });
      const name = res?.data?.role_name || res?.data?.nickname || res?.data?.player_name || res?.data?.name;
      if (name) {
        return { success: true, playerName: String(name) };
      }
      return { success: false, error: res?.msg || 'Player not found for this ID' };
    } catch (err: any) {
      try {
        const query = new URLSearchParams({ game_id: gameId, ...extraInfo }).toString();
        const res = await this.request('GET', `/api/reseller/check_role?${query}`);
        const name = res?.data?.role_name || res?.data?.nickname || res?.data?.player_name || res?.data?.name;
        if (name) {
          return { success: true, playerName: String(name) };
        }
      } catch (getErr: any) {
        return { success: false, error: err?.message || getErr?.message || 'Player ID verification failed' };
      }
      return { success: false, error: err?.message || 'Player not found for this ID' };
    }
  }

  verifyWebhookSignature(method: string, pathQuery: string, body: string, signature: string): boolean {
    if (!this.callbackKey) return false;
    
    const signatureBase = method.toUpperCase() + pathQuery + body + this.callbackKey;
    const expectedSignature = crypto.createHash('sha1').update(signatureBase, 'utf8').digest('hex');
    
    return signature === expectedSignature;
  }
}
