const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const bcrypt = require('bcryptjs');

// Configuração do Sequelize
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
    allowNull: false,
    validate: {
      notEmpty: {
        msg: 'O nome do plano é obrigatório'
      },
      len: {
        args: [3, 50],
        msg: 'O nome do plano deve ter entre 3 e 50 caracteres'
      }
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: 'A descrição do plano é obrigatória'
      }
    }
  },
  price: {
    type: DataTypes.FLOAT,
    allowNull: false,
    validate: {
      min: {
        args: [0],
        msg: 'O preço não pode ser negativo'
      }
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
    },
    validate: {
      isValidFeatures(value) {
        if (typeof value !== 'object' || value === null) {
          throw new Error('As características do plano devem ser um objeto');
        }
      }
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
    defaultValue: DataTypes.NOW,
    validate: {
      isDate: {
        msg: 'A data de início deve ser uma data válida'
      }
    }
  },
  endDate: {
    type: DataTypes.DATE,
    allowNull: false,
    validate: {
      isDate: {
        msg: 'A data de término deve ser uma data válida'
      },
      isAfterStartDate(value) {
        if (this.startDate && value <= this.startDate) {
          throw new Error('A data de término deve ser após a data de início');
        }
      }
    }
  },
  status: {
    type: DataTypes.ENUM('active', 'pending', 'canceled', 'expired'),
    defaultValue: 'active',
    validate: {
      isIn: {
        args: [['active', 'pending', 'canceled', 'expired']],
        msg: 'Status da assinatura inválido'
      }
    }
  },
  paymentMethod: {
    type: DataTypes.STRING,
    validate: {
      len: {
        args: [0, 50],
        msg: 'O método de pagamento deve ter no máximo 50 caracteres'
      }
    }
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
  company: {
    type: DataTypes.STRING,
    validate: {
      len: {
        args: [0, 100],
        msg: 'O nome da empresa deve ter no máximo 100 caracteres'
      }
    }
  },
  notes: {
    type: DataTypes.TEXT,
    validate: {
      len: {
        args: [0, 1000],
        msg: 'As observações devem ter no máximo 1000 caracteres'
      }
    }
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
    unique: {
      msg: 'Este nome de usuário já está em uso'
    },
    validate: {
      notEmpty: {
        msg: 'O nome de usuário é obrigatório'
      },
      len: {
        args: [3, 30],
        msg: 'O nome de usuário deve ter entre 3 e 30 caracteres'
      }
    }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: 'A senha é obrigatória'
      },
      len: {
        args: [6, 100],
        msg: 'A senha deve ter entre 6 e 100 caracteres'
      }
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

// Modelo de Bot
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
  sessionId: {
    type: DataTypes.STRING,
    validate: {
      len: {
        args: [0, 255],
        msg: 'O ID da sessão deve ter no máximo 255 caracteres'
      }
    }
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
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
    },
    validate: {
      isValidSettings(value) {
        if (typeof value !== 'object' || value === null) {
          throw new Error('As configurações devem ser um objeto');
        }
      }
    }
  },
  startDate: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    validate: {
      isDate: {
        msg: 'A data de início deve ser uma data válida'
      }
    }
  },
  endDate: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    validate: {
      isDate: {
        msg: 'A data de término deve ser uma data válida'
      },
      isAfterStartDate(value) {
        if (this.startDate && value <= this.startDate) {
          throw new Error('A data de término deve ser após a data de início');
        }
      }
    }
  },
  sharedWith: {
    type: DataTypes.JSON,
    defaultValue: [],
    validate: {
      isArray(value) {
        if (!Array.isArray(value)) {
          throw new Error('A lista de compartilhamento deve ser um array');
        }
      }
    }
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
    allowNull: false,
    validate: {
      notEmpty: {
        msg: 'O destinatário é obrigatório'
      }
    }
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: 'A mensagem é obrigatória'
      }
    }
  },
  scheduledTime: {
    type: DataTypes.DATE,
    allowNull: false,
    validate: {
      isDate: {
        msg: 'A data agendada deve ser uma data válida'
      },
      isFuture(value) {
        if (value <= new Date()) {
          throw new Error('A data agendada deve ser no futuro');
        }
      }
    }
  },
  status: {
    type: DataTypes.ENUM('pending', 'sent', 'failed', 'canceled'),
    defaultValue: 'pending',
    validate: {
      isIn: {
        args: [['pending', 'sent', 'failed', 'canceled']],
        msg: 'Status da mensagem inválido'
      }
    }
  },
  sentAt: {
    type: DataTypes.DATE
  }
});

// Definindo os relacionamentos
User.hasOne(Client, {
  foreignKey: {
    allowNull: false
  },
  onDelete: 'CASCADE'
});
Client.belongsTo(User);

Client.hasMany(Subscription, {
  foreignKey: {
    allowNull: false
  },
  onDelete: 'CASCADE'
});
Subscription.belongsTo(Client);

Plan.hasMany(Subscription);
Subscription.belongsTo(Plan);

Subscription.hasMany(Bot, {
  foreignKey: {
    allowNull: false
  },
  onDelete: 'CASCADE'
});
Bot.belongsTo(Subscription);

Bot.hasMany(ScheduledMessage, {
  foreignKey: {
    allowNull: false
  },
  onDelete: 'CASCADE'
});
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

