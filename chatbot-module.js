const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const path = require('path');
const moment = require('moment');
require('moment/locale/pt-br');
const { exec } = require('child_process');
const fs = require('fs').promises;
const { Bot, Appointment } = require('./database');
const { v4: uuidv4 } = require('uuid');
const { Sequelize } = require('sequelize');

// Configurações de segurança
const MAX_MESSAGES_PER_MINUTE = 5;
const MIN_RESPONSE_DELAY = 3; 
const MAX_RESPONSE_DELAY = 15;
const TYPING_VARIATION = 0.8;
const HUMAN_ERROR_PROBABILITY = 0.1;
const RESPONSE_VARIATION_PROBABILITY = 0.3;

// Comandos de agendamento
const APPOINTMENT_COMMAND = '#marcacao';
const APPOINTMENT_STATES = {
  START: 0,
  GETTING_NAME: 1,
  GETTING_DESCRIPTION: 2,
  GETTING_DATE: 3,
  CONFIRMATION: 4
};

// Variáveis globais
const activeClients = new Map();
const voiceActivityTimers = new Map();
const messageCounters = new Map();
const appointmentStates = new Map();
const reminderIntervals = new Map();
const responseCache = new Map();

// Respostas padrão variadas
const defaultResponses = [
  "🤖 Não estou conseguindo processar sua mensagem no momento. Por favor, tente novamente mais tarde.",
  "🔍 Estou tendo dificuldades para entender. Poderia reformular?",
  "📵 Ops, algo deu errado! Vou tentar novamente em instantes.",
  "🤔 Hmm, não consegui compreender completamente. Pode repetir?",
  "⏳ Um momento, estou processando sua mensagem...",
  "💡 Estou com problemas técnicos, mas já estou resolvendo!"
];

// Erros humanos simulados
const humanErrors = {
  typing: [
    "Desculpe, digitei errado *{correction}*",
    "Ops, erro de digitação: *{correction}*",
    "Corrigindo: *{correction}* (desculpe o erro)",
    "*{correction}* (errinho de digitação)"
  ],
  understanding: [
    "Acho que entendi errado, você quis dizer {alternative}?",
    "Talvez eu tenha me confundido, é sobre {alternative}?",
    "Pode ser que eu tenha interpretado mal, você está falando de {alternative}?",
    "Só para confirmar: {alternative}?"
  ],
  delay: [
    "Estou consultando algumas informações, um momento...",
    "Preciso verificar isso, já volto!",
    "Deixe-me pensar um pouco sobre sua pergunta...",
    "Vou pesquisar para te responder melhor..."
  ]
};

// Funções auxiliares
function formatAppointmentDate(date) {
  return moment(date).format('DD/MM/YYYY [às] HH:mm');
}

function getRandomResponse() {
  return defaultResponses[Math.floor(Math.random() * defaultResponses.length)];
}

function simulateTypo(text) {
  if (Math.random() < HUMAN_ERROR_PROBABILITY && text.length > 5) {
    const words = text.split(' ');
    if (words.length > 1) {
      const randomIndex = Math.floor(Math.random() * words.length);
      const word = words[randomIndex];
      
      const errorType = Math.floor(Math.random() * 4);
      switch(errorType) {
        case 0:
          const repeatPos = Math.floor(Math.random() * word.length);
          words[randomIndex] = word.slice(0, repeatPos) + word[repeatPos] + word.slice(repeatPos);
          break;
        case 1:
          const removePos = Math.floor(Math.random() * word.length);
          words[randomIndex] = word.slice(0, removePos) + word.slice(removePos + 1);
          break;
        case 2:
          if (word.length > 2) {
            const swapPos = Math.floor(Math.random() * (word.length - 1));
            words[randomIndex] = word.slice(0, swapPos) + word[swapPos + 1] + word[swapPos] + word.slice(swapPos + 2);
          }
          break;
        case 3:
          if (word.length > 3) {
            const changePos = Math.floor(Math.random() * word.length);
            const randomChar = String.fromCharCode(97 + Math.floor(Math.random() * 26));
            words[randomIndex] = word.slice(0, changePos) + randomChar + word.slice(changePos + 1);
          }
          break;
      }
      return words.join(' ');
    }
  }
  return text;
}

function simulateHumanResponse(response) {
  if (Math.random() < HUMAN_ERROR_PROBABILITY) {
    const errorType = Math.floor(Math.random() * 3);
    
    if (errorType === 0) {
      const words = response.split(' ');
      if (words.length > 2) {
        const randomWord = words[Math.floor(Math.random() * words.length)];
        const errorMsg = humanErrors.typing[Math.floor(Math.random() * humanErrors.typing.length)];
        return errorMsg.replace('{correction}', randomWord);
      }
    } else if (errorType === 1) {
      const questions = response.split(/[.!?]/)[0];
      if (questions.length > 10) {
        const errorMsg = humanErrors.understanding[Math.floor(Math.random() * humanErrors.understanding.length)];
        return errorMsg.replace('{alternative}', questions);
      }
    }
  }
  
  if (Math.random() < RESPONSE_VARIATION_PROBABILITY) {
    const variations = [
      response,
      response + " 😊",
      response.replace(/\.$/, '!'),
      response.replace(/\.$/, '...'),
      "Ah, " + response.toLowerCase(),
      "Então, " + response.toLowerCase()
    ];
    return variations[Math.floor(Math.random() * variations.length)];
  }
  
  return response;
}

async function checkAndSendReminders(client, botId) {
  try {
    const now = new Date();
    const oneDayLater = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

    const dayBeforeAppointments = await Appointment.findAll({
      where: {
        botId,
        status: 'confirmed',
        appointmentDate: { [Sequelize.Op.between]: [now, oneDayLater] },
        remindedOneDayBefore: false
      }
    });

    for (const appointment of dayBeforeAppointments) {
      const timeDiff = appointment.appointmentDate.getTime() - now.getTime();
      if (timeDiff <= 24 * 60 * 60 * 1000 && timeDiff > 23 * 60 * 60 * 1000) {
        await client.sendMessage(
          appointment.contact,
          `📅 *Lembrete de Agendamento*:\n\n*${appointment.name}*\n⏰ ${formatAppointmentDate(appointment.appointmentDate)}\n\nFaltam aproximadamente 24 horas.`
        );
        await appointment.update({ remindedOneDayBefore: true });
      }
    }

    const hourBeforeAppointments = await Appointment.findAll({
      where: {
        botId,
        status: 'confirmed',
        appointmentDate: { [Sequelize.Op.between]: [now, oneHourLater] },
        remindedOneHourBefore: false
      }
    });

    for (const appointment of hourBeforeAppointments) {
      const timeDiff = appointment.appointmentDate.getTime() - now.getTime();
      if (timeDiff <= 60 * 60 * 1000 && timeDiff > 59 * 60 * 1000) {
        await client.sendMessage(
          appointment.contact,
          `⏰ *Lembrete de Agendamento*:\n\n*${appointment.name}*\n⏰ ${formatAppointmentDate(appointment.appointmentDate)}\n\nFalta aproximadamente 1 hora.`
        );
        await appointment.update({ remindedOneHourBefore: true });
      }
    }
  } catch (error) {
    console.error(`[${botId}] Erro ao verificar lembretes:`, error);
  }
}

function startReminderChecker(client, botId) {
  const interval = setInterval(() => checkAndSendReminders(client, botId), 30 * 60 * 1000);
  reminderIntervals.set(botId, interval);
}

function stopReminderChecker(botId) {
  if (reminderIntervals.has(botId)) {
    clearInterval(reminderIntervals.get(botId));
    reminderIntervals.delete(botId);
  }
}

async function generateAIResponse(prompt, config, aiClient, mediaType = 'text') {
  try {
    const cacheKey = prompt?.toLowerCase().substring(0, 50) || 'media';
    const cachedResponse = responseCache.get(cacheKey);
    
    if (cachedResponse && (Date.now() - cachedResponse.timestamp < 3600000) && Math.random() > 0.3) {
      console.log(`[${config.id}] Usando resposta em cache para: ${cacheKey}`);
      return simulateHumanResponse(cachedResponse.response);
    }

    const BOT_IDENTITY = config.botIdentity;
    const currentDate = moment().format('DD/MM/YYYY HH:mm');
    
    let fullPrompt = `${BOT_IDENTITY}\n\nInformações:\n- Data atual: ${currentDate}\n- Limite de caracteres: ${config.settings.maxResponseLength}\n`;
    fullPrompt += mediaType === 'text' ? `- Mensagem recebida: "${prompt}"` : `- ${mediaType === 'image' ? 'Imagem recebida' : 'Mensagem de voz recebida'}`;
    
    fullPrompt += `\n\nInstruções:\n1. Responda de forma natural como um humano\n2. Seja conciso (1-2 frases no máximo)\n3. Use 1-2 emojis relevantes\n4. Nunca revele que é um bot\n5. Mantenha o tom profissional mas amigável\n6. Varie o vocabulário e estrutura das frases\n`;
    
    if (mediaType !== 'text') {
      fullPrompt += `\n7. Você está respondendo a ${mediaType === 'image' ? 'uma imagem' : 'uma mensagem de voz'}. Seja criativo na resposta.`;
    }

    if (aiClient?.type === 'gemini') {
      const model = aiClient.instance.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(fullPrompt);
      const response = result.response.text();
      const finalResponse = response.substring(0, config.settings.maxResponseLength);
      responseCache.set(cacheKey, { response: finalResponse, timestamp: Date.now() });
      return simulateHumanResponse(finalResponse);
    } else if (aiClient?.type === 'openai') {
      const completion = await aiClient.instance.chat.completions.create({
        messages: [
          { role: "system", content: BOT_IDENTITY },
          { role: "user", content: mediaType === 'text' ? prompt : `Responda a ${mediaType === 'image' ? 'uma imagem' : 'uma mensagem de voz'}` }
        ],
        model: "gpt-3.5-turbo",
        max_tokens: config.settings.maxResponseLength,
        temperature: 0.7
      });
      const response = completion.choices[0].message.content;
      responseCache.set(cacheKey, { response, timestamp: Date.now() });
      return simulateHumanResponse(response);
    }
    
    return getRandomResponse();
  } catch (error) {
    console.error('Erro na geração de resposta:', error);
    return getRandomResponse();
  }
}

async function processMedia(msg, config, aiClient) {
  try {
    if (msg.hasMedia) {
      const media = await msg.downloadMedia();
      
      if (msg.type === 'image') {
        const imagePrompt = "Descreva esta imagem e responda de forma natural e variada";
        return generateAIResponse(imagePrompt, config, aiClient, 'image');
      } else if (msg.type === 'ptt' || msg.type === 'audio') {
        try {
          const audioPath = path.join(__dirname, 'temp_audio.ogg');
          await fs.writeFile(audioPath, media.data, 'base64');
          
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
          return generateAIResponse(transcription, config, aiClient, 'voice');
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

async function simulateHumanBehavior(chat, config) {
  const baseTypingTime = config.settings.typingDuration || 3;
  const variedTypingTime = baseTypingTime * (1 + (Math.random() * TYPING_VARIATION * 2 - TYPING_VARIATION));
  const typingTime = Math.floor(variedTypingTime * 1000);
  
  if (config.settings.typingIndicator) {
    await chat.sendStateTyping();
    await new Promise(resolve => setTimeout(resolve, typingTime));
  }
  
  if (Math.random() < 0.1) {
    const reactions = ['👍', '❤️', '😂', '😮', '😢', '👏'];
    const reaction = reactions[Math.floor(Math.random() * reactions.length)];
    await chat.sendMessage(reaction, { sendReaction: true });
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  if (Math.random() < 0.05) {
    await chat.sendStateTyping();
    await new Promise(resolve => setTimeout(resolve, 2000));
    await chat.sendStateRecording();
    await new Promise(resolve => setTimeout(resolve, 1000));
    await chat.sendStateTyping();
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

function handleDisconnect(reason, config, io) {
  console.log(`[${config.id}] Desconectado:`, reason);
  activeClients.delete(config.id);
  messageCounters.delete(config.id);
  stopReminderChecker(config.id);
  
  io.emit('status-update', {
    botId: config.id,
    status: 'disconnected',
    message: `❌ Desconectado: ${reason}`,
    timestamp: moment().format()
  });

  if (!reason.includes('ban') && !reason.includes('blocked')) {
    setTimeout(() => {
      console.log(`[${config.id}] Tentando reconectar...`);
      initChatbot(config, io).catch(err => {
        console.log(`[${config.id}] Falha na reconexão:`, err);
      });
    }, 300000);
  }
}

module.exports = {
  initChatbot: async (config, io) => {
    const now = new Date();
    if (now < new Date(config.startDate)) throw new Error('Este bot ainda não está ativo');
    if (now > new Date(config.endDate)) throw new Error('Este bot expirou');
    if (activeClients.has(config.id)) {
      console.log(`[${config.id}] Bot já está ativo`);
      return activeClients.get(config.id);
    }

    console.log(`[${config.id}] Iniciando bot: ${config.name}`);
    
    let aiClient;
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
    }

    messageCounters.set(config.id, { count: 0, lastReset: Date.now() });

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
          '--single-process',
          `--user-agent=Mozilla/5.0 (Linux; Android ${config.deviceInfo?.osVersion || '13.0.0'}; ${config.deviceInfo?.model || 'Pixel 6'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36`
        ],
        timeout: 60000
      },
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        updateInterval: 86400000
      },
      takeoverOnConflict: false,
      takeoverTimeoutMs: 0,
      disableAutoTyping: true,
      markOnlineOnConnect: false,
      syncFullHistory: false
    });

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

    client.on('ready', () => {
      console.log(`[${config.id}] Bot pronto`);
      activeClients.set(config.id, client);
      startReminderChecker(client, config.id);
      
      const statusInterval = setInterval(async () => {
        try {
          const chats = await client.getChats();
          if (chats.length === 0) {
            console.log(`[${config.id}] Possível shadow ban detectado - nenhum chat encontrado`);
            io.emit('status-update', {
              botId: config.id,
              status: 'warning',
              message: 'Possível shadow ban detectado',
              timestamp: moment().format()
            });
          }
        } catch (error) {
          console.log(`[${config.id}] Erro ao verificar status:`, error);
        }
      }, 3600000);

      reminderIntervals.set(config.id, {
        reminder: setInterval(() => checkAndSendReminders(client, config.id), 30 * 60 * 1000),
        status: statusInterval
      });
      
      io.emit('status-update', {
        botId: config.id,
        status: 'connected',
        message: `✅ Conectado às ${moment().format('HH:mm:ss')}`,
        timestamp: moment().format()
      });
    });

    client.on('disconnected', (reason) => handleDisconnect(reason, config, io));
    
    client.on('auth_failure', (msg) => {
      console.log(`[${config.id}] Falha de autenticação:`, msg);
      io.emit('status-update', {
        botId: config.id,
        status: 'error',
        message: 'Falha de autenticação - possivelmente banido',
        timestamp: moment().format()
      });
      activeClients.delete(config.id);
    });

    client.on('change_state', (state) => {
      console.log(`[${config.id}] Mudança de estado:`, state);
      if (state === 'UNPAIRED' || state === 'CONFLICT') {
        io.emit('status-update', {
          botId: config.id,
          status: 'error',
          message: `Sessão inválida (${state}) - requer nova autenticação`,
          timestamp: moment().format()
        });
      }
    });

    client.on('message', async msg => {
      try {
        if (msg.fromMe) return;
        
        const chat = await msg.getChat();
        const botId = config.id;
        const contact = msg.from;
        
        if (chat.isGroup && config.settings.preventGroupResponses) {
          console.log(`[${botId}] Mensagem de grupo ignorada`);
          return;
        }

        console.log(`[${botId}] Mensagem de ${msg.from}: ${msg.body || '(mídia)'}`);
        
        io.emit('message-log', {
          botId,
          type: 'incoming',
          message: msg.body || (msg.hasMedia ? `[${msg.type}]` : '(sem conteúdo)'),
          timestamp: moment().format('HH:mm:ss')
        });

        const counter = messageCounters.get(botId);
        const now = Date.now();
        if (now - counter.lastReset > 60000) {
          counter.count = 0;
          counter.lastReset = now;
        }
        
        if (counter.count >= MAX_MESSAGES_PER_MINUTE) {
          console.log(`[${botId}] Limite de mensagens atingido (${MAX_MESSAGES_PER_MINUTE}/min)`);
          return;
        }
        counter.count++;

        if (msg.body && msg.body.toLowerCase() === '#humano') {
          if (voiceActivityTimers.has(botId)) {
            clearTimeout(voiceActivityTimers.get(botId).timer);
          }
          
          voiceActivityTimers.set(botId, {
            humanInControl: true,
            timer: setTimeout(() => {
              voiceActivityTimers.delete(botId);
              console.log(`[${botId}] IA reativada após inatividade humana`);
            }, (config.settings.humanControlTimeout || 30) * 60 * 1000)
          });
          console.log(`[${botId}] Controle assumido por humano`);
          return;
        }

        if (voiceActivityTimers.get(botId)?.humanInControl) {
          console.log(`[${botId}] Mensagem ignorada - humano no controle`);
          return;
        }

        io.emit('message-log', {
          botId,
          type: 'typing',
          timestamp: moment().format('HH:mm:ss')
        });

        await simulateHumanBehavior(chat, config);

        if (msg.body && msg.body.toLowerCase() === APPOINTMENT_COMMAND) {
          appointmentStates.set(contact, {
            state: APPOINTMENT_STATES.GETTING_NAME,
            data: {}
          });
          await chat.sendMessage(
            '📅 *Sistema de Agendamento*\n\nVou te ajudar a marcar seu compromisso!\n\nPrimeiro, me diga *como devo chamar este compromisso* (ex: Consulta médica, Reunião importante):'
          );
          return;
        }

        if (appointmentStates.has(contact)) {
          const appointmentState = appointmentStates.get(contact);
          
          switch (appointmentState.state) {
            case APPOINTMENT_STATES.GETTING_NAME:
              appointmentState.data.name = msg.body;
              appointmentState.state = APPOINTMENT_STATES.GETTING_DESCRIPTION;
              await chat.sendMessage(
                'Ótimo! Agora me diga *uma breve descrição* deste compromisso (opcional, pode dizer apenas "nenhuma"):'
              );
              break;
              
            case APPOINTMENT_STATES.GETTING_DESCRIPTION:
              appointmentState.data.description = msg.body.toLowerCase() === 'nenhuma' ? 'Sem descrição' : msg.body;
              appointmentState.state = APPOINTMENT_STATES.GETTING_DATE;
              await chat.sendMessage(
                'Certo! Agora me informe *a data e hora* do compromisso no formato:\nDD/MM/AAAA HH:MM\n\nPor exemplo: 25/12/2023 15:30'
              );
              break;
              
            case APPOINTMENT_STATES.GETTING_DATE:
              try {
                const [datePart, timePart] = msg.body.split(' ');
                const [day, month, year] = datePart.split('/').map(Number);
                const [hours, minutes] = timePart.split(':').map(Number);
                
                const appointmentDate = new Date(year, month - 1, day, hours, minutes);
                
                if (isNaN(appointmentDate.getTime())) throw new Error('Data inválida');
                if (appointmentDate < new Date()) throw new Error('Data no passado');
                
                appointmentState.data.appointmentDate = appointmentDate;
                appointmentState.state = APPOINTMENT_STATES.CONFIRMATION;
                
                await chat.sendMessage(
                  '📋 *Confirme os detalhes do agendamento:*\n\n' +
                  `*Nome:* ${appointmentState.data.name}\n` +
                  `*Descrição:* ${appointmentState.data.description}\n` +
                  `*Data/Hora:* ${formatAppointmentDate(appointmentState.data.appointmentDate)}\n\n` +
                  'Se estiver tudo correto, digite *CONFIRMAR*.\nPara cancelar, digite *CANCELAR*.'
                );
              } catch (error) {
                await chat.sendMessage(
                  '❌ *Data inválida!*\n\nPor favor, envie novamente no formato:\nDD/MM/AAAA HH:MM\n\nCertifique-se que é uma data futura.\nExemplo: 25/12/2023 15:30'
                );
              }
              break;
              
            case APPOINTMENT_STATES.CONFIRMATION:
              if (msg.body.toLowerCase() === 'confirmar') {
                await Appointment.create({
                  botId,
                  contact,
                  name: appointmentState.data.name,
                  description: appointmentState.data.description,
                  appointmentDate: appointmentState.data.appointmentDate,
                  status: 'confirmed'
                });
                
                await chat.sendMessage(
                  '✅ *Agendamento confirmado com sucesso!*\n\n' +
                  `*${appointmentState.data.name}*\n` +
                  `⏰ ${formatAppointmentDate(appointmentState.data.appointmentDate)}\n\n` +
                  'Você receberá um lembrete 24 horas antes.'
                );
                
                appointmentStates.delete(contact);
              } else if (msg.body.toLowerCase() === 'cancelar') {
                appointmentStates.delete(contact);
                await chat.sendMessage(
                  '❌ Agendamento cancelado. Se precisar, pode iniciar novamente com *#marcacao*.'
                );
              } else {
                await chat.sendMessage(
                  'Por favor, digite *CONFIRMAR* para finalizar ou *CANCELAR* para recomeçar.'
                );
              }
              break;
          }
          
          return;
        }

        let response;
        if (msg.hasMedia) {
          response = await processMedia(msg, config, aiClient) || getRandomResponse();
        } else {
          response = await generateAIResponse(msg.body, config, aiClient);
        }
        
        response = simulateTypo(response);
        
        const baseDelay = config.settings.responseDelay || 3;
        const variedDelay = baseDelay * (1 + (Math.random() * TYPING_VARIATION * 2 - TYPING_VARIATION));
        await new Promise(resolve => setTimeout(resolve, variedDelay * 1000));
        
        await chat.sendMessage(response, { quoted: msg, sendSeen: true });
        
        io.emit('message-log', {
          botId,
          type: 'outgoing',
          message: response,
          timestamp: moment().format('HH:mm:ss')
        });

        const cacheKey = msg.body?.toLowerCase().substring(0, 50) || 'media';
        responseCache.set(cacheKey, { response, timestamp: Date.now() });

      } catch (err) {
        console.error(`[${config.id}] Erro ao processar mensagem:`, err);
      }
    });

    try {
      await client.initialize();
      return client;
    } catch (error) {
      console.error(`[${config.id}] Erro ao inicializar:`, error);
      throw error;
    }
  },

  isBotActive: (botId) => {
    return activeClients.has(botId);
  },

  shutdownBot: async (botId) => {
    try {
      if (!activeClients.has(botId)) {
        console.log(`[${botId}] Bot não está ativo ou já foi desligado`);
        return true;
      }

      const client = activeClients.get(botId);
      
      // Parar verificadores de lembrete
      stopReminderChecker(botId);

      // Tentar destruir o cliente
      try {
        await client.destroy();
        console.log(`[${botId}] Cliente WhatsApp destruído com sucesso`);
      } catch (destroyError) {
        console.error(`[${botId}] Erro ao destruir cliente:`, destroyError);
        // Forçar limpeza mesmo com erro
      }

      // Limpar todos os recursos
      activeClients.delete(botId);
      messageCounters.delete(botId);
      
      if (voiceActivityTimers.has(botId)) {
        clearTimeout(voiceActivityTimers.get(botId).timer);
        voiceActivityTimers.delete(botId);
      }
      
      console.log(`[${botId}] Todos os recursos foram liberados`);
      return true;
    } catch (error) {
      console.error(`[${botId}] Erro crítico ao desligar bot:`, error);
      return false;
    }
  }
};
