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

// Namespace para compartilhamento de bots
const shareBotIO = io.of('/share-bot');

const SESSIONS_DIR = path.join(__dirname, 'wpp-sessions');
const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-change-me';

// Middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware de autenticação para Socket.IO compartilhado
shareBotIO.use((socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Token não fornecido'));
    
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.botId = decoded.botId;
    next();
  } catch (error) {
    next(new Error('Autenticação falhou'));
  }
});

// Conexões Socket.IO compartilhadas
shareBotIO.on('connection', (socket) => {
  console.log(`Cliente conectado ao bot compartilhado ${socket.botId}`);

  socket.on('disconnect', () => {
    console.log(`Cliente desconectado do bot ${socket.botId}`);
  });
});

// Middleware de autenticação para API
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

// ... (outras rotas de bots permanecem iguais)

// Rotas para compartilhamento de bots
app.get('/share-bot/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share-bot.html'));
});

app.post('/api/bots/:id/share', authenticate, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    const shareToken = jwt.sign({ 
      botId: bot.id,
      permissions: ['manage']
    }, JWT_SECRET, { expiresIn: '30d' });

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
      apiKeys: {
        gemini: bot.apiKeys.gemini || '',
        openai: bot.apiKeys.openai || ''
      },
      settings: {
        preventGroupResponses: bot.settings.preventGroupResponses,
        humanErrorProbability: bot.settings.humanErrorProbability
      },
      isActive: bot.isActive,
      startDate: bot.startDate,
      endDate: bot.endDate,
      stats: {
        messagesSent: bot.stats?.messagesSent || 0,
        messagesReceived: bot.stats?.messagesReceived || 0,
        lastActivity: bot.stats?.lastActivity || null
      }
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
        gemini: req.body.apiKeys?.gemini || bot.apiKeys.gemini,
        openai: req.body.apiKeys?.openai || bot.apiKeys.openai
      },
      botIdentity: req.body.botIdentity || bot.botIdentity,
      settings: {
        preventGroupResponses: req.body.settings?.preventGroupResponses !== undefined 
          ? req.body.settings.preventGroupResponses 
          : bot.settings.preventGroupResponses,
        humanErrorProbability: req.body.settings?.humanErrorProbability !== undefined
          ? req.body.settings.humanErrorProbability
          : bot.settings.humanErrorProbability
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
      return res.status(400).json({ error: 'Este bot ainda não está ativo' });
    }

    if (now > new Date(bot.endDate)) {
      return res.status(400).json({ error: 'Este bot expirou' });
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

app.post('/api/shared-bot/:token/stop', async (req, res) => {
  try {
    const decoded = jwt.verify(req.params.token, JWT_SECRET);
    const bot = await Bot.findByPk(decoded.botId);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    if (!bot.isActive) return res.json({ success: true, message: 'Bot já está inativo' });

    await shutdownBot(bot.id);
    await bot.update({ isActive: false, lastStoppedAt: moment().format() });
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao parar bot compartilhado:', error);
    res.status(500).json({ error: 'Erro ao parar bot' });
  }
});

// Rotas para interface
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
