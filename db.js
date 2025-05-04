const mongoose = require('mongoose');

module.exports = async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp-bot-manager', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Conectado ao MongoDB');
  } catch (error) {
    console.error('Erro na conexão com MongoDB:', error);
    process.exit(1);
  }
};