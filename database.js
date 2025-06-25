const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const bcrypt = require('bcryptjs');

// Configuração do Sequelize
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'database.sqlite'),
  logging: console.log,
  define: {
    timestamps: true,
    underscored: true,
    paranoid: true
  }
});

// Modelo User
const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true,
      len: [3, 50]
    }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [6, 100]
    }
  },
  isAdmin: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  isClient: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  lastLogin: {
    type: DataTypes.DATE
  }
}, {
  hooks: {
    beforeCreate: async (user) => {
      if (user.password) {
        user.password = await bcrypt.hash(user.password, 10);
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        user.password = await bcrypt.hash(user.password, 10);
      }
    }
  }
});

// Modelo Bot
const Bot = sequelize.define('Bot', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [2, 100]
    }
  },
  description: {
    type: DataTypes.TEXT
  },
  botIdentity: {
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: 'Você é um assistente virtual útil e prestativo. Responda de forma natural e humana.'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  sessionId: {
    type: DataTypes.STRING,
    unique: true
  },
  settings: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {
      autoReply: true,
      defaultReply: 'Obrigado por sua mensagem. Em breve responderemos.',
      preventGroupResponses: true,
      typingIndicator: true,
      typingDuration: 2,
      responseDelay: 2,
      maxResponseLength: 200,
      humanControlTimeout: 30,
      humanLikeBehavior: {
        typingVariance: 0.3,
        responseVariance: 0.2,
        mistakeRate: 0.05,
        maxSynonyms: 3,
        minDelayBetweenMessages: 1000,
        maxDelayBetweenMessages: 5000,
        maxMessagesPerHour: 100,
        maxMessagesPerDay: 500,
        greetings: [
          "Olá! Como posso ajudar?",
          "Oi! Tudo bem?",
          "Bom dia! Em que posso ajudar?",
          "Boa tarde! Como vai?",
          "Boa noite! Como posso ajudar?"
        ],
        farewells: [
          "Até logo!",
          "Tchau!",
          "Foi um prazer ajudar!",
          "Volte sempre!"
        ]
      },
      redisConfig: {
        enableMemory: true,
        ttl: 86400, // 24 horas
        conversationHistorySize: 50
      },
      scheduling: {
        enabled: true,
        maxScheduledMessages: 50,
        defaultTimezone: 'America/Sao_Paulo'
      }
    }
  },
  apiKeys: {
    type: DataTypes.JSON,
    defaultValue: {
      gemini: '',
      openai: ''
    }
  },
  metadata: {
    type: DataTypes.JSON,
    defaultValue: {}
  }
}, {
  hooks: {
    beforeCreate: (bot) => {
      if (!bot.sessionId) {
        bot.sessionId = `session_${Date.now()}`;
      }
    }
  }
});

// Modelo Plan
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
    type: DataTypes.TEXT
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  duration: {
    type: DataTypes.INTEGER, // em dias
    allowNull: false
  },
  features: {
    type: DataTypes.JSON,
    defaultValue: {
      maxBots: 1,
      maxMessages: 1000,
      support: 'basic',
      analytics: false
    }
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
});

// Modelo Client
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
  address: {
    type: DataTypes.TEXT
  },
  notes: {
    type: DataTypes.TEXT
  }
});

// Modelo Subscription
const Subscription = sequelize.define('Subscription', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  startDate: {
    type: DataTypes.DATE,
    allowNull: false
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
  },
  transactionId: {
    type: DataTypes.STRING
  }
});

// Modelo ScheduledMessage
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
  scheduledAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  sentAt: {
    type: DataTypes.DATE
  },
  status: {
    type: DataTypes.ENUM('pending', 'sent', 'failed', 'canceled'),
    defaultValue: 'pending'
  },
  attemptCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
});

// Definição das relações
User.hasOne(Client, { foreignKey: 'userId' });
Client.belongsTo(User, { foreignKey: 'userId' });

Client.hasMany(Subscription, { foreignKey: 'clientId' });
Subscription.belongsTo(Client, { foreignKey: 'clientId' });

Subscription.belongsTo(Plan, { foreignKey: 'planId' });
Plan.hasMany(Subscription, { foreignKey: 'planId' });

Subscription.hasMany(Bot, { foreignKey: 'subscriptionId' });
Bot.belongsTo(Subscription, { foreignKey: 'subscriptionId' });

Bot.hasMany(ScheduledMessage, { foreignKey: 'botId' });
ScheduledMessage.belongsTo(Bot, { foreignKey: 'botId' });

// Função para sincronizar o banco de dados
async function syncDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Conexão com o banco de dados estabelecida com sucesso.');

    // Sincronizar modelos com o banco de dados
    await sequelize.sync({ alter: true });
    console.log('Modelos sincronizados com o banco de dados.');

    // Criar admin padrão se não existir
    const adminCount = await User.count({ where: { isAdmin: true } });
    if (adminCount === 0) {
      await User.create({
        username: 'admin',
        password: 'admin123',
        isAdmin: true
      });
      console.log('Usuário admin padrão criado (admin:admin123)');
    }

    // Criar plano básico se não existir
    const planCount = await Plan.count();
    if (planCount === 0) {
      await Plan.create({
        name: 'Básico',
        description: 'Plano básico com recursos essenciais',
        price: 99.90,
        duration: 30,
        features: {
          maxBots: 1,
          maxMessages: 1000,
          support: 'basic',
          analytics: false
        }
      });
      console.log('Plano básico criado automaticamente');
    }
  } catch (error) {
    console.error('Erro ao sincronizar banco de dados:', error);
    process.exit(1);
  }
}

module.exports = {
  sequelize,
  User,
  Bot,
  Plan,
  Client,
  Subscription,
  ScheduledMessage,
  syncDatabase
};
