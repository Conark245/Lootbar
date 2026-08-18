import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  telegramChatId: { type: Number, required: true, unique: true, index: true },
  balance: { type: Number, default: 0 },
  isAuthorized: { type: Boolean, default: false },
  receivesNotifications: { type: Boolean, default: false },
}, { timestamps: true });

export const User = mongoose.models.User || mongoose.model('User', userSchema);
