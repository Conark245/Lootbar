import mongoose, { Document, Model } from 'mongoose';

export interface ISavedGame extends Document {
  gameId: string;
  name: string;
  shortKey?: string;
  isEnabled: boolean;
  savedAt: Date;  lastKnownSkus?: any[];
}

const savedGameSchema = new mongoose.Schema({
  gameId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  shortKey: { type: String, trim: true, lowercase: true },
  isEnabled: { type: Boolean, default: true, index: true },
  savedAt: { type: Date, default: Date.now },  lastKnownSkus: { type: Array, default: [] }
});

export const SavedGame: Model<ISavedGame> = (mongoose.models.SavedGame as Model<ISavedGame>) || mongoose.model<ISavedGame>('SavedGame', savedGameSchema);


