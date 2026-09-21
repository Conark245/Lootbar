export interface G2BulkConfig {
  apiKey: string;
  baseUrl?: string;
  webhookSecret?: string;
  isEnabled?: boolean;
}

export interface G2BulkFieldDefinition {
  name: string;
  title?: string;
  type?: 'string' | 'number' | 'select' | 'text';
  required: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  description?: string;
}

export interface G2BulkSku {
  sku: string;
  name: string;
  price: number;
  available?: boolean;
}

export interface G2BulkProduct {
  productId: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED' | 'MAINTENANCE' | string;
  category?: string;
  description?: string;
  iconUrl?: string;
  shortKey?: string;
  fields: G2BulkFieldDefinition[];
  skus: G2BulkSku[];
  isEnabled?: boolean;
  lastSyncedAt?: Date;
}
