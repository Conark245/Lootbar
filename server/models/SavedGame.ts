import mongoose from 'mongoose';

const savedGameSchema = new mongoose.Schema({
  gameId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  savedAt: { type: Date, default: Date.now }
});

export const SavedGame = mongoose.models.SavedGame || mongoose.model('SavedGame', savedGameSchema);
