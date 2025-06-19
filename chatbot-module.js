// chatbot-module.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const path = require('path');
const moment = require('moment');
require('moment/locale/pt-br');
const { exec } = require('child_process');
const fs = require('fs').promises;
const { Bot, ScheduledMessage } = require('./database');
const redisService = require('./redis-service');

executablePath: '/usr/bin/google-chrome-stable';
const activeClients = new Map();
const voiceActivityTimers = new Map();
const messageCounts = new Map();
const repeatedWordsTracker = new Map();
const scheduledMessagesCheckInterval = 30000; // 30 segundos

const defaultResponse = `🤖 Não estou conseguindo processar sua mensagem no momento. 
Por favor, tente novamente mais tarde ou entre em contato com o suporte.`;

const GREETINGS = [
  "Olá! Como posso ajudar? 😊",
  "Oi! Tudo bem por aí?",
  "E aí! O que precisas hoje?",
  "Saudações! Em que posso ser útil?",
  "Oi! Estou por aqui se precisar"
];

const synonyms = {
  "oi": ["olá", "e aí", "saudações"],
  "tudo bem": ["como vai", "tudo certo", "tudo tranquilo"],
  "obrigado": ["agradeço", "grato", "valeu"],
  "ajuda": ["suporte", "assistência", "auxílio"]
};

const suspiciousPatterns = [
  /(?:https?|ftp):\/\/[^\s/$.?#].[^\s]*/gi, // URLs
  /[\u{1F600}-\u{1F64F}]/gu,                // Emojis em excesso
  /(.)\1{5,}/gi                             // Caracteres repetidos
];

// Iniciar verificação de mensagens agendadas
setInterval(async () => {
  try {
    const dueMessages = await redisService.getDueMessages();
    for (const msg of dueMessages) {
      const client = activeClients.get(msg.botId);
      if (client) {
        try {
          await client.sendMessage(msg.recipient, msg.message);
          
          // Atualizar no banco de dados
          await ScheduledMessage.update(
            { status: 'sent', sentAt: new Date() },
            { where: { id: msg.messageId } }
          );
          
          // Remover do Redis
          await redisService.removeScheduledMessage(msg.botId, msg.messageId);
          
          console.log(`[${msg.botId}] Mensagem agendada enviada para ${msg.recipient}`);
        } catch (err) {
          console.error(`[${msg.botId}] Erro ao enviar mensagem agendada:`, err);
          await ScheduledMessage.update(
            { status: 'failed' },
            { where: { id: msg.messageId } }
          );
        }
      }
    }
  } catch (err) {
    console.error('Erro ao verificar mensagens agendadas:', err);
  }
}, scheduledMessagesCheckInterval);

module.exports = {
  initChatbot: async (config, io) => {
    // Verificar datas
    const now = new Date();
    if (now < new Date(config.startDate)) {
      throw new Error('Este bot ainda não está ativo');
    }
    
    if (now > new Date(config.endDate)) {
      throw new Error('Este bot expirou');
    }

    if (activeClients.has(config.id)) {
      console.log(`[${config.id}] Bot já está ativo`);
      return activeClients.get(config.id);
    }

    console.log(`[${config.id}] Iniciando bot: ${config.name}`);
    
    // Verificar se há sessão em cache
    const cachedSession = await redisService.getSession(config.id);
    
    // Configurar cliente WhatsApp
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
      },
      session: cachedSession
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
        console.error(`[${config.id}] Erro ao gerar QR:`, err);
      }
    });

    // Evento: Sessão salva
    client.on('authenticated', async (session) => {
      console.log(`[${config.id}] Sessão autenticada`);
      await redisService.cacheSession(config.id, session);
    });

    // Evento: Cliente pronto
    client.on('ready', () => {
      console.log(`[${config.id}] Bot pronto`);
      activeClients.set(config.id, client);
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
      redisService.deleteSession(config.id);
      io.emit('status-update', {
        botId: config.id,
        status: 'disconnected',
        message: `❌ Desconectado: ${reason}`,
        timestamp: moment().format()
      });
    });

    // Evento: Mensagem recebida
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

        // Verificar limite de mensagens por hora
        const now = Date.now();
        const hourAgo = now - 3600000;

        if (!messageCounts.has(msg.from)) {
          messageCounts.set(msg.from, []);
        }

        const recentMessages = messageCounts.get(msg.from).filter(t => t > hourAgo);
        recentMessages.push(now);
        messageCounts.set(msg.from, recentMessages);

        if (recentMessages.length > config.settings.maxMessagesPerHour) {
          console.log(`[${botId}] Limite de mensagens atingido para ${msg.from}`);
          return;
        }

        console.log(`[${botId}] Mensagem de ${msg.from}: ${msg.body || '(mídia)'}`);
        
        // Registrar mensagem recebida
        io.emit('message-log', {
          botId,
          type: 'incoming',
          message: msg.body || (msg.hasMedia ? `[${msg.type}]` : '(sem conteúdo)'),
          timestamp: moment().format('HH:mm:ss')
        });

        // Verificar se é um humano assumindo o controle
        if (msg.body && msg.body.toLowerCase() === '#humano') {
          // Limpar timer existente se houver
          if (voiceActivityTimers.has(botId)) {
            clearTimeout(voiceActivityTimers.get(botId).timer);
          }
          
          voiceActivityTimers.set(botId, {
            humanInControl: true,
            timer: setTimeout(() => {
              voiceActivityTimers.delete(botId);
              console.log(`[${botId}] IA reativada após inatividade humana`);
            }, (config.settings.humanControlTimeout || 30) * 60 * 1000) // padrão 30 minutos
          });
          console.log(`[${botId}] Controle assumido por humano`);
          return;
        }

        // Se humano está no controle, não responder
        if (voiceActivityTimers.get(botId)?.humanInControl) {
          console.log(`[${botId}] Mensagem ignorada - humano no controle`);
          return;
        }

        // Verificar se é um comando de agendamento
        if (config.settings.allowScheduling && msg.body && msg.body.startsWith('#agendar')) {
          const parts = msg.body.split('|');
          if (parts.length === 3) {
            const [_, datetime, message] = parts;
            const scheduledTime = new Date(datetime.trim());
            
            if (scheduledTime > new Date()) {
              const scheduledMsg = await ScheduledMessage.create({
                botId: config.id,
                recipient: msg.from,
                message: message.trim(),
                scheduledTime,
                status: 'pending'
              });
              
              await redisService.scheduleMessage(
                config.id,
                scheduledMsg.id,
                msg.from,
                message.trim(),
                scheduledTime
              );
              
              await chat.sendMessage(
                `✅ Mensagem agendada para ${scheduledTime.toLocaleString('pt-BR')}`,
                { quoted: msg }
              );
              
              io.emit('message-log', {
                botId,
                type: 'outgoing',
                message: `Agendamento confirmado para ${scheduledTime.toLocaleString('pt-BR')}`,
                timestamp: moment().format('HH:mm:ss')
              });
              
              return;
            }
          }
        }

        // Mostrar indicador de digitação no painel
        io.emit('message-log', {
          botId,
          type: 'typing',
          timestamp: moment().format('HH:mm:ss')
        });

        // Mostrar indicador de digitação no WhatsApp (se configurado)
        if (config.settings.typingIndicator) {
          await chat.sendStateTyping();
          const typingDuration = config.settings.typingDuration * 
            (1 + (Math.random() * config.settings.typingVariance * 2 - config.settings.typingVariance));
          await new Promise(resolve => 
            setTimeout(resolve, typingDuration * 1000));
        }

        // Processar mídia se existir
        let response;
        if (msg.hasMedia) {
          response = await processMedia(msg, config) || defaultResponse;
        } else {
          // Verificar se é primeira mensagem para usar saudação aleatória
          if (isFirstMessage(msg)) {
            response = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
          } else {
            // Gerar resposta para texto
            response = await generateAIResponse(msg.body, config);
          }
        }
        
        // Adicionar erros humanos
        if (Math.random() < config.settings.humanLikeMistakes) {
          response = addHumanLikeMistakes(response);
        }

        // Verificar padrões suspeitos
        suspiciousPatterns.forEach(pattern => {
          if (pattern.test(response)) {
            response = "Desculpe, não entendi. Poderia reformular?";
          }
        });

        // Adicionar delay randômico
        const delay = randomBetween(
          config.settings.minResponseDelay,
          config.settings.maxResponseDelay
        );
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
        
        // Enviar resposta
        await chat.sendMessage(response, {
          quoted: msg,
          sendSeen: true
        });
        
        // Registrar resposta
        io.emit('message-log', {
          botId,
          type: 'outgoing',
          message: response,
          timestamp: moment().format('HH:mm:ss')
        });
      } catch (err) {
        console.error(`[${config.id}] Erro ao processar mensagem:`, err);
      }
    });

    // Inicializar cliente
    try {
      await client.initialize();
      return client;
    } catch (error) {
      console.error(`[${config.id}] Erro ao inicializar:`, error);
      throw error;
    }
  },

  shutdownBot: async (botId) => {
    if (activeClients.has(botId)) {
      try {
        await activeClients.get(botId).destroy();
        activeClients.delete(botId);
        
        // Limpar timer se existir
        if (voiceActivityTimers.has(botId)) {
          clearTimeout(voiceActivityTimers.get(botId).timer);
          voiceActivityTimers.delete(botId);
        }
        
        return true;
      } catch (error) {
        console.error(`[${botId}] Erro ao desligar bot:`, error);
        return false;
      }
    }
    return false;
  }
};

// Gerador de respostas com IA
async function generateAIResponse(prompt, config) {
  try {
    // Verificar se há treinamento em cache
    let cachedTraining = await redisService.getBotTraining(config.id);
    if (!cachedTraining) {
      cachedTraining = {
        botIdentity: config.botIdentity,
        conversationHistory: []
      };
      await redisService.cacheBotTraining(config.id, cachedTraining);
    }

    const BOT_IDENTITY = cachedTraining.botIdentity;
    const currentDate = moment().format('DD/MM/YYYY HH:mm');
    
    let fullPrompt = `
      ${BOT_IDENTITY}
      
      Histórico da conversa:
      ${cachedTraining.conversationHistory.slice(-3).map(m => `${m.role === 'user' ? 'Usuário' : 'Bot'}: ${m.content}`).join('\n')}
      
      Informações:
      - Data atual: ${currentDate}
      - Limite de caracteres: ${config.settings.maxResponseLength}
      - Mensagem recebida: "${prompt}"
      
      Instruções:
      1. Responda de forma natural como um humano
      2. Seja conciso (1-2 frases no máximo)
      3. Use 1-2 emojis relevantes
      4. Nunca revele que é um bot
      5. Mantenha o tom profissional mas amigável
      6. Varie seu vocabulário e evite repetir palavras idênticas de respostas anteriores
      7. Sempre inicie novas conversas com saudações variadas
      8. Nunca envie mais de 3 mensagens consecutivas sem resposta do usuário
      9. Insira pausas naturais entre respostas longas
    `;

    let aiResponse;
    if (config.apiKeys.gemini) {
      const genAI = new GoogleGenerativeAI(config.apiKeys.gemini);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent(fullPrompt);
      aiResponse = result.response.text();
    } else if (config.apiKeys.openai) {
      const openai = new OpenAI({ apiKey: config.apiKeys.openai });
      const completion = await openai.chat.completions.create({
        messages: [
          { role: "system", content: BOT_IDENTITY },
          ...cachedTraining.conversationHistory.slice(-5),
          { role: "user", content: prompt }
        ],
        model: "gpt-3.5-turbo",
        max_tokens: config.settings.maxResponseLength
      });
      aiResponse = completion.choices[0].message.content;
    } else {
      aiResponse = defaultResponse;
    }

    // Atualizar histórico da conversa
    cachedTraining.conversationHistory.push(
      { role: "user", content: prompt },
      { role: "assistant", content: aiResponse }
    );
    
    // Manter apenas as últimas 10 mensagens no histórico
    if (cachedTraining.conversationHistory.length > 10) {
      cachedTraining.conversationHistory = cachedTraining.conversationHistory.slice(-10);
    }
    
    await redisService.cacheBotTraining(config.id, cachedTraining);

    // Pós-processamento para reduzir repetições
    let finalResponse = aiResponse;
    if (repeatedWordsTracker.has(msg.from)) {
      const bannedWords = repeatedWordsTracker.get(msg.from);
      bannedWords.forEach(word => {
        finalResponse = finalResponse.replace(new RegExp(word, 'gi'), synonyms[word] || '');
      });
    }

    // Atualizar palavras repetidas
    const words = finalResponse.split(/\s+/);
    const wordCount = {};
    words.forEach(word => {
      wordCount[word] = (wordCount[word] || 0) + 1;
    });
    
    const repeatedWords = Object.keys(wordCount).filter(word => wordCount[word] > 2);
    repeatedWordsTracker.set(msg.from, repeatedWords);

    return finalResponse;
  } catch (error) {
    console.error('Erro na geração de resposta:', error);
    return defaultResponse;
  }
}

// Processar mídia (imagens e voz)
async function processMedia(msg, config) {
  try {
    if (msg.hasMedia) {
      const media = await msg.downloadMedia();
      
      if (msg.type === 'image') {
        // Processar imagem
        const imagePrompt = "Descreva esta imagem e responda de forma natural";
        return generateAIResponse(imagePrompt, config);
      } else if (msg.type === 'ptt' || msg.type === 'audio') {
        // Processar áudio - converter para texto primeiro
        try {
          const audioPath = path.join(__dirname, 'temp_audio.ogg');
          await fs.writeFile(audioPath, media.data, 'base64');
          
          // Usar whisper ou outro serviço para transcrever
          const transcription = await new Promise((resolve, reject) => {
            exec(`whisper ${audioPath} --language pt --model tiny`, (error, stdout, stderr) => {
              if (error) {
                console.error('Erro na transcrição:', error);
                reject('Não consegui entender o áudio');
              }
              resolve(stdout);
            });
          });
          
          await fs.unlink(audioPath);
          return generateAIResponse(transcription, config);
        } catch (error) {
          console.error('Erro ao processar áudio:', error);
          return "Não consegui entender a mensagem de voz. Poderia repetir ou digitar?";
        }
      }
    }
    return null;
  } catch (error) {
    console.error('Erro ao processar mídia:', error);
    return null;
  }
}

// Funções auxiliares
function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function addHumanLikeMistakes(text) {
  const mistakes = [
    () => text.replace(/(?<!^)\./g, ','),  // Substituir pontos por vírgulas
    () => text + '...',
    () => text.replace(/\b(a|o)\b/g, match => 
      Math.random() > 0.5 ? match : match + 's'),
    () => text.split(' ').map(word => 
      Math.random() > 0.9 ? word.slice(0, -1) : word).join(' ')
  ];
  
  return mistakes[Math.floor(Math.random() * mistakes.length)]();
}

function isFirstMessage(msg) {
  return !repeatedWordsTracker.has(msg.from);
}
