require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
require('moment/locale/pt-br');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const { Op } = require('sequelize');

const { Bot, User, Plan, Client: ClientModel, Subscription, ScheduledMessage, sequelize } = require('./database');
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

// Criar diretório de sessões se não existir
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR);
}

// Objeto para armazenar as instâncias dos bots ativos
const activeBots = {};

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
    const user = await User.findByPk(decoded.id, {
      attributes: ['id', 'username', 'isAdmin', 'isClient']
    });
    
    if (!user) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Erro na autenticação:', error);
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
};

// Middleware para admin
const isAdmin = (req, res, next) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ 
      error: 'Acesso negado - requer privilégios de administrador' 
    });
  }
  next();
};

// Função para inicializar um bot
async function initChatbot(bot, io) {
  try {
    console.log(`[BOT] Iniciando bot ${bot.id} (${bot.name})...`);
    
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: bot.id }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ]
      },
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
      }
    });

    // Armazenar a instância do cliente
    activeBots[bot.id] = client;

    client.on('qr', async (qr) => {
      console.log(`[BOT] QR Code recebido para o bot ${bot.id}`);
      
      // Gerar QR Code como imagem base64
      const qrImage = await qrcode.toDataURL(qr);
      
      io.emit('qr-update', {
        botId: bot.id,
        qrImage,
        message: 'Escaneie o QR Code com o WhatsApp',
        botName: bot.name
      });

      // Atualizar no Redis
      await redisService.cacheSession(bot.id, { qr, status: 'waiting' });
    });

    client.on('ready', () => {
      console.log(`[BOT] ${bot.id} está pronto!`);
      io.emit('status-update', {
        botId: bot.id,
        message: 'WhatsApp conectado com sucesso!',
        status: 'connected'
      });
      
      // Atualizar no Redis
      redisService.cacheSession(bot.id, { status: 'connected' });
    });

    client.on('authenticated', () => {
      console.log(`[BOT] ${bot.id} autenticado!`);
    });

    client.on('auth_failure', (msg) => {
      console.error(`[BOT] Falha na autenticação do bot ${bot.id}:`, msg);
      io.emit('status-update', {
        botId: bot.id,
        message: 'Falha na autenticação',
        status: 'disconnected'
      });
      
      // Atualizar no Redis
      redisService.cacheSession(bot.id, { status: 'auth_failure', error: msg });
    });

    client.on('disconnected', (reason) => {
      console.log(`[BOT] ${bot.id} desconectado:`, reason);
      io.emit('status-update', {
        botId: bot.id,
        message: 'WhatsApp desconectado',
        status: 'disconnected'
      });
      
      // Remover do cache
      redisService.deleteSession(bot.id);
      delete activeBots[bot.id];
    });

    // Lógica de mensagens
    client.on('message', async (msg) => {
      try {
        // Registrar mensagem recebida
        console.log(`[BOT] Mensagem recebida no bot ${bot.id}:`, msg.body);
        
        // Verificar se é um comando
        if (msg.body.startsWith('!')) {
          const command = msg.body.slice(1).toLowerCase();
          
          // Comandos administrativos
          if (command === 'ping') {
            await msg.reply('pong');
          } else if (command === 'status') {
            await msg.reply(`🤖 Status do Bot:\nNome: ${bot.name}\nPlano: ${bot.Subscription?.Plan?.name || 'Nenhum'}\nAtivo: Sim`);
          } else if (command === 'help') {
            await msg.reply('Comandos disponíveis:\n!ping - Teste de resposta\n!status - Ver status do bot\n!help - Mostra esta ajuda');
          }
        } else {
          // Lógica de resposta automática baseada nas configurações do bot
          if (bot.settings.autoReply) {
            const typingDuration = bot.settings.typingDuration || 2;
            
            // Simular digitação
            await msg.chat.sendStateTyping();
            await new Promise(resolve => setTimeout(resolve, typingDuration * 1000));
            
            // Resposta padrão
            await msg.reply(bot.settings.defaultReply || 'Obrigado por sua mensagem. Em breve responderemos.');
          }
        }
      } catch (error) {
        console.error(`[BOT] Erro ao processar mensagem no bot ${bot.id}:`, error);
      }
    });

    // Inicializar o cliente
    await client.initialize();
    return true;
  } catch (error) {
    console.error(`[BOT] Erro ao iniciar bot ${bot.id}:`, error);
    throw error;
  }
}

// Função para desligar um bot
async function shutdownBot(botId) {
  try {
    console.log(`[BOT] Desligando bot ${botId}...`);
    
    if (activeBots[botId]) {
      await activeBots[botId].destroy();
      await redisService.deleteSession(botId);
      delete activeBots[botId];
    }
    
    return true;
  } catch (error) {
    console.error(`[BOT] Erro ao desligar bot ${botId}:`, error);
    throw error;
  }
}

// Rotas de autenticação
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }

    const user = await User.findOne({ 
      where: { username },
      attributes: ['id', 'username', 'password', 'isAdmin', 'isClient']
    });
    
    if (!user) {
      console.log(`[AUTH] Tentativa de login com usuário não encontrado: ${username}`);
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      console.log(`[AUTH] Tentativa de login com senha inválida para usuário: ${username}`);
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '8h' });
    
    let responseData = {
      token,
      isAdmin: user.isAdmin, 
      isClient: user.isClient,
      username: user.username
    };

    if (user.isClient) {
      const client = await ClientModel.findOne({ 
        where: { userId: user.id },
        include: [{
          model: Subscription,
          include: [{
            model: Bot,
            limit: 1
          }]
        }]
      });

      if (client?.Subscriptions?.[0]?.Bots?.[0]) {
        responseData.botId = client.Subscriptions[0].Bots[0].id;
      }
    }

    res.json(responseData);
  } catch (error) {
    console.error('[AUTH] Erro no login:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Rota para obter informações do usuário atual
app.get('/api/me', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ['id', 'username', 'isAdmin', 'isClient'],
      include: [{
        model: ClientModel,
        include: [{
          model: Subscription,
          include: [Plan, Bot]
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
        phone: user.Client.phone,
        company: user.Client.company,
        subscriptions: user.Client.Subscriptions.map(sub => ({
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
            name: sub.Bots[0].name,
            isActive: sub.Bots[0].isActive
          } : null
        }))
      };
    }

    res.json(userData);
  } catch (error) {
    console.error('[USER] Erro ao buscar informações do usuário:', error);
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
    console.error('[USER] Erro ao criar usuário:', error);
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
    console.error('[PLAN] Erro ao buscar planos:', error);
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
    console.error('[PLAN] Erro ao criar plano:', error);
    res.status(500).json({ error: 'Erro ao criar plano' });
  }
});

// Rotas de cliente
app.get('/api/clients', authenticate, isAdmin, async (req, res) => {
  try {
    const clients = await ClientModel.findAll({
      include: [
        {
          model: User,
          attributes: ['id', 'username']
        },
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
      phone: client.phone || '-',
      company: client.company || '-',
      notes: client.notes || '',
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
          name: sub.Bots[0].name,
          isActive: sub.Bots[0].isActive
        } : null
      }))
    }));

    res.json(formattedClients);
  } catch (error) {
    console.error('[CLIENT] Erro ao buscar clientes:', error);
    res.status(500).json({ error: 'Erro ao buscar clientes' });
  }
});

app.post('/api/clients', authenticate, isAdmin, async (req, res) => {
  try {
    const { name, email, phone, company, notes, planId } = req.body;
    
    // Validação melhorada
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }
    
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'E-mail é obrigatório' });
    }

    // Verifica formato do e-mail
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Por favor, insira um e-mail válido' });
    }

    // Verificar se email já existe
    const existingClient = await ClientModel.findOne({ where: { email } });
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
    const client = await ClientModel.create({
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
      success: true,
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
    console.error('[CLIENT] Erro ao criar cliente:', error);
    res.status(500).json({ 
      error: 'Erro ao criar cliente',
      details: error.errors?.map(e => e.message) || error.message
    });
  }
});

// Rotas para bot
app.get('/api/bots', authenticate, async (req, res) => {
  try {
    let whereCondition = {};
    let includeCondition = [{
      model: Subscription,
      include: [Plan]
    }];
    
    if (!req.user.isAdmin) {
      includeCondition = [{
        model: Subscription,
        include: [{
          model: ClientModel,
          where: { userId: req.user.id },
          required: true
        }]
      }];
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
      Plan: bot.Subscription?.Plan ? {
        id: bot.Subscription.Plan.id,
        name: bot.Subscription.Plan.name,
        price: bot.Subscription.Plan.price
      } : null,
      settings: bot.settings
    }));

    res.json(formattedBots);
  } catch (error) {
    console.error('[BOT] Erro ao carregar bots:', error);
    res.status(500).json({ error: 'Erro ao carregar bots' });
  }
});

app.get('/api/bots/:id', authenticate, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id, {
      include: [{
        model: Subscription,
        include: [Plan]
      }]
    });
    
    if (!bot) {
      return res.status(404).json({ error: 'Bot não encontrado' });
    }

    // Verificar se o usuário tem acesso a este bot
    if (!req.user.isAdmin) {
      const subscription = await Subscription.findOne({
        where: { id: bot.subscriptionId },
        include: [{
          model: ClientModel,
          where: { userId: req.user.id }
        }]
      });
      
      if (!subscription) {
        return res.status(403).json({ error: 'Acesso negado a este bot' });
      }
    }

    res.json(bot);
  } catch (error) {
    console.error('[BOT] Erro ao buscar bot:', error);
    res.status(500).json({ error: 'Erro ao buscar bot' });
  }
});

app.post('/api/bots', authenticate, async (req, res) => {
  try {
    const {
      name,
      botIdentity,
      planId,
      startDate,
      endDate,
      settings,
      apiKeys
    } = req.body;

    if (!name || !planId) {
      return res.status(400).json({ error: 'Nome e plano são obrigatórios' });
    }

    // Verificar se o usuário tem permissão para criar bot neste plano
    let subscriptionId = req.body.subscriptionId;
    
    if (!req.user.isAdmin) {
      // Para usuários não-admin, verificar se têm uma assinatura ativa para o plano
      const client = await ClientModel.findOne({
        where: { userId: req.user.id },
        include: [{
          model: Subscription,
          where: { 
            planId: planId,
            status: 'active'
          }
        }]
      });

      if (!client || !client.Subscriptions || client.Subscriptions.length === 0) {
        return res.status(403).json({ error: 'Você não tem uma assinatura ativa para este plano' });
      }

      subscriptionId = client.Subscriptions[0].id;
    }

    const bot = await Bot.create({
      id: uuidv4(),
      name,
      botIdentity: botIdentity || 'Você é um assistente virtual útil e prestativo.',
      subscriptionId,
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate: endDate ? new Date(endDate) : moment().add(1, 'month').toDate(),
      isActive: false,
      settings: settings || {
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
        maxScheduledMessages: 10,
        autoReply: true,
        defaultReply: 'Obrigado por sua mensagem. Em breve responderemos.'
      },
      apiKeys: apiKeys || {}
    });

    res.status(201).json(bot);
  } catch (error) {
    console.error('[BOT] Erro ao criar bot:', error);
    res.status(500).json({ 
      error: 'Erro ao criar bot',
      details: error.errors?.map(e => e.message) || error.message
    });
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
        where: { id: bot.subscriptionId },
        include: [{
          model: ClientModel,
          where: { userId: req.user.id }
        }]
      });
      
      if (!subscription) {
        return res.status(403).json({ error: 'Acesso negado a este bot' });
      }
    }

    const updatedBot = await bot.update(req.body);
    res.json(updatedBot);
  } catch (error) {
    console.error('[BOT] Erro ao atualizar bot:', error);
    res.status(500).json({ 
      error: 'Erro ao atualizar bot',
      details: error.errors?.map(e => e.message) || error.message
    });
  }
});

app.put('/api/bots/:id/dates', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const bot = await Bot.findByPk(req.params.id);
    
    if (!bot) {
      return res.status(404).json({ error: 'Bot não encontrado' });
    }

    // Verificar se o usuário tem acesso a este bot
    if (!req.user.isAdmin) {
      const subscription = await Subscription.findOne({
        where: { id: bot.subscriptionId },
        include: [{
          model: ClientModel,
          where: { userId: req.user.id }
        }]
      });
      
      if (!subscription) {
        return res.status(403).json({ error: 'Acesso negado a este bot' });
      }
    }

    const updates = {};
    if (startDate) updates.startDate = new Date(startDate);
    if (endDate) updates.endDate = new Date(endDate);
    
    await bot.update(updates);
    res.json({ success: true });
  } catch (error) {
    console.error('[BOT] Erro ao atualizar datas do bot:', error);
    res.status(500).json({ error: 'Erro ao atualizar datas do bot' });
  }
});

app.post('/api/bots/:id/start', authenticate, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id, {
      include: [{
        model: Subscription,
        include: [Plan]
      }]
    });
    if (!bot) {
      return res.status(404).json({ error: 'Bot não encontrado' });
    }

    // Verificar se o usuário tem acesso a este bot
    if (!req.user.isAdmin) {
      const subscription = await Subscription.findOne({
        where: { id: bot.subscriptionId },
        include: [{
          model: ClientModel,
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
        error: `Este bot ainda não está ativo (ativo a partir de ${moment(bot.startDate).format('DD/MM/YYYY HH:mm')}` 
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
      console.error(`[BOT] Erro ao iniciar bot ${bot.name}:`, error);
      res.status(500).json({ error: 'Erro ao iniciar bot: ' + error.message });
    }
  } catch (error) {
    console.error('[BOT] Erro geral ao iniciar bot:', error);
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
        where: { id: bot.subscriptionId },
        include: [{
          model: ClientModel,
          where: { userId: req.user.id }
        }]
      });
      
      if (!subscription) {
        return res.status(403).json({ error: 'Acesso negado a este bot' });
      }
    }

    if (!bot.isActive) {
      return res.json({ success: true, message: 'Bot já está inativo' });
    }

    await shutdownBot(bot.id);
    await bot.update({
      isActive: false,
      lastStoppedAt: moment().format()
    });

    res.json({ success: true });
  } catch (error) {
    console.error('[BOT] Erro ao parar bot:', error);
    res.status(500).json({ error: 'Erro ao parar bot' });
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
        where: { id: bot.subscriptionId },
        include: [{
          model: ClientModel,
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
    res.json({ success: true });
  } catch (error) {
    console.error('[BOT] Erro ao excluir bot:', error);
    res.status(500).json({ error: 'Erro ao excluir bot' });
  }
});

// Rotas para mensagens agendadas
app.get('/api/bots/:botId/scheduled-messages', authenticate, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.botId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot não encontrado' });
    }

    if (!req.user.isAdmin) {
      const subscription = await Subscription.findOne({
        where: { id: bot.subscriptionId },
        include: [{
          model: ClientModel,
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
    console.error('[SCHEDULE] Erro ao buscar mensagens agendadas:', error);
    res.status(500).json({ error: 'Erro ao buscar mensagens agendadas' });
  }
});

// Rotas para bot compartilhado (públicas)
app.get('/api/shared-bot/:botId', async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.botId, {
      include: [{
        model: Subscription,
        include: [Plan]
      }]
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
      settings: bot.settings,
      isActive: bot.isActive,
      startDate: bot.startDate,
      endDate: bot.endDate,
      plan: bot.Subscription?.Plan ? {
        name: bot.Subscription.Plan.name,
        features: bot.Subscription.Plan.features
      } : null
    });
  } catch (error) {
    console.error('[SHARED] Erro ao buscar bot compartilhado:', error);
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicialização do servidor
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Servidor rodando na porta ${PORT}`);
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (err) => {
  console.error('[ERROR] Erro não tratado:', err);
});

process.on('uncaughtException', (err) => {
  console.error('[ERROR] Exceção não capturada:', err);
});

// Função para iniciar todos os bots ativos ao iniciar o servidor
async function initializeActiveBots() {
  try {
    const activeBots = await Bot.findAll({ 
      where: { 
        isActive: true,
        startDate: { [Op.lte]: new Date() },
        endDate: { [Op.gte]: new Date() }
      },
      include: [{
        model: Subscription,
        include: [Plan]
      }]
    });

    console.log(`[SERVER] Iniciando ${activeBots.length} bots ativos...`);
    
    for (const bot of activeBots) {
      try {
        await initChatbot(bot, io);
        console.log(`[SERVER] Bot ${bot.id} (${bot.name}) iniciado com sucesso`);
      } catch (error) {
        console.error(`[SERVER] Erro ao iniciar bot ${bot.id}:`, error);
        await bot.update({ isActive: false });
      }
    }
  } catch (error) {
    console.error('[SERVER] Erro ao inicializar bots ativos:', error);
  }
}

// Inicializar bots ativos quando o servidor iniciar
initializeActiveBots();
