// server.js
require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const moment = require('moment');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('moment/locale/pt-br');

const { Bot, User, Plan, Client, Subscription, ScheduledMessage } = require('./database');
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
const isAdmin = (req, res, next) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Acesso negado - requer privilégios de administrador' });
  }
  next();
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
    res.json({ token, isAdmin: user.isAdmin, isClient: user.isClient });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Rotas de plano
app.get('/api/plans', authenticate, async (req, res) => {
  try {
    const plans = await Plan.findAll({ where: { isActive: true } });
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

// Rotas de cliente
app.get('/api/clients', authenticate, isAdmin, async (req, res) => {
  try {
    const clients = await Client.findAll({
      include: [User, { model: Subscription, include: [Plan] }]
    });
    res.json(clients);
  } catch (error) {
    console.error('Erro ao buscar clientes:', error);
    res.status(500).json({ error: 'Erro ao buscar clientes' });
  }
});

app.post('/api/clients', authenticate, isAdmin, async (req, res) => {
  try {
    const { name, email, phone, company, notes, planId } = req.body;
    
    // Criar usuário para o cliente
    const username = email.split('@')[0] + Math.floor(Math.random() * 1000);
    const tempPassword = Math.random().toString(36).slice(-8);
    
    const user = await User.create({
      username,
      password: tempPassword,
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
    if (planId) {
      const plan = await Plan.findByPk(planId);
      if (plan) {
        await Subscription.create({
          clientId: client.id,
          planId: plan.id,
          startDate: new Date(),
          endDate: moment().add(1, 'month').toDate(),
          status: 'active'
        });
      }
    }
    
    res.status(201).json({ client, tempPassword });
  } catch (error) {
    console.error('Erro ao criar cliente:', error);
    res.status(500).json({ error: 'Erro ao criar cliente' });
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

// Rotas de assinatura
app.post('/api/clients/:clientId/subscriptions', authenticate, isAdmin, async (req, res) => {
  try {
    const { planId, startDate, endDate } = req.body;
    
    const subscription = await Subscription.create({
      clientId: req.params.clientId,
      planId,
      startDate: startDate || new Date(),
      endDate: endDate || moment().add(1, 'month').toDate(),
      status: 'active'
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

// Rotas para mensagens agendadas
app.get('/api/bots/:botId/scheduled-messages', authenticate, async (req, res) => {
  try {
    const messages = await ScheduledMessage.findAll({
      where: { botId: req.params.botId },
      order: [['scheduledTime', 'ASC']]
    });
    res.json(messages);
  } catch (error) {
    console.error('Erro ao buscar mensagens agendadas:', error);
    res.status(500).json({ error: 'Erro ao buscar mensagens agendadas' });
  }
});

app.delete('/api/scheduled-messages/:id', authenticate, async (req, res) => {
  try {
    const message = await ScheduledMessage.findByPk(req.params.id);
    if (!message) return res.status(404).json({ error: 'Mensagem não encontrada' });

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

app.put('/api/shared-bot/:botId', async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.botId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot não encontrado' });
    }

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
          maxMessagesPerHour: req.body.settings.maxMessagesPerHour || bot.settings.maxMessagesPerHour,
          minResponseDelay: req.body.settings.minResponseDelay || bot.settings.minResponseDelay,
          maxResponseDelay: req.body.settings.maxResponseDelay || bot.settings.maxResponseDelay,
          humanLikeMistakes: req.body.settings.humanLikeMistakes || bot.settings.humanLikeMistakes,
          allowScheduling: req.body.settings.allowScheduling !== undefined 
            ? req.body.settings.allowScheduling 
            : bot.settings.allowScheduling,
          maxScheduledMessages: req.body.settings.maxScheduledMessages || bot.settings.maxScheduledMessages
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

app.post('/api/shared-bot/:botId/start', async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.botId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot não encontrado' });
    }

    // Verificar datas do bot
    const now = new Date();
    if (now < new Date(bot.startDate)) {
      return res.status(400).json({ error: `Este bot ainda não está ativo (ativo a partir de ${formatDate(bot.startDate)})` });
    }

    if (now > new Date(bot.endDate)) {
      return res.status(400).json({ error: `Este bot expirou em ${formatDate(bot.endDate)}` });
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
    return res.status(400).json({ error: `Este bot ainda não está ativo (ativo a partir de ${formatDate(bot.startDate)})` });
  }

  if (now > new Date(bot.endDate)) {
    await shutdownBot(bot.id);
    await bot.update({ isActive: false });
    return res.status(400).json({ error: `Este bot expirou em ${formatDate(bot.endDate)}` });
  }

  next();
};

// Função auxiliar para formatar data
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('pt-BR');
}

// Rotas protegidas
app.get('/api/bots', authenticate, async (req, res) => {
  try {
    let whereCondition = {};
    
    // Se não for admin, mostrar apenas bots associados ao usuário
    if (!req.user.isAdmin) {
      whereCondition = { '$Plan.Subscriptions.Client.userId$': req.user.id };
    }
    
    const bots = await Bot.findAll({
      where: whereCondition,
      include: [{
        model: Plan,
        include: [{
          model: Subscription,
          include: [{
            model: Client,
            where: { userId: req.user.isAdmin ? undefined : req.user.id },
            required: !req.user.isAdmin
          }]
        }]
      }]
    });
    
    res.json(bots);
  } catch (error) {
    console.error('Erro ao ler bots:', error);
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
    
    res.json(bot);
  } catch (error) {
    console.error('Erro ao buscar bot:', error);
    res.status(500).json({ error: 'Erro ao buscar bot' });
  }
});

app.post('/api/bots', authenticate, isAdmin, async (req, res) => {
  try {
    const botId = require('uuid').v4();
    
    const botData = {
      id: botId,
      name: req.body.name || `Bot ${(await Bot.count()) + 1}`,
      apiKeys: {
        gemini: req.body.apiKeys?.gemini || '',
        openai: req.body.apiKeys?.openai || ''
      },
      botIdentity: req.body.botIdentity || 'Você é um assistente útil. Responda de forma natural e humana.',
      sessionId: require('uuid').v4(),
      createdAt: moment().format(),
      settings: {
        preventGroupResponses: req.body.settings?.preventGroupResponses !== undefined 
          ? req.body.settings.preventGroupResponses 
          : true,
        maxResponseLength: req.body.settings?.maxResponseLength || 200,
        responseDelay: req.body.settings?.responseDelay || 2,
        typingIndicator: req.body.settings?.typingIndicator !== undefined 
          ? req.body.settings.typingIndicator 
          : true,
        typingDuration: req.body.settings?.typingDuration || 2,
        humanControlTimeout: req.body.settings?.humanControlTimeout || 30,
        maxMessagesPerHour: req.body.settings?.maxMessagesPerHour || 20,
        minResponseDelay: req.body.settings?.minResponseDelay || 1,
        maxResponseDelay: req.body.settings?.maxResponseDelay || 5,
        typingVariance: req.body.settings?.typingVariance || 0.5,
        humanLikeMistakes: req.body.settings?.humanLikeMistakes || 0.05,
        conversationCooldown: req.body.settings?.conversationCooldown || 300,
        allowScheduling: req.body.settings?.allowScheduling !== undefined 
          ? req.body.settings.allowScheduling 
          : false,
        maxScheduledMessages: req.body.settings?.maxScheduledMessages || 10
      },
      startDate: req.body.startDate || moment().format(),
      endDate: req.body.endDate || moment().add(30, 'days').format(),
      planId: req.body.planId
    };
    
    const newBot = await Bot.create(botData);
    res.json({ success: true, bot: newBot });
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
        maxMessagesPerHour: req.body.settings?.maxMessagesPerHour || bot.settings.maxMessagesPerHour,
        minResponseDelay: req.body.settings?.minResponseDelay || bot.settings.minResponseDelay,
        maxResponseDelay: req.body.settings?.maxResponseDelay || bot.settings.maxResponseDelay,
        typingVariance: req.body.settings?.typingVariance || bot.settings.typingVariance,
        humanLikeMistakes: req.body.settings?.humanLikeMistakes || bot.settings.humanLikeMistakes,
        conversationCooldown: req.body.settings?.conversationCooldown || bot.settings.conversationCooldown,
        allowScheduling: req.body.settings?.allowScheduling !== undefined 
          ? req.body.settings.allowScheduling 
          : bot.settings.allowScheduling,
        maxScheduledMessages: req.body.settings?.maxScheduledMessages || bot.settings.maxScheduledMessages
      }
    };

    await bot.update(updatedData);
    res.json({ success: true, bot });
  } catch (error) {
    console.error('Erro ao atualizar bot:', error);
    res.status(500).json({ error: 'Erro ao atualizar bot' });
  }
});

app.post('/api/start/:botId', authenticate, checkBotDates, async (req, res) => {
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
    console.error('Erro geral:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.post('/api/stop/:botId', authenticate, async (req, res) => {
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
      await fs.promises.rm(path.join(SESSIONS_DIR, req.params.id), { recursive: true });
    } catch (err) {
      console.log(`Não foi possível remover a sessão: ${err.message}`);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar bot:', error);
    res.status(500).json({ error: 'Erro ao deletar bot' });
  }
});

// Rota para login
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
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
