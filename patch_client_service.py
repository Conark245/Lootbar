import re

with open('server/providers/g2bulk/G2BulkClient.ts', 'r', encoding='utf-8') as f:
    code = f.read()

client_methods = """
  public isConfigured(): boolean {
    return !!this.apiKey;
  }

  public updateCredentials(config: { apiKey: string; baseUrl?: string }) {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      let base = config.baseUrl.trim().replace(/\\/+$/, '');
      if (base === 'https://api.g2bulk.com') base = 'https://api.g2bulk.com/v1';
      this.baseUrl = base;
      this.client.defaults.baseURL = this.baseUrl;
    }
  }
"""
code = code.replace("  public getStatus() {", client_methods + "\n  public getStatus() {")

with open('server/providers/g2bulk/G2BulkClient.ts', 'w', encoding='utf-8') as f:
    f.write(code)

with open('server/providers/g2bulk/G2BulkService.ts', 'r', encoding='utf-8') as f:
    code = f.read()

service_methods = """
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
    const cleanKey = shortKey.trim().toLowerCase().replace(/^\\./, '');
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
"""

code = code.replace("  public async getCatalog() {", service_methods + "\n  public async getCatalog() {")

with open('server/providers/g2bulk/G2BulkService.ts', 'w', encoding='utf-8') as f:
    f.write(code)

