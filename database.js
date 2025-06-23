const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');

// Configuração do Sequelize - forçando novo banco de dados
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'database.sqlite'),
  logging: console.log
});

// Remova o arquivo do banco de dados existente se necessário
const fs = require('fs');
const dbPath = path.join(__dirname, 'database.sqlite');
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log('Banco de dados antigo removido');
}

// Modelo de Plano (atualizado)
const Plan = sequelize.define('Plan', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: { msg: 'O nome do plano é obrigatório' },
      len: { args: [3, 50], msg: 'O nome deve ter entre 3 e 50 caracteres' }
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: { msg: 'A descrição é obrigatória' }
    }
  },
  price: {
    type: DataTypes.FLOAT,
    allowNull: false,
    validate: {
      min: { args: [0], msg: 'O preço não pode ser negativo' }
    }
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

// Modelo de Assinatura (atualizado)
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

// Modelo de Cliente (atualizado)
const Client = sequelize.define('Client', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: { msg: 'O nome é obrigatório' },
      len: { args: [3, 100], msg: 'O nome deve ter entre 3 e 100 caracteres' }
    }
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: { msg: 'Este e-mail já está cadastrado' },
    validate: {
      isEmail: { msg: 'Por favor, insira um e-mail válido' },
      notEmpty: { msg: 'O e-mail é obrigatório' }
    }
  },
  phone: {
    type: DataTypes.STRING,
    validate: {
      is: {
        args: /^(\+?\d{1,3}[- ]?)?\d{10}$/,
        msg: 'Por favor, insira um telefone válido'
      }
    }
  },
  company: {
    type: DataTypes.STRING,
    validate: {
      len: { args: [0, 100], msg: 'O nome da empresa deve ter até 100 caracteres' }
    }
  },
  notes: {
    type: DataTypes.TEXT,
    validate: {
      len: { args: [0, 1000], msg: 'As notas devem ter até 1000 caracteres' }
    }
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
    unique: { msg: 'Este nome de usuário já está em uso' },
    validate: {
      notEmpty: { msg: 'O nome de usuário é obrigatório' },
      len: { args: [3, 30], msg: 'O nome deve ter entre 3 e 30 caracteres' }
    }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: { msg: 'A senha é obrigatória' },
      len: { args: [6, 100], msg: 'A senha deve ter entre 6 e 100 caracteres' }
    }
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

// Modelo de Bot (atualizado)
const Bot = sequelize.define('Bot', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: { msg: 'O nome é obrigatório' },
      len: { args: [3, 50], msg: 'O nome deve ter entre 3 e 50 caracteres' }
    }
  },
  apiKeys: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  },
  botIdentity: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: { msg: 'A identidade do bot é obrigatória' },
      len: { args: [10, 2000], msg: 'A identidade deve ter entre 10 e 2000 caracteres' }
    }
  },
  sessionId: {
    type: DataTypes.STRING
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
    defaultValue: () => moment().add(30, 'days').toDate()
  },
  sharedWith: {
    type: DataTypes.JSON,
    defaultValue: []
  }
});

// Modelo de Mensagem Agendada (atualizado)
const ScheduledMessage = sequelize.define('ScheduledMessage', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  recipient: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: { msg: 'O destinatário é obrigatório' }
    }
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: { msg: 'A mensagem é obrigatória' }
    }
  },
  scheduledTime: {
    type: DataTypes.DATE,
    allowNull: false,
    validate: {
      isDate: { msg: 'A data deve ser válida' }
    }
  },
  status: {
    type: DataTypes.ENUM('pending', 'sent', 'failed', 'canceled'),
    defaultValue: 'pending'
  },
  sentAt: {
    type: DataTypes.DATE
  }
});

// Definindo os relacionamentos (atualizados)
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

// Hooks para hash de senha
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

// Método para verificar senha
User.prototype.validatePassword = async function(password) {
  return await bcrypt.compare(password, this.password);
};

// Sincronização e inicialização do banco de dados
(async () => {
  try {
    // Forçar criação de novo banco de dados
    await sequelize.sync({ force: true });
    console.log('Banco de dados criado com sucesso!');
    
    // Criar usuário admin padrão
    const admin = await User.create({
      username: 'admin',
      password: await bcrypt.hash('admin123', 10),
      isAdmin: true
    });
    console.log('Admin criado:', admin.username);
    
    // Criar planos padrão
    const plans = await Plan.bulkCreate([
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
    console.log(`${plans.length} planos padrão criados`);
    
    // Exemplo de cliente de teste (opcional)
    const testClient = await Client.create({
      name: 'Cliente Teste',
      email: 'cliente@teste.com',
      phone: '11999999999',
      company: 'Empresa Teste'
    });
    
    // Exemplo de assinatura (opcional)
    await Subscription.create({
      clientId: testClient.id,
      planId: plans[1].id, // Plano Profissional
      startDate: new Date(),
      endDate: moment().add(1, 'year').toDate()
    });
    
    console.log('Banco de dados inicializado com sucesso!');
  } catch (error) {
    console.error('Erro ao inicializar o banco de dados:', error);
    process.exit(1);
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

