import mongoose, { Document, Model } from 'mongoose';

export interface IOrder extends Document {
  referenceId: string;
  orderId?: string;
  telegramChatId: number;
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
  orderId: { type: String }, // LootBar's platform order number, set once known
  telegramChatId: { type: Number, required: true },
  gameId: { type: String, required: true },
  gameName: { type: String },
  skuId: { type: String, required: true },
  skuName: { type: String },
  playerName: { type: String },
  price: { type: Number, default: 0 },
  extraInfo: { type: mongoose.Schema.Types.Mixed },
  state: { type: Number, default: 1 }, // 1=in transaction, 2=success, 3=failed, 4=settling, 5=partial, 6=cancelled, 7=deleted
}, { timestamps: true });

export const Order: Model<IOrder> = (mongoose.models.Order as Model<IOrder>) || mongoose.model<IOrder>('Order', orderSchema);

