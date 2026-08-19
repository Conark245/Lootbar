import mongoose, { Document, Model } from 'mongoose';

export interface ITopupRequest extends Document {
  requestId: string;
  telegramChatId: number;
  username?: string;
  firstName?: string;
  amount: number;
  note?: string;
  status: 'pending' | 'approved' | 'rejected';
  processedBy?: string;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const topupRequestSchema = new mongoose.Schema({
  requestId: { type: String, required: true, unique: true, index: true },
  telegramChatId: { type: Number, required: true, index: true },
  username: { type: String },
  firstName: { type: String },
  amount: { type: Number, required: true },
  note: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  processedBy: { type: String },
  processedAt: { type: Date },
}, { timestamps: true });

export const TopupRequest: Model<ITopupRequest> = 
  (mongoose.models.TopupRequest as Model<ITopupRequest>) || 
  mongoose.model<ITopupRequest>('TopupRequest', topupRequestSchema);
