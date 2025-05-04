const mongoose = require('mongoose');

const MessageLogSchema = new mongoose.Schema({
  bot: { type: mongoose.Schema.Types.ObjectId, ref: 'Bot', required: true },
  contact: { type: String, required: true },
  direction: { type: String, enum: ['incoming', 'outgoing'], required: true },
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

// Índices para consultas rápidas
MessageLogSchema.index({ bot: 1, timestamp: -1 });
MessageLogSchema.index({ contact: 1 });

module.exports = mongoose.model('MessageLog', MessageLogSchema);