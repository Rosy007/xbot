require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
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

// Middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware de autenticação
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findByPk(decoded.id);
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });
    req.user = user;
    next();
  } catch (error) {
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
    res.status(500).json({ error: 'Erro ao verificar permissões' });
  }
};

// Rota para login corrigida
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ 
      where: { username },
      include: [{
        model: Client,
        include: [{
          model: Subscription,
          include: [{
            model: Bot
          }]
        }]
      }]
    });
    
    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const isPasswordValid = await user.validatePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '8h' });
    
    const responseData = {
      token, 
      isAdmin: user.isAdmin, 
      isClient: user.isClient,
      username: user.username
    };

    if (user.isClient && user.Client && user.Client.Subscriptions && user.Client.Subscriptions.length > 0) {
      const subscription = user.Client.Subscriptions[0];
      if (subscription.Bots && subscription.Bots.length > 0) {
        responseData.botId = subscription.Bots[0].id;
      }
    }

    res.json(responseData);
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Rotas de usuário
app.post('/api/users', authenticate, isAdmin, async (req, res) => {
  try {
    const { username, password, isAdmin, isClient } = req.body;
    
    const user = await User.create({
      username,
      password: await bcrypt.hash(password, 10),
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

app.get('/api/plans/:id', authenticate, async (req, res) => {
  try {
    const plan = await Plan.findByPk(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plano não encontrado' });
    res.json(plan);
  } catch (error) {
    console.error('Erro ao buscar plano:', error);
    res.status(500).json({ error: 'Erro ao buscar plano' });
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

app.put('/api/plans/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const plan = await Plan.findByPk(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plano não encontrado' });

    const { name, description, price, features } = req.body;
    
    await plan.update({
      name: name || plan.name,
      description: description || plan.description,
      price: price || plan.price,
      features: features || plan.features
    });

    res.json(plan);
  } catch (error) {
    console.error('Erro ao atualizar plano:', error);
    res.status(500).json({ error: 'Erro ao atualizar plano' });
  }
});

app.delete('/api/plans/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const plan = await Plan.findByPk(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plano não encontrado' });

    await plan.update({ isActive: false });
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao desativar plano:', error);
    res.status(500).json({ error: 'Erro ao desativar plano' });
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

app.get('/api/clients/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const client = await Client.findByPk(req.params.id, {
      include: [
        User,
        { 
          model: Subscription, 
          include: [Plan, Bot],
          where: { status: 'active' },
          required: false
        }
      ]
    });
    
    if (!client) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    const formattedClient = {
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
        plan: sub.Plan ? {
          id: sub.Plan.id,
          name: sub.Plan.name,
          price: sub.Plan.price
        } : null,
        status: sub.status,
        startDate: sub.startDate,
        endDate: sub.endDate,
        bot: sub.Bots && sub.Bots.length > 0 ? {
          id: sub.Bots[0].id,
          name: sub.Bots[0].name
        } : null
      }))
    };

    res.json(formattedClient);
  } catch (error) {
    console.error('Erro ao buscar cliente:', error);
    res.status(500).json({ error: 'Erro ao buscar cliente' });
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

app.put('/api/clients/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const client = await Client.findByPk(req.params.id);
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

    const { name, email, phone, company, notes } = req.body;
    
    await client.update({
      name: name || client.name,
      email: email || client.email,
      phone: phone || client.phone,
      company: company || client.company,
      notes: notes || client.notes
    });

    res.json({
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      company: client.company,
      notes: client.notes,
      createdAt: client.createdAt
    });
  } catch (error) {
    console.error('Erro ao atualizar cliente:', error);
    res.status(500).json({ error: 'Erro ao atualizar cliente' });
  }
});

app.delete('/api/clients/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const client = await Client.findByPk(req.params.id);
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

    // Encontrar e desativar todas as assinaturas do cliente
    await Subscription.update(
      { status: 'canceled' },
      { where: { clientId: client.id } }
    );

    // Encontrar e desativar todos os bots do cliente
    const subscriptions = await Subscription.findAll({
      where: { clientId: client.id },
      include: [Bot]
    });

    for (const sub of subscriptions) {
      for (const bot of sub.Bots) {
        await shutdownBot(bot.id);
        await bot.update({ isActive: false });
      }
    }

    // Desativar o usuário associado
    await User.update(
      { isActive: false },
      { where: { id: client.userId } }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao desativar cliente:', error);
    res.status(500).json({ error: 'Erro ao desativar cliente' });
  }
});

// Rotas de assinatura
app.get('/api/subscriptions', authenticate, isAdmin, async (req, res) => {
  try {
    const subscriptions = await Subscription.findAll({
      include: [Client, Plan, Bot],
      order: [['createdAt', 'DESC']]
    });
    
    const formattedSubscriptions = subscriptions.map(sub => ({
      id: sub.id,
      status: sub.status,
      startDate: sub.startDate,
      endDate: sub.endDate,
      paymentMethod: sub.paymentMethod,
      createdAt: sub.createdAt,
      client: {
        id: sub.Client.id,
        name: sub.Client.name,
        email: sub.Client.email
      },
      plan: {
        id: sub.Plan.id,
        name: sub.Plan.name,
        price: sub.Plan.price
      },
      bot: sub.Bots && sub.Bots.length > 0 ? {
        id: sub.Bots[0].id,
        name: sub.Bots[0].name
      } : null
    }));

    res.json(formattedSubscriptions);
  } catch (error) {
    console.error('Erro ao buscar assinaturas:', error);
    res.status(500).json({ error: 'Erro ao buscar assinaturas' });
  }
});

app.post('/api/clients/:clientId/subscriptions', authenticate, isAdmin, async (req, res) => {
  try {
    const { planId, startDate, endDate, paymentMethod } = req.body;
    
    const client = await Client.findByPk(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

    const plan = await Plan.findByPk(planId);
    if (!plan) return res.status(404).json({ error: 'Plano não encontrado' });

    // Verificar se já existe uma assinatura ativa para este cliente
    const activeSubscription = await Subscription.findOne({
      where: { 
        clientId: client.id,
        status: 'active'
      }
    });

    if (activeSubscription) {
      return res.status(400).json({ error: 'Cliente já possui uma assinatura ativa' });
    }

    const subscription = await Subscription.create({
      clientId: client.id,
      planId: plan.id,
      startDate: startDate || new Date(),
      endDate: endDate || moment().add(1, 'month').toDate(),
      status: 'active',
      paymentMethod: paymentMethod || null
    });

    res.status(201).json({
      id: subscription.id,
      status: subscription.status,
      startDate: subscription.startDate,
      endDate: subscription.endDate,
      paymentMethod: subscription.paymentMethod,
      client: {
        id: client.id,
        name: client.name,
        email: client.email
      },
      plan: {
        id: plan.id,
        name: plan.name,
        price: plan.price
      }
    });
  } catch (error) {
    console.error('Erro ao criar assinatura:', error);
    res.status(500).json({ error: 'Erro ao criar assinatura' });
  }
});

app.put('/api/subscriptions/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const subscription = await Subscription.findByPk(req.params.id, {
      include: [Client, Plan]
    });
    
    if (!subscription) return res.status(404).json({ error: 'Assinatura não encontrada' });

    const { planId, startDate, endDate, status, paymentMethod } = req.body;

    // Se estiver mudando de plano, verificar se o novo plano existe
    if (planId && planId !== subscription.planId) {
      const plan = await Plan.findByPk(planId);
      if (!plan) return res.status(404).json({ error: 'Plano não encontrado' });
    }

    await subscription.update({
      planId: planId || subscription.planId,
      startDate: startDate || subscription.startDate,
      endDate: endDate || subscription.endDate,
      status: status || subscription.status,
      paymentMethod: paymentMethod || subscription.paymentMethod
    });

    res.json({
      id: subscription.id,
      status: subscription.status,
      startDate: subscription.startDate,
      endDate: subscription.endDate,
      paymentMethod: subscription.paymentMethod,
      client: {
        id: subscription.Client.id,
        name: subscription.Client.name,
        email: subscription.Client.email
      },
      plan: {
        id: subscription.Plan.id,
        name: subscription.Plan.name,
        price: subscription.Plan.price
      }
    });
  } catch (error) {
    console.error('Erro ao atualizar assinatura:', error);
    res.status(500).json({ error: 'Erro ao atualizar assinatura' });
  }
});

app.delete('/api/subscriptions/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const subscription = await Subscription.findByPk(req.params.id);
    if (!subscription) return res.status(404).json({ error: 'Assinatura não encontrada' });

    await subscription.update({ status: 'canceled' });
    
    // Desativar bots associados a esta assinatura
    const bots = await Bot.findAll({
      where: { planId: subscription.planId }
    });

    for (const bot of bots) {
      await shutdownBot(bot.id);
      await bot.update({ isActive: false });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao cancelar assinatura:', error);
    res.status(500).json({ error: 'Erro ao cancelar assinatura' });
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

app.get('/api/bots/:id', authenticate, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id, {
      include: [Plan]
    });
    
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
    
    res.json({
      id: bot.id,
      name: bot.name,
      botIdentity: bot.botIdentity,
      apiKeys: {
        gemini: bot.apiKeys.gemini ? true : false,
        openai: bot.apiKeys.openai ? true : false
      },
      isActive: bot.isActive,
      startDate: bot.startDate,
      endDate: bot.endDate,
      createdAt: bot.createdAt,
      lastStartedAt: bot.lastStartedAt,
      lastStoppedAt: bot.lastStoppedAt,
      plan: bot.Plan ? {
        id: bot.Plan.id,
        name: bot.Plan.name,
        price: bot.Plan.price,
        features: bot.Plan.features
      } : null,
      settings: bot.settings
    });
  } catch (error) {
    console.error('Erro ao buscar bot:', error);
    res.status(500).json({ error: 'Erro ao buscar bot' });
  }
});

app.post('/api/bots', authenticate, isAdmin, async (req, res) => {
  try {
    const { name, apiKeys, botIdentity, startDate, endDate, planId, settings } = req.body;
    
    if (!name || (!apiKeys?.gemini && !apiKeys?.openai)) {
      return res.status(400).json({ error: 'Nome e pelo menos uma chave de API são obrigatórios' });
    }

    const botId = uuidv4();
    const sessionId = uuidv4();
    
    const botData = {
      id: botId,
      name,
      apiKeys: {
        gemini: apiKeys.gemini || '',
        openai: apiKeys.openai || ''
      },
      botIdentity: botIdentity || 'Você é um assistente útil. Responda de forma natural e humana.',
      sessionId,
      createdAt: moment().format(),
      isActive: false,
      settings: {
        preventGroupResponses: settings?.preventGroupResponses !== undefined ? settings.preventGroupResponses : true,
        maxResponseLength: settings?.maxResponseLength || 200,
        responseDelay: settings?.responseDelay || 2,
        typingIndicator: settings?.typingIndicator !== undefined ? settings.typingIndicator : true,
        typingDuration: settings?.typingDuration || 2,
        humanControlTimeout: settings?.humanControlTimeout || 30,
        maxMessagesPerHour: settings?.maxMessagesPerHour || 20,
        minResponseDelay: settings?.minResponseDelay || 1,
        maxResponseDelay: settings?.maxResponseDelay || 5,
        typingVariance: settings?.typingVariance || 0.5,
        humanLikeMistakes: settings?.humanLikeMistakes || 0.05,
        conversationCooldown: settings?.conversationCooldown || 300,
        allowScheduling: settings?.allowScheduling !== undefined ? settings.allowScheduling : false,
        maxScheduledMessages: settings?.maxScheduledMessages || 10
      },
      startDate: startDate || moment().format(),
      endDate: endDate || moment().add(30, 'days').format(),
      planId
    };
    
    const newBot = await Bot.create(botData);
    
    res.status(201).json({
      id: newBot.id,
      name: newBot.name,
      botIdentity: newBot.botIdentity,
      isActive: newBot.isActive,
      startDate: newBot.startDate,
      endDate: newBot.endDate,
      settings: newBot.settings,
      planId: newBot.planId
    });
  } catch (error) {
    console.error('Erro detalhado ao criar bot:', error.message);
    res.status(500).json({ error: `Erro ao criar bot: ${error.message}` });
  }
});

app.put('/api/bots/:id', authenticate, async (req, res) => {
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

    const { name, apiKeys, botIdentity, settings } = req.body;

    const updatedData = {
      name: name || bot.name,
      apiKeys: {
        gemini: apiKeys?.gemini || bot.apiKeys.gemini,
        openai: apiKeys?.openai || bot.apiKeys.openai
      },
      botIdentity: botIdentity || bot.botIdentity,
      settings: {
        preventGroupResponses: settings?.preventGroupResponses !== undefined 
          ? settings.preventGroupResponses 
          : bot.settings.preventGroupResponses,
        maxResponseLength: settings?.maxResponseLength || bot.settings.maxResponseLength,
        responseDelay: settings?.responseDelay || bot.settings.responseDelay,
        typingIndicator: settings?.typingIndicator !== undefined 
          ? settings.typingIndicator 
          : bot.settings.typingIndicator,
        typingDuration: settings?.typingDuration || bot.settings.typingDuration,
        humanControlTimeout: settings?.humanControlTimeout || bot.settings.humanControlTimeout,
        maxMessagesPerHour: settings?.maxMessagesPerHour || bot.settings.maxMessagesPerHour,
        minResponseDelay: settings?.minResponseDelay || bot.settings.minResponseDelay,
        maxResponseDelay: settings?.maxResponseDelay || bot.settings.maxResponseDelay,
        typingVariance: settings?.typingVariance || bot.settings.typingVariance,
        humanLikeMistakes: settings?.humanLikeMistakes || bot.settings.humanLikeMistakes,
        conversationCooldown: settings?.conversationCooldown || bot.settings.conversationCooldown,
        allowScheduling: settings?.allowScheduling !== undefined 
          ? settings.allowScheduling 
          : bot.settings.allowScheduling,
        maxScheduledMessages: settings?.maxScheduledMessages || bot.settings.maxScheduledMessages
      }
    };

    await bot.update(updatedData);
    
    res.json({
      id: bot.id,
      name: bot.name,
      botIdentity: bot.botIdentity,
      isActive: bot.isActive,
      settings: bot.settings
    });
  } catch (error) {
    console.error('Erro ao atualizar bot:', error);
    res.status(500).json({ error: 'Erro ao atualizar bot' });
  }
});

app.put('/api/bots/:id/dates', authenticate, isAdmin, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) {
      return res.status(404).json({ error: 'Bot não encontrado' });
    }

    const { startDate, endDate } = req.body;
    
    await bot.update({
      startDate: startDate || bot.startDate,
      endDate: endDate || bot.endDate
    });

    res.json({
      id: bot.id,
      name: bot.name,
      startDate: bot.startDate,
      endDate: bot.endDate
    });
  } catch (error) {
    console.error('Erro ao atualizar datas do bot:', error);
    res.status(500).json({ error: 'Erro ao atualizar datas do bot' });
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

app.post('/api/bots/:id/stop', authenticate, async (req, res) => {
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

    if (bot.isActive) {
      await shutdownBot(bot.id);
    }

    await bot.update({
      isActive: false,
      lastStoppedAt: moment().format()
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao parar bot:', error);
    res.status(500).json({ error: 'Erro ao parar bot' });
  }
});

app.post('/api/bots/:id/share', authenticate, async (req, res) => {
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

    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'E-mail é obrigatório' });
    }

    const sharedWith = Array.isArray(bot.sharedWith) ? bot.sharedWith : [];
    if (!sharedWith.includes(email)) {
      sharedWith.push(email);
      await bot.update({ sharedWith });
    }

    const shareLink = `${req.protocol}://${req.get('host')}/share-bot/${bot.id}`;
    res.json({ success: true, shareLink });
  } catch (error) {
    console.error('Erro ao compartilhar bot:', error);
    res.status(500).json({ error: 'Erro ao compartilhar bot' });
  }
});

app.delete('/api/bots/:id', authenticate, async (req, res) => {
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

    if (bot.isActive) {
      await shutdownBot(bot.id);
    }

    await bot.destroy();
    
    // Remover sessão
    try {
      await fs.rm(path.join(SESSIONS_DIR, req.params.id), { recursive: true });
    } catch (err) {
      console.log(`Não foi possível remover a sessão: ${err.message}`);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar bot:', error);
    res.status(500).json({ error: 'Erro ao deletar bot' });
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

app.post('/api/bots/:botId/scheduled-messages', authenticate, async (req, res) => {
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

    const { recipient, message, scheduledTime } = req.body;
    
    if (!recipient || !message || !scheduledTime) {
      return res.status(400).json({ error: 'Destinatário, mensagem e data são obrigatórios' });
    }

    const scheduledDate = new Date(scheduledTime);
    if (scheduledDate < new Date()) {
      return res.status(400).json({ error: 'A data agendada deve ser no futuro' });
    }

    const scheduledMsg = await ScheduledMessage.create({
      botId: bot.id,
      recipient,
      message,
      scheduledTime: scheduledDate,
      status: 'pending'
    });
    
    await redisService.scheduleMessage(
      bot.id,
      scheduledMsg.id,
      recipient,
      message,
      scheduledDate
    );

    res.status(201).json({
      id: scheduledMsg.id,
      recipient: scheduledMsg.recipient,
      message: scheduledMsg.message,
      scheduledTime: scheduledMsg.scheduledTime,
      status: scheduledMsg.status
    });
  } catch (error) {
    console.error('Erro ao agendar mensagem:', error);
    res.status(500).json({ error: 'Erro ao agendar mensagem' });
  }
});

app.delete('/api/scheduled-messages/:id', authenticate, async (req, res) => {
  try {
    const message = await ScheduledMessage.findByPk(req.params.id);
    if (!message) return res.status(404).json({ error: 'Mensagem não encontrada' });

    const bot = await Bot.findByPk(message.botId);
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

    await redisService.removeScheduledMessage(message.botId, message.id);
    await message.destroy();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar mensagem agendada:', error);
    res.status(500).json({ error: 'Erro ao deletar mensagem agendada' });
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

app.post('/api/shared-bot/:botId/start', async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.botId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot não encontrado' });
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
      console.error(`Erro ao iniciar bot compartilhado ${bot.name}:`, error);
      res.status(500).json({ error: 'Erro ao iniciar bot: ' + error.message });
    }
  } catch (error) {
    console.error('Erro geral ao iniciar bot compartilhado:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.post('/api/shared-bot/:botId/stop', async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.botId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot não encontrado' });
    }

    if (bot.isActive) {
      await shutdownBot(bot.id);
    }

    await bot.update({
      isActive: false,
      lastStoppedAt: moment().format()
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao parar bot compartilhado:', error);
    res.status(500).json({ error: 'Erro ao parar bot' });
  }
});

// Middleware para verificar datas do bot
const checkBotDates = async (req, res, next) => {
  const bot = await Bot.findByPk(req.params.id || req.params.botId);
  if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

  const now = new Date();
  if (now < new Date(bot.startDate)) {
    return res.status(400).json({ 
      error: `Este bot ainda não está ativo (ativo a partir de ${moment(bot.startDate).format('DD/MM/YYYY HH:mm')})` 
    });
  }

  if (now > new Date(bot.endDate)) {
    await shutdownBot(bot.id);
    await bot.update({ isActive: false });
    return res.status(400).json({ 
      error: `Este bot expirou em ${moment(bot.endDate).format('DD/MM/YYYY HH:mm')}` 
    });
  }

  next();
};

// Rota para login
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Rota para compartilhamento de bot
app.get('/share-bot/:botId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share-bot.html'));
});

// Rota principal (redireciona para login se não autenticado)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

// Melhor tratamento de erros não tratados
process.on('unhandledRejection', (err) => {
  console.error('Erro não tratado:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Exceção não capturada:', err);
});
