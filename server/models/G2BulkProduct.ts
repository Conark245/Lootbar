import mongoose, { Document, Model } from 'mongoose';
import { G2BulkFieldDefinition, G2BulkSku } from '../providers/g2bulk/types';

export interface IG2BulkProduct extends Document {
  productId: string; // Category ID
  name: string;
  status: string;
  isEnabled: boolean;
  category?: string;
  description?: string;
  iconUrl?: string;
  fields: G2BulkFieldDefinition[];
  skus: G2BulkSku[];
  shortKey?: string;
  skuShortKeys?: Record<string, string>;
  lastSyncedAt: Date;
}

const schema = new mongoose.Schema({
  productId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, index: true },
  status: { type: String, default: 'ACTIVE' },
  isEnabled: { type: Boolean, default: true, index: true },
  category: { type: String },
  description: { type: String },
  iconUrl: { type: String },
  fields: { type: Array, default: [] },
  skus: { type: Array, default: [] },
  shortKey: { type: String, trim: true, lowercase: true },
  skuShortKeys: { type: Map, of: String, default: {} },
  lastSyncedAt: { type: Date, default: Date.now }
}, { timestamps: true });

export const G2BulkProduct: Model<IG2BulkProduct> = 
  (mongoose.models.G2BulkProduct as Model<IG2BulkProduct>) || 
  mongoose.model<IG2BulkProduct>('G2BulkProduct', schema);
