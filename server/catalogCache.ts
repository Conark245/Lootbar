import { TopupNationProduct, ITopupNationProduct } from './models/TopupNationProduct';
import { G2BulkProduct, IG2BulkProduct } from './models/G2BulkProduct';

export interface CachedProduct {
  provider: 'topupnation' | 'g2bulk';
  productId: string;
  name: string;
  status: string;
  isEnabled: boolean;
  category?: string;
  description?: string;
  iconUrl?: string;
  fields: any[];
  skus: any[];
  shortKey?: string;
  skuShortKeys?: Record<string, string>;
  lastSyncedAt?: Date;
}

class ProductCatalogCache {
  private tpnProducts: ITopupNationProduct[] = [];
  private g2bProducts: IG2BulkProduct[] = [];
  private shortKeyMap: Map<string, CachedProduct> = new Map();
  private productIdMap: Map<string, CachedProduct> = new Map();
  private lastFetched: number = 0;
  private isRefreshing: boolean = false;
  private TTL_MS = 25000; // 25s background TTL

  public async refresh(force: boolean = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastFetched < this.TTL_MS) {
      return;
    }
    if (this.isRefreshing) return;
    this.isRefreshing = true;

    try {
      const [tpn, g2b] = await Promise.all([
        TopupNationProduct.find({ isEnabled: { $ne: false }, status: { $ne: 'DISABLED' } }).lean().exec(),
        G2BulkProduct.find({ isEnabled: { $ne: false }, status: { $ne: 'DISABLED' } }).lean().exec()
      ]);

      this.tpnProducts = tpn as any;
      this.g2bProducts = g2b as any;

      const newShortKeyMap = new Map<string, CachedProduct>();
      const newProductIdMap = new Map<string, CachedProduct>();

      for (const p of this.tpnProducts) {
        const item: CachedProduct = {
          provider: 'topupnation',
          productId: String(p.productId),
          name: p.name,
          status: p.status,
          isEnabled: p.isEnabled !== false,
          category: p.category,
          description: p.description,
          iconUrl: p.iconUrl,
          fields: p.fields || [],
          skus: p.skus || [],
          shortKey: p.shortKey,
          skuShortKeys: p.skuShortKeys ? (p.skuShortKeys instanceof Map ? Object.fromEntries(p.skuShortKeys) : p.skuShortKeys) : {},
          lastSyncedAt: p.lastSyncedAt
        };

        const defaultSk = `t${String(p.productId).slice(0, 4)}`.toLowerCase();
        const activeSk = (p.shortKey || defaultSk).toLowerCase();
        newShortKeyMap.set(activeSk, item);
        newProductIdMap.set(`tpn_${String(p.productId).toLowerCase()}`, item);
        newProductIdMap.set(String(p.productId).toLowerCase(), item);
      }

      for (const p of this.g2bProducts) {
        const item: CachedProduct = {
          provider: 'g2bulk',
          productId: String(p.productId),
          name: p.name,
          status: p.status,
          isEnabled: p.isEnabled !== false,
          category: p.category,
          description: p.description,
          iconUrl: p.iconUrl,
          fields: p.fields || [],
          skus: p.skus || [],
          shortKey: p.shortKey,
          skuShortKeys: p.skuShortKeys ? (p.skuShortKeys instanceof Map ? Object.fromEntries(p.skuShortKeys) : p.skuShortKeys) : {},
          lastSyncedAt: p.lastSyncedAt
        };

        const defaultSk = `g${String(p.productId).slice(0, 4)}`.toLowerCase();
        const activeSk = (p.shortKey || defaultSk).toLowerCase();
        newShortKeyMap.set(activeSk, item);
        newProductIdMap.set(`g2b_${String(p.productId).toLowerCase()}`, item);
        if (!newProductIdMap.has(String(p.productId).toLowerCase())) {
          newProductIdMap.set(String(p.productId).toLowerCase(), item);
        }
      }

      this.shortKeyMap = newShortKeyMap;
      this.productIdMap = newProductIdMap;
      this.lastFetched = Date.now();
    } catch (err: any) {
      console.warn('[CatalogCache] Cache refresh warning:', err?.message || err);
    } finally {
      this.isRefreshing = false;
    }
  }

  public async getProductByShortKey(key: string): Promise<CachedProduct | null> {
    await this.refresh();
    const cleanKey = key.trim().toLowerCase();
    return this.shortKeyMap.get(cleanKey) || null;
  }

  public async getProductById(productId: string, provider?: 'topupnation' | 'g2bulk'): Promise<CachedProduct | null> {
    await this.refresh();
    const cleanId = productId.trim().toLowerCase();
    if (provider) {
      const prefix = provider === 'topupnation' ? 'tpn_' : 'g2b_';
      const match = this.productIdMap.get(`${prefix}${cleanId}`);
      if (match) return match;
    }
    return this.productIdMap.get(cleanId) || null;
  }

  public async getAllEnabledProducts(): Promise<{ tpn: CachedProduct[]; g2b: CachedProduct[] }> {
    await this.refresh();
    const tpn: CachedProduct[] = [];
    const g2b: CachedProduct[] = [];
    for (const item of this.shortKeyMap.values()) {
      if (item.provider === 'topupnation') tpn.push(item);
      else g2b.push(item);
    }
    return { tpn, g2b };
  }

  public invalidate(): void {
    this.lastFetched = 0;
    this.refresh(true).catch(() => {});
  }
}

export const catalogCache = new ProductCatalogCache();
