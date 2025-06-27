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

const { Bot, User, Appointment } = require('./database');
const { initChatbot, shutdownBot } = require('./chatbot-module');

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

// Rotas de autenticação
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ where: { username } });
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, isAdmin: user.isAdmin });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Rotas para bots
app.get('/api/bots', authenticate, async (req, res) => {
  try {
    const bots = await Bot.findAll();
    res.json(bots);
  } catch (error) {
    console.error('Erro ao ler bots:', error);
    res.status(500).json({ error: 'Erro ao carregar bots' });
  }
});

app.get('/api/bots/:id', authenticate, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });
    res.json(bot);
  } catch (error) {
    console.error('Erro ao buscar bot:', error);
    res.status(500).json({ error: 'Erro ao buscar bot' });
  }
});

app.post('/api/bots', authenticate, async (req, res) => {
  try {
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
        humanErrorProbability: req.body.settings?.humanErrorProbability || 0.1
      },
      startDate: req.body.startDate || moment().format(),
      endDate: req.body.endDate || moment().add(30, 'days').format(),
      deviceInfo: {
        manufacturer: req.body.deviceInfo?.manufacturer || 'Google',
        model: req.body.deviceInfo?.model || 'Pixel 6',
        osVersion: req.body.deviceInfo?.osVersion || '13.0.0',
        waVersion: req.body.deviceInfo?.waVersion || '2.23.7.74'
      }
    };
    
    const newBot = await Bot.create(botData);
    res.json({ success: true, bot: newBot });
  } catch (error) {
    console.error('Erro ao criar bot:', error);
    res.status(500).json({ error: `Erro ao criar bot: ${error.message}` });
  }
});

app.put('/api/bots/:id', authenticate, async (req, res) => {
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
        humanErrorProbability: req.body.settings?.humanErrorProbability || bot.settings.humanErrorProbability
      },
      deviceInfo: req.body.deviceInfo || bot.deviceInfo
    };

    await bot.update(updatedData);
    res.json({ success: true, bot });
  } catch (error) {
    console.error('Erro ao atualizar bot:', error);
    res.status(500).json({ error: 'Erro ao atualizar bot' });
  }
});

app.post('/api/start/:botId', authenticate, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.botId);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    if (bot.isActive) return res.json({ success: true, message: 'Bot já está ativo' });

    await initChatbot(bot, io);
    await bot.update({ isActive: true, lastStartedAt: moment().format() });
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao iniciar bot:', error);
    res.status(500).json({ error: 'Erro ao iniciar bot: ' + error.message });
  }
});

app.post('/api/stop/:botId', authenticate, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.botId);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    if (bot.isActive) await shutdownBot(bot.id);
    await bot.update({ isActive: false, lastStoppedAt: moment().format() });
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao parar bot:', error);
    res.status(500).json({ error: 'Erro ao parar bot' });
  }
});

app.post('/api/bots/:id/rotate-session', authenticate, async (req, res) => {
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

// Adicione esta rota para deletar bots (coloque junto com as outras rotas de bots)
app.delete('/api/bots/:id', authenticate, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    // Parar o bot se estiver ativo
    if (bot.isActive) {
      await shutdownBot(bot.id);
    }

    // Deletar todos os agendamentos associados
    await Appointment.destroy({ where: { botId: bot.id } });

    // Deletar o bot
    await bot.destroy();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar bot:', error);
    res.status(500).json({ error: 'Erro ao deletar bot' });
  }
});

// Modifique a rota de compartilhamento para esta versão:
app.post('/api/bots/:id/share', authenticate, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    // Gerar token único para compartilhamento
    const shareToken = jwt.sign({ botId: bot.id }, JWT_SECRET, { expiresIn: '30d' });
    const shareLink = `${req.protocol}://${req.get('host')}/share-bot/${shareToken}`;
    
    // Adicionar e-mail à lista de compartilhamento se fornecido
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

// Modifique a rota de bot compartilhado para usar o token:
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

// Rota para atualizar configurações do bot
app.put('/api/bots/:id/settings', authenticate, async (req, res) => {
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
// Rota para atualizar datas do bot
app.put('/api/bots/:id/dates', authenticate, async (req, res) => {
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
app.get('/api/bots/:botId/appointments', authenticate, async (req, res) => {
  try {
    const { botId } = req.params;
    const { status } = req.query;

    const where = { botId };
    if (status) where.status = status;

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
      createdAt: app.createdAt
    })));
  } catch (error) {
    console.error('Erro ao buscar agendamentos:', error);
    res.status(500).json({ error: 'Erro ao buscar agendamentos' });
  }
});

app.put('/api/appointments/:id/status', authenticate, async (req, res) => {
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
    res.status(500).json({ error: 'Erro ao atualizar agendamento' });
  }
});

app.delete('/api/appointments/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const appointment = await Appointment.findByPk(id);
    if (!appointment) return res.status(404).json({ error: 'Agendamento não encontrado' });

    await appointment.destroy();
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar agendamento:', error);
    res.status(500).json({ error: 'Erro ao deletar agendamento' });
  }
});
app.post('/api/bots/:id/share', authenticate, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    const shareLink = `${req.protocol}://${req.get('host')}/share-bot/${bot.id}`;
    
    // Adicionar e-mail à lista de compartilhamento (opcional)
    const sharedWith = bot.sharedWith || [];
    if (req.body.email && !sharedWith.includes(req.body.email)) {
      sharedWith.push(req.body.email);
      await bot.update({ sharedWith });
    }

    res.json({ success: true, shareLink });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao compartilhar bot' });
  }
});
// Rotas públicas para bot compartilhado
app.get('/api/shared-bot/:botId', async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.botId);
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
    res.status(500).json({ error: 'Erro ao buscar informações do bot' });
  }
});

app.put('/api/shared-bot/:botId', async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.botId);
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

app.post('/api/shared-bot/:botId/start', async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.botId);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    const now = new Date();
    if (now < new Date(bot.startDate)) {
      return res.status(400).json({ error: `Este bot ainda não está ativo (ativo a partir de ${formatDate(bot.startDate)})` });
    }

    if (now > new Date(bot.endDate)) {
      return res.status(400).json({ error: `Este bot expirou em ${formatDate(bot.endDate)}` });
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

// Função auxiliar para formatar data
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('pt-BR');
}

// Rotas para login e interface
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
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








