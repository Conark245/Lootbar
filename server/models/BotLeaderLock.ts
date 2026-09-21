import mongoose, { Document, Model } from 'mongoose';

export interface IBotLeaderLock extends Document {
  lockKey: string;
  instanceId: string;
  lastHeartbeat: Date;
}

const botLeaderLockSchema = new mongoose.Schema({
  lockKey: { type: String, required: true, unique: true, index: true },
  instanceId: { type: String, required: true },
  lastHeartbeat: { type: Date, required: true, default: Date.now, expires: 60 }
});

export const BotLeaderLock: Model<IBotLeaderLock> = 
  (mongoose.models.BotLeaderLock as Model<IBotLeaderLock>) || 
  mongoose.model<IBotLeaderLock>('BotLeaderLock', botLeaderLockSchema);
