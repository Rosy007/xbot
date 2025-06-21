const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const bcrypt = require('bcryptjs');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'database.sqlite'),
  logging: console.log
});

// Modelo de Plano
const Plan = sequelize.define('Plan', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  price: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
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
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
});

// Modelo de Assinatura
const Subscription = sequelize.define('Subscription', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  startDate: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  endDate: {
    type: DataTypes.DATE,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('active', 'pending', 'canceled', 'expired'),
    defaultValue: 'active'
  },
  paymentMethod: {
    type: DataTypes.STRING
  }
});

// Modelo de Cliente
const Client = sequelize.define('Client', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  phone: {
    type: DataTypes.STRING
  },
  company: {
    type: DataTypes.STRING
  },
  notes: {
    type: DataTypes.TEXT
  }
});

// Modelo de Usuário
const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  isAdmin: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  isClient: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
});

// Modelo de Bot
const Bot = sequelize.define('Bot', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  apiKeys: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  },
  botIdentity: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  sessionId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  lastStartedAt: {
    type: DataTypes.DATE
  },
  lastStoppedAt: {
    type: DataTypes.DATE
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
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
  startDate: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  endDate: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  },
  sharedWith: {
    type: DataTypes.JSON,
    defaultValue: []
  }
});

// Modelo de Mensagem Agendada
const ScheduledMessage = sequelize.define('ScheduledMessage', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  recipient: {
    type: DataTypes.STRING,
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  scheduledTime: {
    type: DataTypes.DATE,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('pending', 'sent', 'failed', 'canceled'),
    defaultValue: 'pending'
  },
  sentAt: {
    type: DataTypes.DATE
  }
});

// Relacionamentos
User.hasOne(Client);
Client.belongsTo(User);

Client.hasMany(Subscription);
Subscription.belongsTo(Client);

Plan.hasMany(Subscription);
Subscription.belongsTo(Plan);

Subscription.hasMany(Bot);
Bot.belongsTo(Subscription);

Bot.hasMany(ScheduledMessage);
ScheduledMessage.belongsTo(Bot);

// Hooks para hash de senha
User.beforeCreate(async (user) => {
  if (user.password && !user.password.startsWith('$2a') && !user.password.startsWith('$2b')) {
    user.password = await bcrypt.hash(user.password, 10);
  }
});

User.beforeUpdate(async (user) => {
  if (user.changed('password') && !user.password.startsWith('$2a') && !user.password.startsWith('$2b')) {
    user.password = await bcrypt.hash(user.password, 10);
  }
});

// Método para verificar senha
User.prototype.validatePassword = async function(password) {
  return await bcrypt.compare(password, this.password);
};

// Sincronizar modelos com o banco de dados
(async () => {
  try {
    await sequelize.sync({ force: false, alter: true });
    console.log('Modelos sincronizados com o banco de dados.');
    
    // Criar admin padrão apenas se não existir
    const adminCount = await User.count({ where: { isAdmin: true } });
    if (adminCount === 0) {
      const admin = await User.create({
        username: 'admin',
        password: await bcrypt.hash('admin123', 10),
        isAdmin: true
      });
      console.log('Admin criado:', admin.username);
      
      // Criar planos padrão
      await Plan.bulkCreate([
        {
          name: 'Básico',
          description: 'Plano básico para pequenos negócios',
          price: 49.90,
          features: {
            maxBots: 1,
            maxMessagesPerDay: 500,
            apiAccess: false,
            scheduling: false,
            analytics: false
          }
        },
        {
          name: 'Profissional',
          description: 'Plano profissional para médias empresas',
          price: 99.90,
          features: {
            maxBots: 3,
            maxMessagesPerDay: 2000,
            apiAccess: true,
            scheduling: true,
            analytics: true
          }
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
      console.log('Planos padrão criados');
    }
  } catch (error) {
    console.error('Erro ao sincronizar modelos:', error);
  }
})();

module.exports = {
  sequelize,
  Bot,
  User,
  Plan,
  Client,
  Subscription,
  ScheduledMessage
};
