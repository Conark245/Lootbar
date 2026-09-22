import mongoose, { Document, Model } from 'mongoose';

export interface IBulkOrderItemResult {
  lineIndex: number;
  rawLine: string;
  provider: 'topupnation' | 'g2bulk';
  gameName: string;
  skuName: string;
  quantity: number;
  price: number;
  playerName?: string;
  success: boolean;
  referenceId?: string;
  orderId?: string;
  statusText?: string;
  error?: string;
  extraInfo?: Record<string, string>;
}

export interface IBulkOrderBatch extends Document {
  batchId: string;
  telegramChatId: number;
  telegramUsername?: string;
  telegramFirstName?: string;
  source: 'bot' | 'web';
  totalRequested: number;
  successCount: number;
  failedCount: number;
  totalSpent: number;
  userBalanceBefore: number;
  userBalanceAfter: number;
  isApiLinked: boolean;
  rawText?: string;
  results: IBulkOrderItemResult[];
  createdAt: Date;
  updatedAt: Date;
}

const bulkOrderItemResultSchema = new mongoose.Schema({
  lineIndex: { type: Number, required: true },
  rawLine: { type: String, required: true },
  provider: { type: String, enum: ['topupnation', 'g2bulk'], default: 'topupnation' },
  gameName: { type: String, required: true },
  skuName: { type: String, required: true },
  quantity: { type: Number, default: 1 },
  price: { type: Number, default: 0 },
  playerName: { type: String },
  success: { type: Boolean, default: false },
  referenceId: { type: String },
  orderId: { type: String },
  statusText: { type: String },
  error: { type: String },
  extraInfo: { type: mongoose.Schema.Types.Mixed }
}, { _id: false });

const bulkOrderBatchSchema = new mongoose.Schema({
  batchId: { type: String, required: true, unique: true, index: true },
  telegramChatId: { type: Number, required: true, index: true },
  telegramUsername: { type: String, index: true },
  telegramFirstName: { type: String },
  source: { type: String, enum: ['bot', 'web'], default: 'bot', index: true },
  totalRequested: { type: Number, default: 0 },
  successCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  userBalanceBefore: { type: Number, default: 0 },
  userBalanceAfter: { type: Number, default: 0 },
  isApiLinked: { type: Boolean, default: false },
  rawText: { type: String },
  results: [bulkOrderItemResultSchema]
}, { timestamps: true });

export const BulkOrderBatch: Model<IBulkOrderBatch> = 
  (mongoose.models.BulkOrderBatch as Model<IBulkOrderBatch>) || 
  mongoose.model<IBulkOrderBatch>('BulkOrderBatch', bulkOrderBatchSchema);
