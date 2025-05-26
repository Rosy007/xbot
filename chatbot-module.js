const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const path = require('path');
const moment = require('moment');
require('moment/locale/pt-br');
const { exec } = require('child_process');
const fs = require('fs').promises;
const { Bot } = require('./database');
const { createClient } = require('redis');

// Configuração do Redis para cache de respostas de IA
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// Conectar ao Redis
(async () => {
  try {
    await redisClient.connect();
    console.log('Conectado ao Redis para cache de respostas de IA');
  } catch (err) {
    console.error('Erro ao conectar ao Redis:', err);
  }
})();

redisClient.on('error', (err) => {
  console.error('Erro no cliente Redis:', err);
});

// Configuração do executável do Chrome
executablePath: '/usr/bin/google-chrome-stable';

// Mapeamento de clientes ativos e timers de controle humano
const activeClients = new Map();
const voiceActivityTimers = new Map();

// Resposta padrão quando ocorre um erro
const defaultResponse = `🤖 Não estou conseguindo processar sua mensagem no momento. 
Por favor, tente novamente mais tarde ou entre em contato com o suporte.`;

module.exports = {
  initChatbot: async (config, io) => {
    // Verificar datas de validade do bot
    const now = new Date();
    if (now < new Date(config.startDate)) {
      throw new Error('Este bot ainda não está ativo');
    }
    
    if (now > new Date(config.endDate)) {
      throw new Error('Este bot expirou');
    }

    // Verificar se o bot já está ativo
    if (activeClients.has(config.id)) {
      console.log(`[${config.id}] Bot já está ativo`);
      return activeClients.get(config.id);
    }

    console.log(`[${config.id}] Iniciando bot: ${config.name}`);
    
    // Configurar APIs de IA com fallback
    let aiClient;
    try {
      if (config.apiKeys.gemini) {
        aiClient = { 
          type: 'gemini',
          instance: new GoogleGenerativeAI(config.apiKeys.gemini)
        };
      } else if (config.apiKeys.openai) {
        aiClient = {
          type: 'openai',
          instance: new OpenAI({ apiKey: config.apiKeys.openai })
        };
      } else {
        console.warn(`[${config.id}] Nenhuma chave de API válida configurada`);
      }
    } catch (err) {
      console.error(`[${config.id}] Erro ao configurar cliente de IA:`, err);
    }

    // Configurar cliente WhatsApp com tratamento robusto de erros
    const client = new Client({
      authStrategy: new LocalAuth({
        dataPath: path.join(__dirname, 'wpp-sessions'),
        clientId: config.sessionId,
        restartOnAuthFail: true
      }),
      puppeteer: {
        headless: "new",
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--single-process'
        ],
        timeout: 60000
      },
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
      }
    });

    // Evento: QR Code gerado
    client.on('qr', async (qr) => {
      console.log(`[${config.id}] QR Code gerado`);
      try {
        const qrImage = await qrcode.toDataURL(qr);
        io.emit('qr-update', {
          botId: config.id,
          botName: config.name,
          qrImage,
          message: 'Escaneie o QR Code no WhatsApp',
          timestamp: moment().format('HH:mm:ss')
        });
      } catch (err) {
        console.error(`[${config.id}] Erro ao gerar QR Code:`, err);
        io.emit('status-update', {
          botId: config.id,
          status: 'error',
          message: 'Erro ao gerar QR Code',
          timestamp: moment().format()
        });
      }
    });

    // Evento: Cliente pronto
    client.on('ready', () => {
      console.log(`[${config.id}] Bot pronto e conectado`);
      activeClients.set(config.id, client);
      
      // Atualizar status no banco de dados
      Bot.update({ 
        isActive: true,
        lastStartedAt: moment().format() 
      }, { where: { id: config.id } });
      
      io.emit('status-update', {
        botId: config.id,
        status: 'connected',
        message: `✅ Conectado às ${moment().format('HH:mm:ss')}`,
        timestamp: moment().format()
      });
    });

    // Evento: Desconexão
    client.on('disconnected', (reason) => {
      console.log(`[${config.id}] Desconectado:`, reason);
      activeClients.delete(config.id);
      
      // Atualizar status no banco de dados
      Bot.update({ 
        isActive: false,
        lastStoppedAt: moment().format() 
      }, { where: { id: config.id } });
      
      io.emit('status-update', {
        botId: config.id,
        status: 'disconnected',
        message: `❌ Desconectado: ${reason}`,
        timestamp: moment().format()
      });
    });

    // Evento: Mudança de estado
    client.on('change_state', (state) => {
      console.log(`[${config.id}] Mudança de estado:`, state);
      io.emit('status-update', {
        botId: config.id,
        status: state,
        message: `Estado alterado para ${state}`,
        timestamp: moment().format()
      });
    });

    // Evento: Mensagem recebida (principal lógica do chatbot)
    client.on('message', async msg => {
      try {
        if (msg.fromMe) return;
        
        const chat = await msg.getChat();
        const botId = config.id;
        
        // Verificar se é grupo e se deve ignorar
        if (chat.isGroup && config.settings.preventGroupResponses) {
          console.log(`[${botId}] Mensagem de grupo ignorada`);
          return;
        }

        console.log(`[${botId}] Mensagem de ${msg.from}: ${msg.body || '(mídia)'}`);
        
        // Registrar mensagem recebida no painel
        io.emit('message-log', {
          botId,
          type: 'incoming',
          message: msg.body || (msg.hasMedia ? `[${msg.type}]` : '(sem conteúdo)'),
          timestamp: moment().format('HH:mm:ss')
        });

        // Verificar se é um comando para humano assumir o controle
        if (msg.body && msg.body.toLowerCase() === '#humano') {
          handleHumanControl(botId, config.settings.humanControlTimeout || 30);
          console.log(`[${botId}] Controle assumido por humano`);
          return;
        }

        // Se humano está no controle, não responder
        if (voiceActivityTimers.get(botId)?.humanInControl) {
          console.log(`[${botId}] Mensagem ignorada - humano no controle`);
          return;
        }

        // Mostrar indicador de digitação
        await showTypingIndicator(chat, config, io, botId);

        // Processar mensagem e gerar resposta
        const response = await processMessage(msg, config, aiClient);
        
        // Adicionar delay simulado para resposta mais natural
        await new Promise(resolve => 
          setTimeout(resolve, config.settings.responseDelay * 1000));
        
        // Enviar resposta
        await chat.sendMessage(response, {
          quoted: msg,
          sendSeen: true
        });
        
        // Registrar resposta no painel
        io.emit('message-log', {
          botId,
          type: 'outgoing',
          message: response,
          timestamp: moment().format('HH:mm:ss')
        });

      } catch (err) {
        console.error(`[${config.id}] Erro ao processar mensagem:`, err);
        
        // Enviar mensagem de erro padrão
        try {
          const chat = await msg.getChat();
          await chat.sendMessage(defaultResponse, { quoted: msg });
        } catch (sendError) {
          console.error(`[${config.id}] Erro ao enviar mensagem de erro:`, sendError);
        }
      }
    });

    // Inicializar cliente WhatsApp
    try {
      await client.initialize();
      return client;
    } catch (error) {
      console.error(`[${config.id}] Erro ao inicializar cliente WhatsApp:`, error);
      throw error;
    }
  },

  shutdownBot: async (botId) => {
    if (activeClients.has(botId)) {
      try {
        console.log(`[${botId}] Desligando bot...`);
        const client = activeClients.get(botId);
        
        // Destruir cliente WhatsApp
        await client.destroy();
        activeClients.delete(botId);
        
        // Limpar timer de controle humano se existir
        if (voiceActivityTimers.has(botId)) {
          clearTimeout(voiceActivityTimers.get(botId).timer);
          voiceActivityTimers.delete(botId);
        }
        
        // Atualizar status no banco de dados
        await Bot.update({ 
          isActive: false,
          lastStoppedAt: moment().format() 
        }, { where: { id: botId } });
        
        console.log(`[${botId}] Bot desligado com sucesso`);
        return true;
      } catch (error) {
        console.error(`[${botId}] Erro ao desligar bot:`, error);
        return false;
      }
    }
    return false;
  }
};

// Funções auxiliares

/**
 * Manipula o controle humano do bot
 */
function handleHumanControl(botId, timeoutMinutes) {
  // Limpar timer existente se houver
  if (voiceActivityTimers.has(botId)) {
    clearTimeout(voiceActivityTimers.get(botId).timer);
  }
  
  // Configurar novo timer
  voiceActivityTimers.set(botId, {
    humanInControl: true,
    timer: setTimeout(() => {
      voiceActivityTimers.delete(botId);
      console.log(`[${botId}] IA reativada após inatividade humana`);
    }, timeoutMinutes * 60 * 1000)
  });
}

/**
 * Mostra indicador de digitação no chat
 */
async function showTypingIndicator(chat, config, io, botId) {
  // Mostrar indicador de digitação no painel
  io.emit('message-log', {
    botId,
    type: 'typing',
    timestamp: moment().format('HH:mm:ss')
  });

  // Mostrar indicador de digitação no WhatsApp (se configurado)
  if (config.settings.typingIndicator) {
    await chat.sendStateTyping();
    await new Promise(resolve => 
      setTimeout(resolve, config.settings.typingDuration * 1000));
  }
}

/**
 * Processa a mensagem e gera uma resposta
 */
async function processMessage(msg, config, aiClient) {
  if (msg.hasMedia) {
    return await processMedia(msg, config, aiClient) || defaultResponse;
  } else {
    return await generateAIResponse(msg.body, config, aiClient);
  }
}

/**
 * Gera resposta de IA com cache Redis
 */
async function generateAIResponse(prompt, config, aiClient, mediaType = 'text') {
  if (!prompt || prompt.trim().length === 0) {
    return "Não entendi sua mensagem. Poderia reformular?";
  }

  try {
    // Criar chave de cache baseada no prompt e configurações
    const cacheKey = `ai_response:${config.id}:${mediaType}:${hashString(prompt)}`;
    
    // Tentar obter do cache
    const cachedResponse = await redisClient.get(cacheKey);
    if (cachedResponse) {
      console.log(`[${config.id}] Resposta de IA recuperada do cache`);
      return cachedResponse;
    }
    
    const BOT_IDENTITY = config.botIdentity;
    const currentDate = moment().format('DD/MM/YYYY HH:mm');
    
    // Construir prompt completo com instruções
    let fullPrompt = `
      ${BOT_IDENTITY}
      
      Contexto:
      - Data atual: ${currentDate}
      - Limite de resposta: ${config.settings.maxResponseLength} caracteres
      ${mediaType === 'text' ? `- Mensagem recebida: "${prompt}"` : `- ${mediaType === 'image' ? 'Imagem recebida' : 'Mensagem de voz recebida'}`}
      
      Instruções:
      1. Responda de forma natural como um humano
      2. Seja conciso (1-2 frases no máximo)
      3. Use 1-2 emojis relevantes
      4. Nunca revele que é um bot
      5. Mantenha o tom profissional mas amigável
    `;

    if (mediaType !== 'text') {
      fullPrompt += `\n6. Você está respondendo a ${mediaType === 'image' ? 'uma imagem' : 'uma mensagem de voz'}. Seja criativo na resposta.`;
    }

    let response;
    
    // Gerar resposta com o provedor de IA configurado
    if (aiClient?.type === 'gemini') {
      const model = aiClient.instance.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent(fullPrompt);
      response = result.response.text();
    } else if (aiClient?.type === 'openai') {
      const completion = await aiClient.instance.chat.completions.create({
        messages: [
          { role: "system", content: BOT_IDENTITY },
          { role: "user", content: mediaType === 'text' ? prompt : `Responda a ${mediaType === 'image' ? 'uma imagem' : 'uma mensagem de voz'}` }
        ],
        model: "gpt-3.5-turbo",
        max_tokens: config.settings.maxResponseLength
      });
      response = completion.choices[0].message.content;
    } else {
      response = defaultResponse;
    }
    
    // Armazenar no cache se a resposta for válida
    if (response && response !== defaultResponse) {
      await redisClient.setEx(cacheKey, 3600, response); // Cache por 1 hora
    }
    
    return response;
  } catch (error) {
    console.error('Erro na geração de resposta de IA:', error);
    return defaultResponse;
  }
}

/**
 * Processa mensagens de mídia (imagens, áudio, etc.)
 */
async function processMedia(msg, config, aiClient) {
  try {
    if (!msg.hasMedia) return null;
    
    const media = await msg.downloadMedia();
    
    if (msg.type === 'image') {
      const imagePrompt = "Descreva esta imagem e responda de forma natural";
      return generateAIResponse(imagePrompt, config, aiClient, 'image');
    } 
    
    if (msg.type === 'ptt' || msg.type === 'audio') {
      return await processAudioMessage(media, config, aiClient);
    }
    
    return "Recebi sua mídia, mas ainda não consigo processar este tipo de arquivo.";
  } catch (error) {
    console.error('Erro ao processar mídia:', error);
    return "Não consegui processar a mídia enviada. Poderia descrevê-la por texto?";
  }
}

/**
 * Processa mensagens de áudio (converte para texto)
 */
async function processAudioMessage(media, config, aiClient) {
  try {
    const audioPath = path.join(__dirname, 'temp_audio.ogg');
    await fs.writeFile(audioPath, media.data, 'base64');
    
    // Usar whisper para transcrever áudio
    const transcription = await new Promise((resolve, reject) => {
      exec(`whisper ${audioPath} --language pt --model tiny`, (error, stdout, stderr) => {
        if (error) {
          console.error('Erro na transcrição de áudio:', error);
          reject('Não consegui entender o áudio');
        }
        resolve(stdout);
      });
    });
    
    await fs.unlink(audioPath);
    return generateAIResponse(transcription, config, aiClient, 'voice');
  } catch (error) {
    console.error('Erro ao processar áudio:', error);
    return "Não consegui entender a mensagem de voz. Poderia repetir ou digitar?";
  }
}

/**
 * Função simples para hash de strings (para chaves de cache)
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString();
}

// Fechar conexão Redis ao encerrar
process.on('SIGINT', async () => {
  await redisClient.quit();
  process.exit();
});
