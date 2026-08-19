import mongoose, { Document, Model } from 'mongoose';

export interface ITopupNationWebhookEvent extends Document {
  eventId: string;
  eventType: string;
  orderId?: string;
  payload: any;
  processedAt: Date;
}

const topupNationWebhookEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, index: true },
  eventType: { type: String, required: true },
  orderId: { type: String, index: true },
  payload: { type: mongoose.Schema.Types.Mixed },
  processedAt: { type: Date, default: Date.now }
}, { timestamps: true });

export const TopupNationWebhookEvent: Model<ITopupNationWebhookEvent> = 
  (mongoose.models.TopupNationWebhookEvent as Model<ITopupNationWebhookEvent>) || 
  mongoose.model<ITopupNationWebhookEvent>('TopupNationWebhookEvent', topupNationWebhookEventSchema);
