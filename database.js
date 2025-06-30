const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'database.sqlite'),
  logging: console.log
});

(async () => {
  try {
    await sequelize.authenticate();
    console.log('Conexão com o banco de dados estabelecida com sucesso.');
  } catch (error) {
    console.error('Não foi possível conectar ao banco de dados:', error);
  }
})();

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
  duration: {
    type: DataTypes.INTEGER, // Duração em dias
    allowNull: false
  },
  maxBots: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  features: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
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
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'suspended'),
    defaultValue: 'active'
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
    type: DataTypes.ENUM('active', 'canceled', 'expired'),
    defaultValue: 'active'
  },
  paymentMethod: {
    type: DataTypes.STRING
  },
  lastPaymentDate: {
    type: DataTypes.DATE
  },
  nextPaymentDate: {
    type: DataTypes.DATE
  }
});

// Modelo de Usuário (atualizado)
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
  isClientAdmin: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  clientId: {
    type: DataTypes.UUID,
    references: {
      model: 'Clients',
      key: 'id'
    }
  }
});

// Modelo de Bot (atualizado)
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
    allowNull: false
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
      responseDelay: 3,
      typingIndicator: true,
      typingDuration: 3,
      humanControlTimeout: 30,
      messagesPerMinute: 5,
      responseVariation: 0.3,
      typingVariation: 0.8,
      avoidRepetition: true,
      humanErrorProbability: 0.1
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
  },
  stats: {
    type: DataTypes.JSON,
    defaultValue: {
      messagesSent: 0,
      messagesReceived: 0,
      lastActivity: null
    }
  },
  deviceInfo: {
    type: DataTypes.JSON,
    defaultValue: {
      manufacturer: 'Google',
      model: 'Pixel 6',
      osVersion: '13.0.0',
      waVersion: '2.23.7.74'
    }
  },
  clientId: {
    type: DataTypes.UUID,
    references: {
      model: 'Clients',
      key: 'id'
    }
  }
});

const Appointment = sequelize.define('Appointment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  botId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  contact: {
    type: DataTypes.STRING,
    allowNull: false
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  appointmentDate: {
    type: DataTypes.DATE,
    allowNull: false
  },
  remindedOneDayBefore: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  remindedOneHourBefore: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  status: {
    type: DataTypes.ENUM('pending', 'confirmed', 'canceled'),
    defaultValue: 'pending'
  }
});

// Relacionamentos
Bot.hasMany(Appointment, { foreignKey: 'botId' });
Appointment.belongsTo(Bot, { foreignKey: 'botId' });

Client.hasMany(User, { foreignKey: 'clientId' });
User.belongsTo(Client, { foreignKey: 'clientId' });

Client.hasMany(Bot, { foreignKey: 'clientId' });
Bot.belongsTo(Client, { foreignKey: 'clientId' });

Client.hasMany(Subscription, { foreignKey: 'clientId' });
Subscription.belongsTo(Client, { foreignKey: 'clientId' });

Plan.hasMany(Subscription, { foreignKey: 'planId' });
Subscription.belongsTo(Plan, { foreignKey: 'planId' });

// Hooks
User.beforeCreate(async (user) => {
  user.password = await bcrypt.hash(user.password, 10);
});

// Sincronização e dados iniciais
(async () => {
  try {
    await sequelize.sync({ force: false });
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

    // Criar planos padrão se não existirem
    const planCount = await Plan.count();
    if (planCount === 0) {
      await Plan.bulkCreate([
        {
          name: 'Básico',
          description: 'Plano básico com 1 bot e recursos essenciais',
          price: 29.90,
          duration: 30,
          maxBots: 1,
          features: {
            whatsappIntegration: true,
            basicSupport: true,
            appointmentScheduling: true
          }
        },
        {
          name: 'Profissional',
          description: 'Plano profissional com até 3 bots e recursos avançados',
          price: 79.90,
          duration: 30,
          maxBots: 3,
          features: {
            whatsappIntegration: true,
            prioritySupport: true,
            appointmentScheduling: true,
            analytics: true
          }
        },
        {
          name: 'Empresarial',
          description: 'Plano completo com bots ilimitados e todos os recursos',
          price: 199.90,
          duration: 30,
          maxBots: -1, // -1 para ilimitado
          features: {
            whatsappIntegration: true,
            dedicatedSupport: true,
            appointmentScheduling: true,
            advancedAnalytics: true,
            apiAccess: true
          }
        }
      ]);
      console.log('Planos padrão criados com sucesso');
    }
  } catch (error) {
    console.error('Erro ao sincronizar modelos:', error);
  }
})();

module.exports = {
  sequelize,
  Plan,
  Client,
  Subscription,
  User,
  Bot,
  Appointment
};
