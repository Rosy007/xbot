const mongoose = require('mongoose');

const BotSchema = new mongoose.Schema({
  name: { type: String, required: true },
  apiKeys: {
    gemini: { type: String, select: false },
    openai: { type: String, select: false }
  },
  botIdentity: { type: String, required: true },
  sessionId: { type: String, required: true, unique: true },
  isActive: { type: Boolean, default: false },
  settings: {
    preventGroupResponses: { type: Boolean, default: true },
    maxResponseLength: { type: Number, default: 200 },
    responseDelay: { type: Number, default: 2 }
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Índices para melhor performance
BotSchema.index({ name: 'text', botIdentity: 'text' });
BotSchema.index({ isActive: 1 });

module.exports = mongoose.model('Bot', BotSchema);