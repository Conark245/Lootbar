import mongoose, { Document, Model } from 'mongoose';
import { TopupNationFieldDefinition, TopupNationSku } from '../providers/topupnation/types';

export interface ITopupNationProduct extends Document {
  productId: string;
  name: string;
  status: string;
  isEnabled: boolean;
  category?: string;
  description?: string;
  iconUrl?: string;
  fields: TopupNationFieldDefinition[];
  skus: TopupNationSku[];
  shortKey?: string;
  skuShortKeys?: Record<string, string>;
  lastSyncedAt: Date;
}

const topupNationProductSchema = new mongoose.Schema({
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

export const TopupNationProduct: Model<ITopupNationProduct> = 
  (mongoose.models.TopupNationProduct as Model<ITopupNationProduct>) || 
  mongoose.model<ITopupNationProduct>('TopupNationProduct', topupNationProductSchema);
