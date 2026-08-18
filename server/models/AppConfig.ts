import mongoose from 'mongoose';

const appConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
});

export const AppConfig = mongoose.models.AppConfig || mongoose.model('AppConfig', appConfigSchema);
