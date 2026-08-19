export interface TopupNationConfig {
  apiKey: string;
  apiSecret: string;
  webhookSecret?: string;
  baseUrl?: string;
  isEnabled?: boolean;
}

export interface TopupNationFieldDefinition {
  name: string;
  title?: string;
  type?: 'string' | 'number' | 'select' | 'text';
  required: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  description?: string;
}

export interface TopupNationSku {
  sku: string;
  name: string;
  price: number;
  currency?: string;
  available?: boolean;
  availability?: boolean;
  minQuantity?: number;
  maxQuantity?: number;
}

export interface TopupNationProduct {
  productId: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' | string;
  category?: string;
  description?: string;
  iconUrl?: string;
  fields: TopupNationFieldDefinition[];
  skus: TopupNationSku[];
  lastSyncedAt?: Date;
}

export interface TopupNationOrderRequest {
  productId: string;
  sku: string;
  userAccount?: string;
  server?: string;
  role?: string | null;
  quantity: number;
  [key: string]: any;
}

export interface TopupNationOrderResponse {
  id: string;
  receiptNumber?: string;
  productId: string;
  sku: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REFUNDED' | string;
  amount?: number;
  currency?: string;
  userAccount?: string;
  server?: string;
  role?: string | null;
  quantity?: number;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TopupNationWalletBalance {
  balance: number;
  currency: string;
  availableBalance?: number;
}

export interface TopupNationWebhookPayload {
  event: 'order.pending' | 'order.processing' | 'order.success' | 'order.failed' | 'order.refunded' | string;
  eventId?: string;
  id?: string;
  timestamp?: number;
  data: {
    id: string;
    receiptNumber?: string;
    productId?: string;
    sku?: string;
    status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REFUNDED' | string;
    amount?: number;
    currency?: string;
    userAccount?: string;
    server?: string;
    role?: string | null;
    quantity?: number;
    errorMessage?: string;
    [key: string]: any;
  };
}
