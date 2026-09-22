import mongoose, { Document, Model } from 'mongoose';

export interface IUser extends Document {
  telegramChatId: number;
  username?: string;
  firstName?: string;
  balance: number;
  balanceMode?: 'wallet' | 'api';
  useDirectApiBalance?: boolean;
  apiProvider?: 'topupnation' | 'g2bulk' | 'both' | 'all';
  notes?: string;
  isAuthorized: boolean;
  receivesNotifications: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const userSchema = new mongoose.Schema({
  telegramChatId: { type: Number, required: true, unique: true, index: true },
  username: { type: String },
  firstName: { type: String },
  balance: { type: Number, default: 0 },
  balanceMode: { type: String, enum: ['wallet', 'api'], default: 'wallet' },
  useDirectApiBalance: { type: Boolean, default: false },
  apiProvider: { type: String, enum: ['topupnation', 'g2bulk', 'both', 'all'], default: 'all' },
  notes: { type: String, default: '' },
  isAuthorized: { type: Boolean, default: false },
  receivesNotifications: { type: Boolean, default: false },
}, { timestamps: true });

export const User: Model<IUser> = (mongoose.models.User as Model<IUser>) || mongoose.model<IUser>('User', userSchema);


