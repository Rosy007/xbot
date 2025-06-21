
require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
require('moment/locale/pt-br');

const { Bot, User, Plan, Client, Subscription, ScheduledMessage, sequelize } = require('./database');
const { initChatbot, shutdownBot } = require('./chatbot-module');
const redisService = require('./redis-service');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const SESSIONS_DIR = path.join(__dirname, 'wpp-sessions');
const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-change-me';

// Configurações do servidor
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware de autenticação
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findByPk(decoded.id);
    
    if (!user) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Erro na autenticação:', error);
    res.status(401).json({ error: 'Token inválido' });
  }
};

// Middleware para admin
const isAdmin = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user || !user.isAdmin) {
      return res.status(403).json({ 
        error: 'Acesso negado - requer privilégios de administrador' 
      });
    }
    next();
  } catch (error) {
    console.error('Erro ao verificar permissões:', error);
    res.status(500).json({ error: 'Erro ao verificar permissões' });
  }
};


// Rotas de autenticação
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }

    // Primeiro busca apenas o usuário básico para verificar a senha
    const user = await User.findOne({ 
      where: { username },
      attributes: ['id', 'username', 'password', 'isAdmin', 'isClient']
    });
    
    if (!user) {
      console.log(`Usuário não encontrado: ${username}`);
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      console.log(`Senha inválida para usuário: ${username}`);
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    // Se a senha estiver correta, então busca as informações adicionais se necessário
    let responseData = {
      token: jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '8h' }), 
      isAdmin: user.isAdmin, 
      isClient: user.isClient,
      username: user.username
    };

    // Se for cliente, buscar informações adicionais do bot associado
    if (user.isClient) {
      const clientWithBot = await User.findByPk(user.id, {
        include: [{
          model: Client,
          include: [{
            model: Subscription,
            include: [{
              model: Bot,
              limit: 1 // Apenas o primeiro bot, se houver
            }]
          }]
        }]
      });

      if (clientWithBot?.Client?.Subscriptions?.[0]?.Bots?.[0]) {
        responseData.botId = clientWithBot.Client.Subscriptions[0].Bots[0].id;
      }
    }

    res.json(responseData);
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Rota para obter informações do usuário atual
app.get('/api/me', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ['id', 'username', 'isAdmin', 'isClient'],
      include: [{
        model: Client,
        include: [{
          model: Subscription,
          include: [Plan]
        }]
      }]
    });
    
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const userData = {
      id: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      isClient: user.isClient
    };

    if (user.Client) {
      userData.client = {
        id: user.Client.id,
        name: user.Client.name,
        email: user.Client.email,
        subscriptions: user.Client.Subscriptions.map(sub => ({
          id: sub.id,
          plan: sub.Plan.name,
          status: sub.status,
          startDate: sub.startDate,
          endDate: sub.endDate
        }))
      };
    }

    res.json(userData);
  } catch (error) {
    console.error('Erro ao buscar informações do usuário:', error);
    res.status(500).json({ error: 'Erro ao buscar informações do usuário' });
  }
});

// Rotas de usuário
app.post('/api/users', authenticate, isAdmin, async (req, res) => {
  try {
    const { username, password, isAdmin, isClient } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      password: hashedPassword,
      isAdmin: isAdmin || false,
      isClient: isClient || false
    });

    res.status(201).json({
      id: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      isClient: user.isClient
    });
  } catch (error) {
    console.error('Erro ao criar usuário:', error);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// Rotas de plano
app.get('/api/plans', authenticate, async (req, res) => {
  try {
    const plans = await Plan.findAll({ 
      where: { isActive: true },
      order: [['price', 'ASC']] 
    });
    res.json(plans);
  } catch (error) {
    console.error('Erro ao buscar planos:', error);
    res.status(500).json({ error: 'Erro ao buscar planos' });
  }
});

app.post('/api/plans', authenticate, isAdmin, async (req, res) => {
  try {
    const { name, description, price, features } = req.body;
    
    if (!name || !description || !price) {
      return res.status(400).json({ error: 'Nome, descrição e preço são obrigatórios' });
    }

    const newPlan = await Plan.create({
      name,
      description,
      price,
      features: features || {
        maxBots: 1,
        maxMessagesPerDay: 1000,
        apiAccess: false,
        scheduling: false,
        analytics: false,
        prioritySupport: false,
        customBranding: false
      }
    });

    res.status(201).json(newPlan);
  } catch (error) {
    console.error('Erro ao criar plano:', error);
    res.status(500).json({ error: 'Erro ao criar plano' });
  }
});

// Rotas de cliente
app.get('/api/clients', authenticate, isAdmin, async (req, res) => {
  try {
    const clients = await Client.findAll({
      include: [
        User,
        { 
          model: Subscription, 
          include: [Plan, Bot],
          where: { status: 'active' },
          required: false
        }
      ],
      order: [['createdAt', 'DESC']]
    });
    
    const formattedClients = clients.map(client => ({
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      company: client.company,
      notes: client.notes,
      createdAt: client.createdAt,
      user: {
        id: client.User.id,
        username: client.User.username
      },
      subscriptions: client.Subscriptions.map(sub => ({
        id: sub.id,
        plan: sub.Plan ? sub.Plan.name : null,
        status: sub.status,
        startDate: sub.startDate,
        endDate: sub.endDate,
        bot: sub.Bots && sub.Bots.length > 0 ? {
          id: sub.Bots[0].id,
          name: sub.Bots[0].name
        } : null
      }))
    }));

    res.json(formattedClients);
  } catch (error) {
    console.error('Erro ao buscar clientes:', error);
    res.status(500).json({ error: 'Erro ao buscar clientes' });
  }
});

app.post('/api/clients', authenticate, isAdmin, async (req, res) => {
  try {
    const { name, email, phone, company, notes, planId } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({ error: 'Nome e e-mail são obrigatórios' });
    }

    // Verificar se email já existe
    const existingClient = await Client.findOne({ where: { email } });
    if (existingClient) {
      return res.status(400).json({ error: 'E-mail já cadastrado' });
    }

    // Criar usuário para o cliente
    const username = email.split('@')[0] + Math.floor(Math.random() * 1000);
    const tempPassword = Math.random().toString(36).slice(-8);
    
    const user = await User.create({
      username,
      password: await bcrypt.hash(tempPassword, 10),
      isClient: true
    });
    
    // Criar cliente
    const client = await Client.create({
      name,
      email,
      phone,
      company,
      notes,
      userId: user.id
    });
    
    // Criar assinatura se houver plano
    let subscription = null;
    if (planId) {
      const plan = await Plan.findByPk(planId);
      if (plan) {
        subscription = await Subscription.create({
          clientId: client.id,
          planId: plan.id,
          startDate: new Date(),
          endDate: moment().add(1, 'month').toDate(),
          status: 'active'
        });
      }
    }
    
    res.status(201).json({ 
      client: {
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        company: client.company,
        notes: client.notes,
        createdAt: client.createdAt
      },
      user: {
        id: user.id,
        username: user.username,
        tempPassword
      },
      subscription
    });
  } catch (error) {
    console.error('Erro ao criar cliente:', error);
    res.status(500).json({ error: 'Erro ao criar cliente' });
  }
});

// Rotas para bot
app.get('/api/bots', authenticate, async (req, res) => {
  try {
    let whereCondition = {};
    let includeCondition = [Plan];
    
    // Se não for admin, mostrar apenas bots associados ao usuário
    if (!req.user.isAdmin) {
      includeCondition.push({
        model: Subscription,
        include: [{
          model: Client,
          where: { userId: req.user.id },
          required: true
        }]
      });
    }
    
    const bots = await Bot.findAll({
      where: whereCondition,
      include: includeCondition,
      order: [['createdAt', 'DESC']]
    });
    
    const formattedBots = bots.map(bot => ({
      id: bot.id,
      name: bot.name,
      botIdentity: bot.botIdentity,
      isActive: bot.isActive,
      startDate: bot.startDate,
      endDate: bot.endDate,
      createdAt: bot.createdAt,
      lastStartedAt: bot.lastStartedAt,
      lastStoppedAt: bot.lastStoppedAt,
      plan: bot.Plan ? {
        id: bot.Plan.id,
        name: bot.Plan.name,
        price: bot.Plan.price
      } : null,
      settings: bot.settings
    }));

    res.json(formattedBots);
  } catch (error) {
    console.error('Erro ao carregar bots:', error);
    res.status(500).json({ error: 'Erro ao carregar bots' });
  }
});

app.post('/api/bots/:id/start', authenticate, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) {
      return res.status(404).json({ error: 'Bot não encontrado' });
    }

    // Verificar se o usuário tem acesso a este bot
    if (!req.user.isAdmin) {
      const subscription = await Subscription.findOne({
        where: { planId: bot.planId },
        include: [{
          model: Client,
          where: { userId: req.user.id }
        }]
      });
      
      if (!subscription) {
        return res.status(403).json({ error: 'Acesso negado a este bot' });
      }
    }

    // Verificar datas do bot
    const now = new Date();
    if (now < new Date(bot.startDate)) {
      return res.status(400).json({ 
        error: `Este bot ainda não está ativo (ativo a partir de ${moment(bot.startDate).format('DD/MM/YYYY HH:mm')})` 
      });
    }

    if (now > new Date(bot.endDate)) {
      return res.status(400).json({ 
        error: `Este bot expirou em ${moment(bot.endDate).format('DD/MM/YYYY HH:mm')}` 
      });
    }

    if (bot.isActive) {
      return res.json({ success: true, message: 'Bot já está ativo' });
    }

    try {
      await initChatbot(bot, io);
      await bot.update({
        isActive: true,
        lastStartedAt: moment().format()
      });
      res.json({ success: true });
    } catch (error) {
      console.error(`Erro ao iniciar bot ${bot.name}:`, error);
      res.status(500).json({ error: 'Erro ao iniciar bot: ' + error.message });
    }
  } catch (error) {
    console.error('Erro geral ao iniciar bot:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Rotas para mensagens agendadas
app.get('/api/bots/:botId/scheduled-messages', authenticate, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.botId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot não encontrado' });
    }

    // Verificar se o usuário tem acesso a este bot
    if (!req.user.isAdmin) {
      const subscription = await Subscription.findOne({
        where: { planId: bot.planId },
        include: [{
          model: Client,
          where: { userId: req.user.id }
        }]
      });
      
      if (!subscription) {
        return res.status(403).json({ error: 'Acesso negado a este bot' });
      }
    }

    const messages = await ScheduledMessage.findAll({
      where: { botId: req.params.botId },
      order: [['scheduledTime', 'ASC']]
    });
    
    const formattedMessages = messages.map(msg => ({
      id: msg.id,
      recipient: msg.recipient,
      message: msg.message,
      scheduledTime: msg.scheduledTime,
      status: msg.status,
      sentAt: msg.sentAt,
      createdAt: msg.createdAt
    }));

    res.json(formattedMessages);
  } catch (error) {
    console.error('Erro ao buscar mensagens agendadas:', error);
    res.status(500).json({ error: 'Erro ao buscar mensagens agendadas' });
  }
});

// Rotas para bot compartilhado (públicas)
app.get('/api/shared-bot/:botId', async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.botId, {
      include: [Plan]
    });
    
    if (!bot) {
      return res.status(404).json({ error: 'Bot não encontrado' });
    }
    
    res.json({
      id: bot.id,
      name: bot.name,
      botIdentity: bot.botIdentity,
      apiKeys: {
        gemini: bot.apiKeys.gemini ? true : false,
        openai: bot.apiKeys.openai ? true : false
      },
      settings: {
        preventGroupResponses: bot.settings.preventGroupResponses,
        typingIndicator: bot.settings.typingIndicator,
        humanControlTimeout: bot.settings.humanControlTimeout,
        maxMessagesPerHour: bot.settings.maxMessagesPerHour,
        minResponseDelay: bot.settings.minResponseDelay,
        maxResponseDelay: bot.settings.maxResponseDelay,
        humanLikeMistakes: bot.settings.humanLikeMistakes,
        allowScheduling: bot.settings.allowScheduling,
        maxScheduledMessages: bot.settings.maxScheduledMessages
      },
      isActive: bot.isActive,
      startDate: bot.startDate,
      endDate: bot.endDate,
      plan: bot.Plan ? {
        name: bot.Plan.name,
        features: bot.Plan.features
      } : null
    });
  } catch (error) {
    console.error('Erro ao buscar bot compartilhado:', error);
    res.status(500).json({ error: 'Erro ao buscar informações do bot' });
  }
});

// Rotas estáticas
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/share-bot/:botId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share-bot.html'));
});
// 👉 Coloque AQUI sua rota POST /api/bots

app.post('/api/bots', authenticate, async (req, res) => {
  try {
    const {
      name,
      botIdentity,
      planId,
      startDate,
      endDate,
      settings,
      subscriptionId
    } = req.body;

    if (!name || !planId || !subscriptionId) {
      return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
    }

    const bot = await Bot.create({
      name,
      botIdentity,
      planId,
      subscriptionId,
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate: endDate ? new Date(endDate) : moment().add(1, 'month').toDate(),
      isActive: false,
      settings: settings || {}
    });

    res.status(201).json(bot);
  } catch (error) {
    console.error('Erro ao criar bot:', error);
    res.status(500).json({ error: 'Erro ao criar bot' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicialização do servidor
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (err) => {
  console.error('Erro não tratado:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Exceção não capturada:', err);
});

