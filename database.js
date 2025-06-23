const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const bcrypt = require('bcryptjs');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'database.sqlite'),
  logging: console.log
});

// Modelo de Plano (mantido igual)
const Plan = sequelize.define('Plan', {
  // ... (código existente)
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

// Modelo de Assinatura (mantido igual)
const Subscription = sequelize.define('Subscription', {
  // ... (código existente)
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

// Modelo de Cliente (com validação melhorada)
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
      notEmpty: {
        msg: 'O nome do cliente é obrigatório'
      },
      len: {
        args: [3, 100],
        msg: 'O nome deve ter entre 3 e 100 caracteres'
      }
    }
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: {
      msg: 'Este e-mail já está cadastrado'
    },
    validate: {
      isEmail: {
        msg: 'Por favor, insira um e-mail válido'
      },
      notEmpty: {
        msg: 'O e-mail é obrigatório'
      }
    }
  },
  phone: {
    type: DataTypes.STRING,
    validate: {
      is: {
        args: /^(\+?\d{1,3}[- ]?)?\d{10}$/,
        msg: 'Por favor, insira um número de telefone válido'
      }
    }
  },
  company: DataTypes.STRING,
  notes: DataTypes.TEXT
});

// Modelo de Usuário (mantido igual)
const User = sequelize.define('User', {
  // ... (código existente)
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

// Modelo de Bot (com validação melhorada)
const Bot = sequelize.define('Bot', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
    validate: {
      notEmpty: {
        msg: 'O ID do bot é obrigatório'
      }
    }
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: 'O nome do bot é obrigatório'
      },
      len: {
        args: [3, 50],
        msg: 'O nome do bot deve ter entre 3 e 50 caracteres'
      }
    }
  },
  apiKeys: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {},
    validate: {
      hasAtLeastOneKey(value) {
        if (!value.gemini && !value.openai) {
          throw new Error('Pelo menos uma chave de API (Gemini ou OpenAI) é necessária');
        }
      }
    }
  },
  botIdentity: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: 'A personalidade do bot é obrigatória'
      },
      len: {
        args: [10, 2000],
        msg: 'A personalidade deve ter entre 10 e 2000 caracteres'
      }
    }
  },
  // ... (restante do modelo mantido igual)
});

// Modelo de Mensagem Agendada (mantido igual)
const ScheduledMessage = sequelize.define('ScheduledMessage', {
  // ... (código existente)
});

// Relacionamentos (mantidos iguais)
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

// Hooks para hash de senha (mantidos iguais)
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

User.prototype.validatePassword = async function(password) {
  return await bcrypt.compare(password, this.password);
};

// Sincronizar modelos com o banco de dados (com melhor tratamento de erros)
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
    process.exit(1); // Encerra o processo em caso de erro crítico
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

