import re

with open('server/providers/fzrcards/FzrCardsClient.ts', 'r') as f:
    content = f.read()

create_order_new = """
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
"""

content = re.sub(
    r'public async createOrder\([\s\S]*?const res = await this\.request<any>\(\'POST\', \'/topups/order\', payload, headers\);',
    create_order_new,
    content
)

with open('server/providers/fzrcards/FzrCardsClient.ts', 'w') as f:
    f.write(content)

