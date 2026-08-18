import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  referenceId: { type: String, required: true, unique: true, index: true },
  orderId: { type: String }, // LootBar's platform order number, set once known
  telegramChatId: { type: Number, required: true },
  gameId: { type: String, required: true },
  skuId: { type: String, required: true },
  extraInfo: { type: mongoose.Schema.Types.Mixed },
  state: { type: Number, default: 1 }, // 1=in transaction, 2=success, 3=failed, 4=settling, 5=partial, 6=cancelled, 7=deleted
}, { timestamps: true });

export const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
