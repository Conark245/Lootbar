import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  chatId: { type: Number, required: true, unique: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

export const Session = mongoose.model('Session', sessionSchema);
