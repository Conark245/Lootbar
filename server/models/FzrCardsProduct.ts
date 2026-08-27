import mongoose, { Document, Model } from 'mongoose';
import { FzrCardsFieldDefinition, FzrCardsSku } from '../providers/fzrcards/types';

export interface IFzrCardsProduct extends Document {
  productId: string; // Category ID in FZR Cards
  name: string;
  status: string;
  isEnabled: boolean;
  category?: string;
  description?: string;
  iconUrl?: string;
  fields: FzrCardsFieldDefinition[];
  skus: FzrCardsSku[];
  shortKey?: string;
  skuShortKeys?: Record<string, string>;
  lastSyncedAt: Date;
}

const fzrCardsProductSchema = new mongoose.Schema({
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

export const FzrCardsProduct: Model<IFzrCardsProduct> = 
  (mongoose.models.FzrCardsProduct as Model<IFzrCardsProduct>) || 
  mongoose.model<IFzrCardsProduct>('FzrCardsProduct', fzrCardsProductSchema);
