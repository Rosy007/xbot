const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const fs = require('fs');

// Configuração do Sequelize
const dbPath = path.join(__dirname, 'database.sqlite');

// Remove o banco antigo (opcional, cuidado em produção)
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log('🗑️ Banco de dados antigo removido');
}

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: console.log
});

// MODELOS

const Plan = sequelize.define('Plan', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: false },
  price: { type: DataTypes.FLOAT, allowNull: false },
  features: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {
      maxBots: 1,
      maxMessagesPerDay: 1000,
      apiAccess: false,
      scheduling: false,
      analytics: false,
      prioritySupport: false,
      customBranding: false
    }
  },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
});

const Subscription = sequelize.define('Subscription', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  startDate: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  endDate: { type: DataTypes.DATE, allowNull: false },
  status: { type: DataTypes.ENUM('active', 'pending', 'canceled', 'expired'), defaultValue: 'active' },
  paymentMethod: { type: DataTypes.STRING }
});

const Client = sequelize.define('Client', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  phone: { type: DataTypes.STRING },
  company: { type: DataTypes.STRING },
  notes: { type: DataTypes.TEXT }
});

const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  username: { type: DataTypes.STRING, allowNull: false, unique: true },
  password: { type: DataTypes.STRING, allowNull: false },
  isAdmin: { type: DataTypes.BOOLEAN, defaultValue: false },
  isClient: { type: DataTypes.BOOLEAN, defaultValue: false }
});

const Bot = sequelize.define('Bot', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  name: { type: DataTypes.STRING, allowNull: false },
  apiKeys: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  botIdentity: { type: DataTypes.TEXT, allowNull: false },
  sessionId: { type: DataTypes.STRING },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: false },
  settings: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {
      preventGroupResponses: true,
      maxResponseLength: 200,
      responseDelay: 2,
      typingIndicator: true,
      typingDuration: 2,
      humanControlTimeout: 30,
      maxMessagesPerHour: 20,
      minResponseDelay: 1,
      maxResponseDelay: 5,
      typingVariance: 0.5,
      humanLikeMistakes: 0.05,
      conversationCooldown: 300,
      allowScheduling: false,
      maxScheduledMessages: 10
    }
  },
  startDate: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  endDate: { type: DataTypes.DATE, allowNull: false, defaultValue: () => moment().add(30, 'days').toDate() },
  sharedWith: { type: DataTypes.JSON, defaultValue: [] }
});

const ScheduledMessage = sequelize.define('ScheduledMessage', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  recipient: { type: DataTypes.STRING, allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  scheduledTime: { type: DataTypes.DATE, allowNull: false },
  status: { type: DataTypes.ENUM('pending', 'sent', 'failed', 'canceled'), defaultValue: 'pending' },
  sentAt: { type: DataTypes.DATE }
});

// RELACIONAMENTOS

User.hasOne(Client, { foreignKey: 'userId', onDelete: 'CASCADE' });
Client.belongsTo(User, { foreignKey: 'userId' });

Client.hasMany(Subscription, { foreignKey: 'clientId', onDelete: 'CASCADE' });
Subscription.belongsTo(Client, { foreignKey: 'clientId' });

Plan.hasMany(Subscription, { foreignKey: 'planId' });
Subscription.belongsTo(Plan, { foreignKey: 'planId' });

Subscription.hasMany(Bot, { foreignKey: 'subscriptionId', onDelete: 'CASCADE' });
Bot.belongsTo(Subscription, { foreignKey: 'subscriptionId' });

Bot.hasMany(ScheduledMessage, { foreignKey: 'botId', onDelete: 'CASCADE' });
ScheduledMessage.belongsTo(Bot, { foreignKey: 'botId' });

// HOOKS

User.beforeCreate(async (user) => {
  if (user.password) {
    user.password = await bcrypt.hash(user.password, 10);
  }
});

User.beforeUpdate(async (user) => {
  if (user.changed('password')) {
    user.password = await bcrypt.hash(user.password, 10);
  }
});

User.prototype.validatePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

// ✅ FUNÇÃO PARA INICIALIZAR O BANCO

async function initDatabase() {
  try {
    console.log('🔄 Iniciando sincronização do banco de dados...');
    await sequelize.sync({ force: true }); // use { alter: true } em produção
    console.log('✅ Estrutura do banco criada com sucesso');

    const adminExists = await User.findOne({ where: { username: 'admin' } });
    if (!adminExists) {
      await User.create({
        username: 'admin',
        password: 'admin123',
        isAdmin: true
      });
      console.log('👑 Admin criado: admin');
    }

    const planCount = await Plan.count();
    if (planCount === 0) {
      await Plan.bulkCreate([
        {
          name: 'Básico',
          description: 'Plano básico para pequenos negócios',
          price: 49.90,
          features: { maxBots: 1, maxMessagesPerDay: 500, apiAccess: false, scheduling: false, analytics: false }
        },
        {
          name: 'Profissional',
          description: 'Plano profissional para médias empresas',
          price: 99.90,
          features: { maxBots: 3, maxMessagesPerDay: 2000, apiAccess: true, scheduling: true, analytics: true }
        },
        {
          name: 'Enterprise',
          description: 'Plano completo para grandes empresas',
          price: 199.90,
          features: {
            maxBots: 10,
            maxMessagesPerDay: 10000,
            apiAccess: true,
            scheduling: true,
            analytics: true,
            prioritySupport: true,
            customBranding: true
          }
        }
      ]);
      console.log('📊 Planos padrão criados');
    }

    console.log('🚀 Banco de dados pronto!');
  } catch (err) {
    console.error('❌ Erro ao inicializar banco:', err);
    throw err;
  }
}

// EXPORTAÇÃO

module.exports = {
  sequelize,
  Bot,
  User,
  Plan,
  Client,
  Subscription,
  ScheduledMessage,
  initDatabase // <-- função que o server.js vai usar
};
