import mongoose, { Document, Model } from 'mongoose';

export interface IAppConfig extends Document {
  key: string;
  value: any;
}

const appConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
});

export const AppConfig: Model<IAppConfig> = (mongoose.models.AppConfig as Model<IAppConfig>) || mongoose.model<IAppConfig>('AppConfig', appConfigSchema);

