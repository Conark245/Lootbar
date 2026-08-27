export interface FzrCardsConfig {
  apiKey: string;
  baseUrl?: string;
  webhookSecret?: string;
  isEnabled?: boolean;
}

export interface FzrCardsFieldDefinition {
  name: string;
  title?: string;
  type?: 'string' | 'number' | 'select' | 'text';
  required: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  description?: string;
}

export interface FzrCardsSku {
  sku: string;
  name: string;
  price: number;
  currency?: string;
  available?: boolean;
  minQuantity?: number;
  maxQuantity?: number;
  shortKey?: string;
}

export interface FzrCardsProduct {
  productId: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED' | 'MAINTENANCE' | string;
  category?: string;
  description?: string;
  iconUrl?: string;
  shortKey?: string;
  fields: FzrCardsFieldDefinition[];
  skus: FzrCardsSku[];
  isEnabled?: boolean;
  lastSyncedAt?: Date;
}

export interface FzrCardsValidateIdRequest {
  categoryId: string;
  fields: Record<string, any>;
}

export interface FzrCardsValidateIdResponse {
  valid: boolean;
  name?: string;
  region?: string;
  message?: string;
  raw?: any;
}

export interface FzrCardsOrderRequest {
  categoryId: string;
  offerId: string;
  fields: Record<string, any>;
  quantity?: number;
}

export interface FzrCardsOrderResponse {
  id: string;
  orderId?: string;
  referenceId?: string;
  categoryId: string;
  offerId: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'CANCELLED' | string;
  amount?: number;
  currency?: string;
  userAccount?: string;
  playerName?: string;
  quantity?: number;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
  raw?: any;
}

export interface FzrCardsWalletBalance {
  balance: number;
  currency: string;
  availableBalance?: number;
}

export interface FzrCardsProfile {
  login?: string;
  email?: string;
  plan?: string;
  balance?: number;
  currency?: string;
  totalSpent?: number;
  totalOrders?: number;
}

export interface FzrCardsWebhookPayload {
  event: 'order.completed' | 'order.failed' | 'order.refunded' | 'order.processing' | 'order.created' | string;
  id?: string;
  timestamp?: number;
  data: {
    id: string;
    orderId?: string;
    categoryId?: string;
    offerId?: string;
    status: string;
    amount?: number;
    currency?: string;
    fields?: Record<string, any>;
    errorMessage?: string;
    [key: string]: any;
  };
}
