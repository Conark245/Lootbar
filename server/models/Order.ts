import mongoose, { Document, Model } from 'mongoose';

export interface IOrder extends Document {
  referenceId: string;
  orderId?: string;
  telegramChatId: number;
  telegramUsername?: string;
  telegramFirstName?: string;
  telegramLastName?: string;
  provider?: string;
  providerOrderId?: string;
  providerReceiptNumber?: string;
  providerProductId?: string;
  providerSku?: string;
  idempotencyKey?: string;
  statusText?: string;
  gameId: string;
  gameName?: string;
  skuId: string;
  skuName?: string;
  playerName?: string;
  price: number;
  extraInfo?: any;
  state: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const orderSchema = new mongoose.Schema({
  referenceId: { type: String, required: true, unique: true, index: true },
  orderId: { type: String, index: true }, // Platform order number (TopupNation, G2Bulk, etc.)
  telegramChatId: { type: Number, required: true, index: true },
  telegramUsername: { type: String, index: true },
  telegramFirstName: { type: String },
  telegramLastName: { type: String },
  provider: { type: String, default: 'topupnation', index: true },
  providerOrderId: { type: String, index: true },
  providerReceiptNumber: { type: String },
  providerProductId: { type: String },
  providerSku: { type: String },
  idempotencyKey: { type: String, index: true },
  statusText: { type: String },
  gameId: { type: String, required: true },
  gameName: { type: String },
  skuId: { type: String, required: true },
  skuName: { type: String },
  playerName: { type: String },
  price: { type: Number, default: 0 },
  extraInfo: { type: mongoose.Schema.Types.Mixed },
  state: { type: Number, default: 1, index: true }, // 0=pending, 1=in transaction/processing, 2=success, 3=failed, 4=settling, 5=partial, 6=cancelled, 7=refunded
}, { timestamps: true });

orderSchema.index({ createdAt: -1 });
orderSchema.index({ provider: 1, createdAt: -1 });
orderSchema.index({ telegramChatId: 1, createdAt: -1 });
orderSchema.index({ state: 1, provider: 1 });
orderSchema.index({ state: 1, createdAt: -1 });

export const Order: Model<IOrder> = (mongoose.models.Order as Model<IOrder>) || mongoose.model<IOrder>('Order', orderSchema);

