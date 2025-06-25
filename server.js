require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const moment = require('moment');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('moment/locale/pt-br');

const { Bot, User } = require('./database');
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
      avoidRepetition: req.body.avoidRepetition !== undefined ? req.body.avoidRepetition : bot.settings.avoidRepetition
    };

    await bot.update({ settings: updatedSettings });
    res.json({ success: true, bot });
  } catch (error) {
    console.error('Erro ao atualizar configurações:', error);
    res.status(500).json({ error: 'Erro ao atualizar configurações' });
  }
});

// Rotas para estatísticas
app.get('/api/bots/:id/stats', authenticate, async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

    res.json({
      messagesSent: bot.stats.messagesSent || 0,
      messagesReceived: bot.stats.messagesReceived || 0,
      lastActivity: bot.stats.lastActivity || null
    });
  } catch (error) {
    console.error('Erro ao obter estatísticas:', error);
    res.status(500).json({ error: 'Erro ao obter estatísticas' });
  }
});

// Rotas públicas para bot compartilhado
app.get('/api/shared-bot/:botId', async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.botId);
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
        messagesPerMinute: bot.settings.messagesPerMinute,
        responseVariation: bot.settings.responseVariation
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
    console.log(`Atualizando bot compartilhado com id: ${req.params.botId}`);
    const bot = await Bot.findByPk(req.params.botId);
    if (!bot) {
      console.log(`Bot compartilhado com id ${req.params.botId} não encontrado para atualização`);
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
          humanControlTimeout: req.body.settings.humanControlTimeout || bot.settings.humanControlTimeout
        })
      }
    };

    console.log('Dados para atualização compartilhada:', JSON.stringify(updatedData));
    await bot.update(updatedData);
    console.log(`Bot compartilhado atualizado com sucesso: ${bot.name}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao atualizar bot compartilhado:', error);
    res.status(500).json({ error: 'Erro ao atualizar configurações do bot' });
  }
});

app.post('/api/shared-bot/:botId/start', async (req, res) => {
  try {
    console.log(`Iniciando bot compartilhado com id: ${req.params.botId}`);
    const bot = await Bot.findByPk(req.params.botId);
    if (!bot) {
      console.log(`Bot compartilhado com id ${req.params.botId} não encontrado para iniciar`);
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
      console.log(`Bot compartilhado ${bot.name} já está ativo`);
      return res.json({ success: true, message: 'Bot já está ativo' });
    }

    try {
      console.log(`Iniciando chatbot compartilhado ${bot.name}`);
      await initChatbot(bot, io);
      console.log(`Chatbot compartilhado ${bot.name} iniciado com sucesso, atualizando status no banco`);
      await bot.update({
        isActive: true,
        lastStartedAt: moment().format()
      });
      console.log(`Bot compartilhado ${bot.name} marcado como ativo no banco de dados`);
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

// Rota para compartilhar bot (pública)
app.get('/share-bot/:botId', async (req, res) => {
  try {
    const bot = await Bot.findByPk(req.params.botId);
    if (!bot) {
      return res.status(404).send('Bot não encontrado');
    }
    res.sendFile(path.join(__dirname, 'public', 'share-bot.html'));
  } catch (error) {
    console.error('Erro ao compartilhar bot:', error);
    res.status(500).send('Erro ao exibir bot compartilhado');
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
    console.log('Buscando todos os bots');
    const bots = await Bot.findAll();
    console.log(`Encontrados ${bots.length} bots`);
    res.json(bots);
  } catch (error) {
    console.error('Erro ao ler bots:', error);
    res.status(500).json({ error: 'Erro ao carregar bots' });
  }
});

app.get('/api/bots/:id', authenticate, async (req, res) => {
  try {
    console.log(`Buscando bot com id: ${req.params.id}`);
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) {
      console.log(`Bot com id ${req.params.id} não encontrado`);
      return res.status(404).json({ error: 'Bot não encontrado' });
    }
    console.log(`Bot encontrado: ${bot.name}`);
    res.json(bot);
  } catch (error) {
    console.error('Erro ao buscar bot:', error);
    res.status(500).json({ error: 'Erro ao buscar bot' });
  }
});

app.post('/api/bots', authenticate, async (req, res) => {
  try {
    console.log('Iniciando criação de bot com dados:', JSON.stringify(req.body));
    const botId = require('uuid').v4();
    console.log(`ID gerado para o novo bot: ${botId}`);
    
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
        humanControlTimeout: req.body.settings?.humanControlTimeout || 30
      },
      startDate: req.body.startDate || moment().format(),
      endDate: req.body.endDate || moment().add(30, 'days').format()
    };
    
    console.log('Tentando criar bot com dados:', JSON.stringify(botData));
    const newBot = await Bot.create(botData);
    console.log(`Bot criado com sucesso. ID: ${newBot.id}, Nome: ${newBot.name}`);
    
    res.json({ success: true, bot: newBot });
  } catch (error) {
    console.error('Erro detalhado ao criar bot:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ error: `Erro ao criar bot: ${error.message}` });
  }
});

app.put('/api/bots/:id', authenticate, async (req, res) => {
  try {
    console.log(`Atualizando bot com id: ${req.params.id}`);
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) {
      console.log(`Bot com id ${req.params.id} não encontrado para atualização`);
      return res.status(404).json({ error: 'Bot não encontrado' });
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
        humanControlTimeout: req.body.settings?.humanControlTimeout || bot.settings.humanControlTimeout
      }
    };

    console.log('Dados para atualização:', JSON.stringify(updatedData));
    await bot.update(updatedData);
    console.log(`Bot atualizado com sucesso: ${bot.name}`);
    res.json({ success: true, bot });
  } catch (error) {
    console.error('Erro ao atualizar bot:', error);
    res.status(500).json({ error: 'Erro ao atualizar bot' });
  }
});

app.post('/api/start/:botId', authenticate, checkBotDates, async (req, res) => {
  try {
    console.log(`Iniciando bot com id: ${req.params.botId}`);
    const bot = await Bot.findByPk(req.params.botId);
    if (!bot) {
      console.log(`Bot com id ${req.params.botId} não encontrado para iniciar`);
      return res.status(404).json({ error: 'Bot não encontrado' });
    }

    if (bot.isActive) {
      console.log(`Bot ${bot.name} já está ativo`);
      return res.json({ success: true, message: 'Bot já está ativo' });
    }

    try {
      console.log(`Iniciando chatbot ${bot.name}`);
      await initChatbot(bot, io);
      console.log(`Chatbot ${bot.name} iniciado com sucesso, atualizando status no banco`);
      await bot.update({
        isActive: true,
        lastStartedAt: moment().format()
      });
      console.log(`Bot ${bot.name} marcado como ativo no banco de dados`);
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
    console.log(`Parando bot com id: ${req.params.botId}`);
    const bot = await Bot.findByPk(req.params.botId);
    if (!bot) {
      console.log(`Bot com id ${req.params.botId} não encontrado para parar`);
      return res.status(404).json({ error: 'Bot não encontrado' });
    }

    if (bot.isActive) {
      console.log(`Desligando bot ${bot.name}`);
      await shutdownBot(bot.id);
      console.log(`Bot ${bot.name} desligado com sucesso`);
    }

    console.log(`Atualizando status do bot ${bot.name} no banco de dados`);
    await bot.update({
      isActive: false,
      lastStoppedAt: moment().format()
    });
    console.log(`Bot ${bot.name} marcado como inativo no banco de dados`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao parar bot:', error);
    res.status(500).json({ error: 'Erro ao parar bot' });
  }
});

app.post('/api/bots/:id/share', authenticate, async (req, res) => {
  try {
    console.log(`Compartilhando bot com id: ${req.params.id}`);
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) {
      console.log(`Bot com id ${req.params.id} não encontrado para compartilhar`);
      return res.status(404).json({ error: 'Bot não encontrado' });
    }

    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'E-mail é obrigatório' });
    }

    const sharedWith = Array.isArray(bot.sharedWith) ? bot.sharedWith : [];
    if (!sharedWith.includes(email)) {
      sharedWith.push(email);
      console.log(`Adicionando ${email} à lista de compartilhamento do bot ${bot.name}`);
      await bot.update({ sharedWith });
      console.log(`Bot ${bot.name} compartilhado com ${email}`);
    } else {
      console.log(`Bot ${bot.name} já está compartilhado com ${email}`);
    }

    const shareLink = `${req.protocol}://${req.get('host')}/share-bot/${bot.id}`;
    console.log(`Link de compartilhamento gerado: ${shareLink}`);
    res.json({ success: true, shareLink });
  } catch (error) {
    console.error('Erro ao compartilhar bot:', error);
    res.status(500).json({ error: 'Erro ao compartilhar bot' });
  }
});

app.delete('/api/bots/:id', authenticate, async (req, res) => {
  try {
    console.log(`Deletando bot com id: ${req.params.id}`);
    const bot = await Bot.findByPk(req.params.id);
    if (!bot) {
      console.log(`Bot com id ${req.params.id} não encontrado para deletar`);
      return res.status(404).json({ error: 'Bot não encontrado' });
    }

    if (bot.isActive) {
      console.log(`Desligando bot ${bot.name} antes de deletar`);
      await shutdownBot(bot.id);
      console.log(`Bot ${bot.name} desligado com sucesso`);
    }

    console.log(`Removendo bot ${bot.name} do banco de dados`);
    await bot.destroy();
    console.log(`Bot ${bot.name} removido do banco de dados`);
    
    // Remover sessão
    try {
      console.log(`Tentando remover diretório de sessão para o bot ${req.params.id}`);
      await require('fs').promises.rm(path.join(SESSIONS_DIR, req.params.id), { recursive: true });
      console.log(`Diretório de sessão removido com sucesso`);
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

process.on('unhandledRejection', (err) => {
  console.error('Erro não tratado:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Exceção não capturada:', err);
});



