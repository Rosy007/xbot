const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const bcrypt = require('bcryptjs');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'database.sqlite'),
  logging: console.log
});

// Testar a conexão
(async () => {
  try {
    await sequelize.authenticate();
    console.log('Conexão com o banco de dados estabelecida com sucesso.');
  } catch (error) {
    console.error('Não foi possível conectar ao banco de dados:', error);
  }
})();

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
    defaultValue: true
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
      responseDelay: 2,
      typingIndicator: true,
      typingDuration: 2,
      humanControlTimeout: 30,
      messagesPerMinute: 15,
      responseVariation: 0.3,
      typingVariation: 0.5,
      avoidRepetition: true
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
  }
});

// Modelo de Agendamentos
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

// Hash da senha antes de salvar
User.beforeCreate(async (user) => {
  user.password = await bcrypt.hash(user.password, 10);
});

// Sincronizar modelos com o banco de dados
(async () => {
  try {
    await sequelize.sync({ force: false });
    console.log('Modelos sincronizados com o banco de dados.');
    
    // Criar admin padrão apenas se não existir
    const adminCount = await User.count({ where: { isAdmin: true } });
    if (adminCount === 0) {
      await User.create({
        username: 'admin',
        password: 'admin123',
        isAdmin: true
      });
      console.log('Usuário admin padrão criado (admin:admin123)');
    }
  } catch (error) {
    console.error('Erro ao sincronizar modelos:', error);
  }
})();

module.exports = {
  sequelize,
  Bot,
  User,
  Appointment
};
