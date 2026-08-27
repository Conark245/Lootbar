import re

with open('server/providers/fzrcards/FzrCardsClient.ts', 'r') as f:
    content = f.read()

# Replace getCategories
get_categories_new = """
  public async getCategories(): Promise<any[]> {
    let allCategories: any[] = [];
    
    // Fetch Topups
    try {
      let cursor: string | null = null;
      let hasMore = true;
      while (hasMore) {
        const url = cursor ? `/topups?cursor=${encodeURIComponent(cursor)}` : '/topups';
        const res = await this.request<any>('GET', url);
        if (res?.items) {
          allCategories = allCategories.concat(res.items.map((i: any) => ({ ...i, _kind: 'topup' })));
        } else if (Array.isArray(res)) {
          allCategories = allCategories.concat(res.map((i: any) => ({ ...i, _kind: 'topup' })));
        }
        
        if (res?.meta?.has_more && res?.meta?.next_cursor) {
          cursor = res.meta.next_cursor;
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
      let hasMore = true;
      while (hasMore) {
        const url = cursor ? `/giftcards?cursor=${encodeURIComponent(cursor)}` : '/giftcards';
        const res = await this.request<any>('GET', url);
        if (res?.items) {
          allCategories = allCategories.concat(res.items.map((i: any) => ({ ...i, _kind: 'gift_card' })));
        } else if (Array.isArray(res)) {
          allCategories = allCategories.concat(res.map((i: any) => ({ ...i, _kind: 'gift_card' })));
        }
        
        if (res?.meta?.has_more && res?.meta?.next_cursor) {
          cursor = res.meta.next_cursor;
        } else {
          hasMore = false;
        }
      }
    } catch (e) {
      console.error('Failed to fetch giftcard categories:', e);
    }
    
    return allCategories;
  }
"""
content = re.sub(r'public async getCategories\(\): Promise<any\[\]> \{.*?^\s*\}' , get_categories_new, content, flags=re.MULTILINE|re.DOTALL)

# Replace getOffers
get_offers_new = """
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
"""
content = re.sub(r'public async getOffers\(categoryId: string\): Promise<\{ offers: any\[\]; fields: any\[\] \}> \{.*?^\s*\}' , get_offers_new, content, flags=re.MULTILINE|re.DOTALL)


# Modify FzrCardsService's getProducts internally? Wait, I need to check `FzrCardsService.ts` syncCatalog to see if it calls `getOffers` correctly.

with open('server/providers/fzrcards/FzrCardsClient.ts', 'w') as f:
    f.write(content)

