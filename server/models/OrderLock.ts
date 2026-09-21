import mongoose, { Document, Model } from 'mongoose';

export interface IOrderLock extends Document {
  lockKey: string;
  telegramChatId: number;
  createdAt: Date;
}

const orderLockSchema = new mongoose.Schema({
  lockKey: { type: String, required: true, unique: true, index: true },
  telegramChatId: { type: Number, required: true, index: true },
  createdAt: { type: Date, default: Date.now, expires: 60 } // Automatically expires after 60 seconds
});

export const OrderLock: Model<IOrderLock> = 
  (mongoose.models.OrderLock as Model<IOrderLock>) || 
  mongoose.model<IOrderLock>('OrderLock', orderLockSchema);
