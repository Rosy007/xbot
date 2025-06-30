require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const moment = require('moment');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('moment/locale/pt-br');
const { v4: uuidv4 } = require('uuid');

const { Plan, Client, Subscription, User, Bot, Appointment, sequelize } = require('./database');
const { initChatbot, shutdownBot, isBotActive } = require('./chatbot-module');

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

// Middleware para verificar se é admin
const isAdmin = (req, res, next) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Acesso negado - requer privilégios de administrador' });
  }
  next();
};

// Middleware para verificar se é admin ou admin do cliente
const isAdminOrClientAdmin = async (req, res, next) => {
  if (req.user.isAdmin) return next();
  
  if (req.params.botId) {
    const bot = await Bot.findByPk(req.params.botId);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });
    if (bot.clientId !== req.user.clientId) {
      return res.status(403).json({ error: 'Acesso negado - você não tem permissão para este bot' });
    }
    return next();
  }
  
  if (req.params.clientId) {
    if (req.params.clientId !== req.user.clientId) {
      return res.status(403).json({ error: 'Acesso negado - você não tem permissão para este cliente' });
    }
    return next();
  }

  return res.status(403).json({ error: 'Acesso negado' });
};

// Rotas de autenticação
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ where: { username } });
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ 
      token, 
      isAdmin: user.isAdmin,
      isClientAdmin: user.isClientAdmin,
      clientId: user.clientId
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Rotas para Planos (apenas admin)
app.get('/api/plans', authenticate, isAdmin, async (req, res) => {
  try {
    const plans = await Plan.findAll();
    res.json(plans);
  } catch (error) {
    console.error('Erro ao buscar planos:', error);
    res.status(500).json({ error: 'Erro ao buscar planos' });
  }
});

app.post('/api/plans', authenticate, isAdmin, async (req, res) => {
  try {
    const newPlan = await Plan.create(req.body);
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

    await plan.update(req.body);
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

    await plan.destroy();
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar plano:', error);
    res.status(500).json({ error: 'Erro ao deletar plano' });
  }
});

// Rotas para Clientes (apenas admin)
app.get('/api/clients', authenticate, isAdmin, async (req, res) => {
  try {
    const clients = await Client.findAll({
      include: [{
        model: Subscription,
        include: [Plan]
      }]
    });
    res.json(clients);
  } catch (error) {
    console.error('Erro ao buscar clientes:', error);
    res.status(500).json({ error: 'Erro ao buscar clientes' });
  }
});

app.post('/api/clients', authenticate, isAdmin, async (req, res) => {
  try {
    const newClient = await Client.create(req.body);
    res.status(201).json(newClient);
  } catch (error) {
    console.error('Erro ao criar cliente:', error);
    res.status(500).json({ error: 'Erro ao criar cliente' });
  }
});

app.get('/api/clients/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const client = await Client.findByPk(req.params.id, {
      include: [
        {
          model: Subscription,
          include: [Plan]
        },
        {
          model: User
        },
        {
          model: Bot
        }
      ]
    });
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(client);
  } catch (error) {
    console.error('Erro ao buscar cliente:', error);
    res.status(500).json({ error: 'Erro ao buscar cliente' });
  }
});

app.put('/api/clients/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const client = await Client.findByPk(req.params.id);
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

    await client.update(req.body);
    res.json(client);
  } catch (error) {
    console.error('Erro ao atualizar cliente:', error);
    res.status(500).json({ error: 'Erro ao atualizar cliente' });
  }
});

app.delete('/api/clients/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const client = await Client.findByPk(req.params.id);
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

    const activeBots = await Bot.count({ where: { clientId: client.id, isActive: true } });
    if (activeBots > 0) {
      return res.status(400).json({ error: 'Não é possível deletar cliente com bots ativos' });
    }

    await client.destroy();
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar cliente:', error);
    res.status(500).json({ error: 'Erro ao deletar cliente' });
  }
});

// Rotas para Assinaturas
app.post('/api/clients/:clientId/subscriptions', authenticate, isAdmin, async (req, res) => {
  try {
    const client = await Client.findByPk(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

    const plan = await Plan.findByPk(req.body.planId);
    if (!plan) return res.status(404).json({ error: 'Plano não encontrado' });

    const endDate = moment().add(plan.duration, 'days').toDate();

    const subscription = await Subscription.create({
      clientId: client.id,
      planId: plan.id,
      startDate: new Date(),
      endDate,
      status: 'active',
      paymentMethod: req.body.paymentMethod || 'credit_card'
    });

    res.status(201).json(subscription);
  } catch (error) {
    console.error('Erro ao criar assinatura:', error);
    res.status(500).json({ error: 'Erro ao criar assinatura' });
  }
});

app.put('/api/subscriptions/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const subscription = await Subscription.findByPk(req.params.id);
    if (!subscription) return res.status(404).json({ error: 'Assinatura não encontrada' });

    await subscription.update(req.body);
    res.json(subscription);
  } catch (error) {
    console.error('Erro ao atualizar assinatura:', error);
    res.status(500).json({ error: 'Erro ao atualizar assinatura' });
  }
});

// Rotas para verificar limites de plano
app.get('/api/clients/:clientId/bot-limits', authenticate, isAdminOrClientAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    const subscription = await Subscription.findOne({
      where: {
        clientId,
        status: 'active',
        endDate: { [Sequelize.Op.gte]: new Date() }
      },
      include: [Plan]
    });

    if (!subscription) {
      return res.json({
        hasActivePlan: false,
        maxBots: 0,
        usedBots: 0,
        remainingBots: 0,
        planName: 'Nenhum plano ativo'
      });
    }

    const botCount = await Bot.count({ where: { clientId } });
    
    res.json({
      hasActivePlan: true,
      maxBots: subscription.Plan.maxBots,
      usedBots: botCount,
      remainingBots: subscription.Plan.maxBots === -1 ? 'Ilimitado' : Math.max(0, subscription.Plan.maxBots - botCount),
      planName: subscription.Plan.name,
      planEndDate: subscription.endDate
    });
  } catch (error) {
    console.error('Erro ao verificar limites:', error);
    res.status(500).json({ error: 'Erro ao verificar limites' });
  }
});

// Rotas para Usuários
app.get('/api/users', authenticate, isAdmin, async (req, res) => {
  try {
    const users = await User.findAll();
    res.json(users);
  } catch (error) {
    console.error('Erro ao buscar usuários:', error);
    res.status(500).json({ error: 'Erro ao buscar usuários' });
  }
});

app.post('/api/users', authenticate, isAdmin, async (req, res) => {
  try {
    const { username, password, isAdmin, isClientAdmin, clientId } = req.body;

    if (isClientAdmin && !clientId) {
      return res.status(400).json({ error: 'clientId é obrigatório para clientAdmin' });
    }

    const user = await User.create({
      username,
      password,
      isAdmin: isAdmin || false,
      isClientAdmin: isClientAdmin || false,
      clientId: isClientAdmin ? clientId : null
    });

    res.status(201).json({
      id: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      isClientAdmin: user.isClientAdmin,
      clientId: user.clientId
    });
  } catch (error) {
    console.error('Erro ao criar usuário:', error);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

app.put('/api/users/:id', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    if (req.user.id !== user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const updates = {};
    if (req.body.username) updates.username = req.body.username;
    if (req.body.password) updates.password = await bcrypt.hash(req.body.password, 10);
    
    if (req.user.isAdmin) {
      if (req.body.isAdmin !== undefined) updates.isAdmin = req.body.isAdmin;
      if (req.body.isClientAdmin !== undefined) updates.isClientAdmin = req.body.isClientAdmin;
      if (req.body.clientId !== undefined) updates.clientId = req.body.clientId;
    }

    await user.update(updates);
    res.json({
      id: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      isClientAdmin: user.isClientAdmin,
      clientId: user.clientId
    });
  } catch (error) {
    console.error('Erro ao atualizar usuário:', error);
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

app.delete('/api/users/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    if (req.user.id === user.id) {
      return res.status(400).json({ error: 'Não é possível deletar seu próprio usuário' });
    }

    await user.destroy();
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar usuário:', error);
    res.status(500).json({ error: 'Erro ao deletar usuário' });
  }
});

// Rotas para bots (com verificação de permissões)
app.get('/api/bots', authenticate, async (req, res) => {
  try {
    let where = {};
    if (!req.user.isAdmin) {
      where.clientId = req.user.clientId;
    }

    const bots = await Bot.findAll({ where });
    res.json(bots);
  } catch (error) {
    console.error('Erro ao ler bots:', error);
    res.status(500).json({ error: 'Erro ao carregar bots' });
  }
});

app.get('/api/bots/:id', authenticate, isAdminOrClientAdmin, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });
    res.json(bot);
  } catch (error) {
    console.error('Erro ao buscar bot:', error);
    res.status(500).json({ error: 'Erro ao buscar bot' });
  }
});

app.post('/api/bots', authenticate, isAdminOrClientAdmin, async (req, res) => {
  try {
    const clientId = req.user.isAdmin ? req.body.clientId : req.user.clientId;
    
    // Verificar limites do plano
    const limitsResponse = await fetch(`http://localhost:${process.env.PORT || 3000}/api/clients/${clientId}/bot-limits`, {
      headers: { 'Authorization': `Bearer ${req.headers.authorization.split(' ')[1]}` }
    });
    
    if (!limitsResponse.ok) {
      throw new Error('Erro ao verificar limites do plano');
    }
    
    const limits = await limitsResponse.json();

    if (!limits.hasActivePlan) {
      return res.status(400).json({ error: 'Cliente não possui um plano ativo' });
    }

    if (limits.maxBots !== -1 && limits.usedBots >= limits.maxBots) {
      return res.status(400).json({ 
        error: `Limite de bots atingido (${limits.usedBots}/${limits.maxBots})`,
        upgradeUrl: '/plans'
      });
    }

    const botId = uuidv4();
    const botData = {
      id: botId,
      name: req.body.name || `Bot ${(await Bot.count()) + 1}`,
      apiKeys: {
        gemini: req.body.apiKeys?.gemini || '',
        openai: req.body.apiKeys?.openai || ''
      },
      botIdentity: req.body.botIdentity || 'Você é um assistente útil. Responda de forma natural e humana.',
      sessionId: uuidv4(),
      createdAt: moment().format(),
      settings: {
        preventGroupResponses: req.body.settings?.preventGroupResponses !== undefined 
          ? req.body.settings.preventGroupResponses 
          : true,
        maxResponseLength: req.body.settings?.maxResponseLength || 200,
        responseDelay: req.body.settings?.responseDelay || 3,
        typingIndicator: req.body.settings?.typingIndicator !== undefined 
          ? req.body.settings.typingIndicator 
          : true,
        typingDuration: req.body.settings?.typingDuration || 3,
        humanControlTimeout: req.body.settings?.humanControlTimeout || 30,
        messagesPerMinute: req.body.settings?.messagesPerMinute || 5,
        responseVariation: req.body.settings?.responseVariation || 0.3,
        typingVariation: req.body.settings?.typingVariation || 0.8,
        avoidRepetition: req.body.settings?.avoidRepetition !== undefined 
          ? req.body.settings.avoidRepetition 
          : true,
        humanErrorProbability: req.body.settings?.humanErrorProbability || 0.1
      },
      startDate: req.body.startDate || moment().format(),
      endDate: req.body.endDate || moment().add(30, 'days').format(),
      deviceInfo: {
        manufacturer: req.body.deviceInfo?.manufacturer || 'Google',
        model: req.body.deviceInfo?.model || 'Pixel 6',
        osVersion: req.body.deviceInfo?.osVersion || '13.0.0',
        waVersion: req.body.deviceInfo?.waVersion || '2.23.7.74'
      },
      clientId: clientId
    };
    
    const newBot = await Bot.create(botData);
    res.json({ success: true, bot: newBot });
  } catch (error) {
    console.error('Erro ao criar bot:', error);
    res.status(500).json({ error: `Erro ao criar bot: ${error.message}` });
  }
});

app.put('/api/bots/:id', authenticate, isAdminOrClientAdmin, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    const updatedData = {
      name: req.body.name || bot.name,
      apiKeys: {
        gemini: req.body.apiKeys?.gemini || bot.apiKeys.gemini,
        openai: req.body.apiKeys?.openai || bot.apiKeys.openai
      },
      botIdentity: req.body.botIdentity || bot.botIdentity,
      settings: {
        preventGroupResponses: req.body.settings?.preventGroupResponses !== undefined 
          ? req.body.settings.preventGroupResponses 
          : bot.settings.preventGroupResponses,
        maxResponseLength: req.body.settings?.maxResponseLength || bot.settings.maxResponseLength,
        responseDelay: req.body.settings?.responseDelay || bot.settings.responseDelay,
        typingIndicator: req.body.settings?.typingIndicator !== undefined 
          ? req.body.settings.typingIndicator 
          : bot.settings.typingIndicator,
        typingDuration: req.body.settings?.typingDuration || bot.settings.typingDuration,
        humanControlTimeout: req.body.settings?.humanControlTimeout || bot.settings.humanControlTimeout,
        messagesPerMinute: req.body.settings?.messagesPerMinute || bot.settings.messagesPerMinute,
        responseVariation: req.body.settings?.responseVariation || bot.settings.responseVariation,
        typingVariation: req.body.settings?.typingVariation || bot.settings.typingVariation,
        avoidRepetition: req.body.settings?.avoidRepetition !== undefined 
          ? req.body.settings.avoidRepetition 
          : bot.settings.avoidRepetition,
        humanErrorProbability: req.body.settings?.humanErrorProbability || bot.settings.humanErrorProbability
      },
      deviceInfo: req.body.deviceInfo || bot.deviceInfo
    };

    if (req.user.isAdmin && req.body.clientId) {
      updatedData.clientId = req.body.clientId;
    }

    await bot.update(updatedData);
    res.json({ success: true, bot });
  } catch (error) {
    console.error('Erro ao atualizar bot:', error);
    res.status(500).json({ error: 'Erro ao atualizar bot' });
  }
});

app.post('/api/start/:botId', authenticate, isAdminOrClientAdmin, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.botId);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    const now = new Date();
    if (now < new Date(bot.startDate)) {
      return res.status(400).json({ error: `Este bot ainda não está ativo (ativo a partir de ${moment(bot.startDate).format('DD/MM/YYYY HH:mm')})` });
    }

    if (now > new Date(bot.endDate)) {
      return res.status(400).json({ error: `Este bot expirou em ${moment(bot.endDate).format('DD/MM/YYYY HH:mm')}` });
    }

    if (bot.isActive) return res.json({ success: true, message: 'Bot já está ativo' });

    await initChatbot(bot, io);
    await bot.update({ isActive: true, lastStartedAt: moment().format() });
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao iniciar bot:', error);
    res.status(500).json({ error: 'Erro ao iniciar bot: ' + error.message });
  }
});

app.post('/api/stop/:botId', authenticate, isAdminOrClientAdmin, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.botId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot não encontrado' });
    }

    const isActuallyActive = isBotActive(bot.id);
    
    if (!bot.isActive && !isActuallyActive) {
      return res.json({ 
        success: true, 
        message: 'Bot já estava inativo' 
      });
    }

    if (bot.isActive && !isActuallyActive) {
      await bot.update({ isActive: false, lastStoppedAt: moment().format() });
      return res.json({ 
        success: true, 
        message: 'Estado corrigido: bot marcado como inativo' 
      });
    }

    const shutdownResult = await shutdownBot(bot.id);
    
    if (!shutdownResult) {
      await bot.update({ isActive: false, lastStoppedAt: moment().format() });
      return res.status(500).json({ 
        error: 'Falha ao desligar o bot corretamente, mas status foi atualizado' 
      });
    }

    await bot.update({ isActive: false, lastStoppedAt: moment().format() });
    
    res.json({ 
      success: true,
      message: 'Bot parado com sucesso'
    });
    
  } catch (error) {
    console.error('Erro ao parar bot:', error);
    res.status(500).json({ 
      error: 'Erro ao parar bot: ' + error.message 
    });
  }
});

app.post('/api/bots/:id/rotate-session', authenticate, isAdminOrClientAdmin, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    const manufacturers = ['Samsung', 'Xiaomi', 'Google', 'OnePlus', 'Motorola'];
    const models = {
      Samsung: ['Galaxy S23', 'Galaxy S22', 'Galaxy A54', 'Galaxy A34'],
      Xiaomi: ['Redmi Note 12', 'Redmi Note 11', 'Mi 11', 'Mi 12'],
      Google: ['Pixel 7', 'Pixel 6', 'Pixel 6a', 'Pixel 7a'],
      OnePlus: ['11', '10 Pro', '9 Pro', 'Nord 3'],
      Motorola: ['Edge 30', 'Edge 20', 'G82', 'G72']
    };
    
    const manufacturer = manufacturers[Math.floor(Math.random() * manufacturers.length)];
    const model = models[manufacturer][Math.floor(Math.random() * models[manufacturer].length)];
    const osVersion = `${Math.floor(Math.random() * 5) + 10}.0.${Math.floor(Math.random() * 5)}`;
    const waVersion = `2.${Math.floor(Math.random() * 10) + 20}.${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 50) + 50}`;

    await bot.update({
      deviceInfo: { manufacturer, model, osVersion, waVersion },
      sessionId: uuidv4()
    });

    if (bot.isActive) {
      await shutdownBot(bot.id);
      await initChatbot(bot, io);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao rotacionar sessão:', error);
    res.status(500).json({ error: 'Erro ao rotacionar sessão' });
  }
});

app.delete('/api/bots/:id', authenticate, isAdminOrClientAdmin, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    if (bot.isActive) {
      const shutdownResult = await shutdownBot(bot.id);
      if (!shutdownResult) {
        throw new Error('Falha ao desligar o bot antes da exclusão');
      }
    }

    await Appointment.destroy({ where: { botId: bot.id } });
    await bot.destroy();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar bot:', error);
    res.status(500).json({ error: 'Erro ao deletar bot: ' + error.message });
  }
});

app.post('/api/bots/:id/share', authenticate, isAdminOrClientAdmin, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    const shareToken = jwt.sign({ botId: bot.id }, JWT_SECRET, { expiresIn: '30d' });
    const shareLink = `${req.protocol}://${req.get('host')}/share-bot/${shareToken}`;
    
    if (req.body.email) {
      const sharedWith = bot.sharedWith || [];
      if (!sharedWith.includes(req.body.email)) {
        sharedWith.push(req.body.email);
        await bot.update({ sharedWith });
      }
    }
    
    res.json({ 
      success: true, 
      shareLink,
      shareToken
    });
  } catch (error) {
    console.error('Erro ao compartilhar bot:', error);
    res.status(500).json({ error: 'Erro ao compartilhar bot' });
  }
});

app.get('/api/shared-bot/:token', async (req, res) => {
  try {
    const decoded = jwt.verify(req.params.token, JWT_SECRET);
    const bot = await Bot.findByPk(decoded.botId);
    
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });
    
    res.json({
      id: bot.id,
      name: bot.name,
      botIdentity: bot.botIdentity,
      apiKeys: { gemini: !!bot.apiKeys.gemini, openai: !!bot.apiKeys.openai },
      settings: {
        preventGroupResponses: bot.settings.preventGroupResponses,
        typingIndicator: bot.settings.typingIndicator,
        humanControlTimeout: bot.settings.humanControlTimeout,
        messagesPerMinute: bot.settings.messagesPerMinute,
        responseVariation: bot.settings.responseVariation,
        humanErrorProbability: bot.settings.humanErrorProbability
      },
      isActive: bot.isActive,
      startDate: bot.startDate,
      endDate: bot.endDate,
      stats: bot.stats
    });
  } catch (error) {
    console.error('Erro ao buscar bot compartilhado:', error);
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
});

app.put('/api/shared-bot/:token', async (req, res) => {
  try {
    const decoded = jwt.verify(req.params.token, JWT_SECRET);
    const bot = await Bot.findByPk(decoded.botId);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    const updatedData = {
      apiKeys: {
        ...bot.apiKeys,
        ...(req.body.apiKeys && {
          gemini: req.body.apiKeys.gemini || bot.apiKeys.gemini,
          openai: req.body.apiKeys.openai || bot.apiKeys.openai
        })
      },
      botIdentity: req.body.botIdentity || bot.botIdentity,
      settings: {
        ...bot.settings,
        ...(req.body.settings && {
          preventGroupResponses: req.body.settings.preventGroupResponses !== undefined 
            ? req.body.settings.preventGroupResponses 
            : bot.settings.preventGroupResponses,
          humanControlTimeout: req.body.settings.humanControlTimeout || bot.settings.humanControlTimeout,
          humanErrorProbability: req.body.settings.humanErrorProbability !== undefined
            ? req.body.settings.humanErrorProbability
            : bot.settings.humanErrorProbability
        })
      }
    };

    await bot.update(updatedData);
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao atualizar bot compartilhado:', error);
    res.status(500).json({ error: 'Erro ao atualizar configurações do bot' });
  }
});

app.post('/api/shared-bot/:token/start', async (req, res) => {
  try {
    const decoded = jwt.verify(req.params.token, JWT_SECRET);
    const bot = await Bot.findByPk(decoded.botId);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    const now = new Date();
    if (now < new Date(bot.startDate)) {
      return res.status(400).json({ error: `Este bot ainda não está ativo (ativo a partir de ${moment(bot.startDate).format('DD/MM/YYYY HH:mm')})` });
    }

    if (now > new Date(bot.endDate)) {
      return res.status(400).json({ error: `Este bot expirou em ${moment(bot.endDate).format('DD/MM/YYYY HH:mm')}` });
    }

    if (bot.isActive) return res.json({ success: true, message: 'Bot já está ativo' });

    await initChatbot(bot, io);
    await bot.update({ isActive: true, lastStartedAt: moment().format() });
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao iniciar bot compartilhado:', error);
    res.status(500).json({ error: 'Erro ao iniciar bot: ' + error.message });
  }
});

app.put('/api/bots/:id/settings', authenticate, isAdminOrClientAdmin, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    const updatedSettings = {
      ...bot.settings,
      preventGroupResponses: req.body.preventGroupResponses !== undefined ? req.body.preventGroupResponses : bot.settings.preventGroupResponses,
      typingIndicator: req.body.typingIndicator !== undefined ? req.body.typingIndicator : bot.settings.typingIndicator,
      typingDuration: req.body.typingDuration || bot.settings.typingDuration,
      responseDelay: req.body.responseDelay || bot.settings.responseDelay,
      maxResponseLength: req.body.maxResponseLength || bot.settings.maxResponseLength,
      humanControlTimeout: req.body.humanControlTimeout || bot.settings.humanControlTimeout,
      messagesPerMinute: req.body.messagesPerMinute || bot.settings.messagesPerMinute,
      responseVariation: req.body.responseVariation || bot.settings.responseVariation,
      typingVariation: req.body.typingVariation || bot.settings.typingVariation,
      avoidRepetition: req.body.avoidRepetition !== undefined ? req.body.avoidRepetition : bot.settings.avoidRepetition,
      humanErrorProbability: req.body.humanErrorProbability !== undefined ? req.body.humanErrorProbability : bot.settings.humanErrorProbability
    };

    await bot.update({ settings: updatedSettings });
    res.json({ success: true, bot });
  } catch (error) {
    console.error('Erro ao atualizar configurações:', error);
    res.status(500).json({ error: 'Erro ao atualizar configurações' });
  }
});

app.put('/api/bots/:id/dates', authenticate, isAdminOrClientAdmin, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    await bot.update({
      startDate: req.body.startDate || bot.startDate,
      endDate: req.body.endDate || bot.endDate
    });
    
    res.json({ success: true, bot });
  } catch (error) {
    console.error('Erro ao atualizar datas:', error);
    res.status(500).json({ error: 'Erro ao atualizar datas do bot' });
  }
});

// Rotas para agendamentos
app.get('/api/bots/:botId/appointments', authenticate, isAdminOrClientAdmin, async (req, res) => {
  try {
    const { botId } = req.params;
    const { status } = req.query;

    const where = { botId };
    if (status && ['pending', 'confirmed', 'canceled'].includes(status)) {
      where.status = status;
    }

    const appointments = await Appointment.findAll({
      where,
      order: [['appointmentDate', 'ASC']]
    });

    res.json(appointments.map(app => ({
      id: app.id,
      name: app.name,
      description: app.description,
      contact: app.contact,
      appointmentDate: app.appointmentDate,
      status: app.status,
      createdAt: app.createdAt,
      remindedOneDayBefore: app.remindedOneDayBefore,
      remindedOneHourBefore: app.remindedOneHourBefore
    })));
  } catch (error) {
    console.error('Erro ao buscar agendamentos:', error);
    res.status(500).json({ error: 'Erro ao buscar agendamentos: ' + error.message });
  }
});

app.put('/api/appointments/:id/status', authenticate, isAdminOrClientAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'confirmed', 'canceled'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }

    const appointment = await Appointment.findByPk(id);
    if (!appointment) return res.status(404).json({ error: 'Agendamento não encontrado' });

    await appointment.update({ status });
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao atualizar agendamento:', error);
    res.status(500).json({ error: 'Erro ao atualizar agendamento: ' + error.message });
  }
});

app.delete('/api/appointments/:id', authenticate, isAdminOrClientAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const appointment = await Appointment.findByPk(id);
    if (!appointment) return res.status(404).json({ error: 'Agendamento não encontrado' });

    await appointment.destroy();
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar agendamento:', error);
    res.status(500).json({ error: 'Erro ao deletar agendamento: ' + error.message });
  }
});

// Rotas para login e interface
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/share-bot/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share-bot.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

process.on('unhandledRejection', (err) => {
  console.error('Erro não tratado:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Exceção não capturada:', err);
});

















