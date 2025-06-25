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

// Configurações originais do seu sistema
const MAX_MESSAGES_PER_MINUTE = 15;
const MIN_RESPONSE_DELAY = 1;
const MAX_RESPONSE_DELAY = 5;
const TYPING_VARIATION = 0.5;

// Configurações específicas para agendamentos
const APPOINTMENT_COMMAND = '#marcacao';
const APPOINTMENT_STATES = {
  START: 0,
  GETTING_NAME: 1,
  GETTING_DESCRIPTION: 2,
  GETTING_DATE: 3,
  CONFIRMATION: 4
};

const activeClients = new Map();
const voiceActivityTimers = new Map();
const messageCounters = new Map();
const appointmentStates = new Map();
const reminderIntervals = new Map();

const defaultResponse = `🤖 Não estou conseguindo processar sua mensagem no momento. 
Por favor, tente novamente mais tarde ou entre em contato com o suporte.`;

const responseCache = new Map();

// Função auxiliar para formatar data de agendamento
function formatAppointmentDate(date) {
  return moment(date).format('DD/MM/YYYY [às] HH:mm');
}

// Função para verificar e enviar lembretes (mantida discreta)
async function checkAndSendReminders(client, botId) {
  try {
    const now = new Date();
    const oneDayLater = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

    // Lembretes 1 dia antes
    const dayBeforeAppointments = await Appointment.findAll({
      where: {
        botId,
        status: 'confirmed',
        appointmentDate: {
          [Sequelize.Op.between]: [now, oneDayLater]
        },
        remindedOneDayBefore: false
      }
    });

    for (const appointment of dayBeforeAppointments) {
      const timeDiff = appointment.appointmentDate.getTime() - now.getTime();
      
      if (timeDiff <= 24 * 60 * 60 * 1000 && timeDiff > 23 * 60 * 60 * 1000) {
        await client.sendMessage(
          appointment.contact,
          `📅 *Lembrete de Agendamento*:\n\n` +
          `*${appointment.name}*\n` +
          `⏰ ${formatAppointmentDate(appointment.appointmentDate)}\n\n` +
          `Faltam aproximadamente 24 horas.`
        );
        await appointment.update({ remindedOneDayBefore: true });
      }
    }

    // Lembretes 1 hora antes
    const hourBeforeAppointments = await Appointment.findAll({
      where: {
        botId,
        status: 'confirmed',
        appointmentDate: {
          [Sequelize.Op.between]: [now, oneHourLater]
        },
        remindedOneHourBefore: false
      }
    });

    for (const appointment of hourBeforeAppointments) {
      const timeDiff = appointment.appointmentDate.getTime() - now.getTime();
      
      if (timeDiff <= 60 * 60 * 1000 && timeDiff > 59 * 60 * 1000) {
        await client.sendMessage(
          appointment.contact,
          `⏰ *Lembrete de Agendamento*:\n\n` +
          `*${appointment.name}*\n` +
          `⏰ ${formatAppointmentDate(appointment.appointmentDate)}\n\n` +
          `Falta aproximadamente 1 hora.`
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

// Função original para gerar respostas com IA
async function generateAIResponse(prompt, config, aiClient, mediaType = 'text') {
  try {
    const cacheKey = prompt?.toLowerCase().substring(0, 50) || 'media';
    const cachedResponse = responseCache.get(cacheKey);
    if (cachedResponse && (Date.now() - cachedResponse.timestamp < 3600000)) {
      console.log(`[${config.id}] Usando resposta em cache para: ${cacheKey}`);
      return cachedResponse.response;
    }

    const BOT_IDENTITY = config.botIdentity;
    const currentDate = moment().format('DD/MM/YYYY HH:mm');
    
    let fullPrompt = `
      ${BOT_IDENTITY}
      
      Informações:
      - Data atual: ${currentDate}
      - Limite de caracteres: ${config.settings.maxResponseLength}
      ${mediaType === 'text' ? `- Mensagem recebida: "${prompt}"` : `- ${mediaType === 'image' ? 'Imagem recebida' : 'Mensagem de voz recebida'}`}
      
      Instruções:
      1. Responda de forma natural como um humano
      2. Seja conciso (1-2 frases no máximo)
      3. Use 1-2 emojis relevantes
      4. Nunca revele que é um bot
      5. Mantenha o tom profissional mas amigável
      6. Evite repetir exatamente a mesma resposta para perguntas similares
      7. Varie o vocabulário e estrutura das frases
    `;

    if (mediaType !== 'text') {
      fullPrompt += `\n8. Você está respondendo a ${mediaType === 'image' ? 'uma imagem' : 'uma mensagem de voz'}. Seja criativo na resposta.`;
    }

    if (aiClient?.type === 'gemini') {
      const model = aiClient.instance.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(fullPrompt);
      const response = result.response.text();
      return response.substring(0, config.settings.maxResponseLength);
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
      return completion.choices[0].message.content;
    }
    
    return defaultResponse;
  } catch (error) {
    console.error('Erro na geração de resposta:', error);
    return defaultResponse;
  }
}

// Processar mídia (original)
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

module.exports = {
  initChatbot: async (config, io) => {
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

    messageCounters.set(config.id, {
      count: 0,
      lastReset: Date.now()
    });

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
      takeoverOnConflict: false,
      takeoverTimeoutMs: 0
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
      startReminderChecker(client, config.id); // Inicia o verificador de lembretes
      io.emit('status-update', {
        botId: config.id,
        status: 'connected',
        message: `✅ Conectado às ${moment().format('HH:mm:ss')}`,
        timestamp: moment().format()
      });
    });

    client.on('disconnected', (reason) => {
      console.log(`[${config.id}] Desconectado:`, reason);
      activeClients.delete(config.id);
      messageCounters.delete(config.id);
      stopReminderChecker(config.id); // Para o verificador de lembretes
      io.emit('status-update', {
        botId: config.id,
        status: 'disconnected',
        message: `❌ Desconectado: ${reason}`,
        timestamp: moment().format()
      });
    });

    client.on('message', async msg => {
      try {
        if (msg.fromMe) return;
        
        const chat = await msg.getChat();
        const botId = config.id;
        const contact = msg.from;
        
        // Verificar se é grupo e se deve ignorar
        if (chat.isGroup && config.settings.preventGroupResponses) {
          console.log(`[${botId}] Mensagem de grupo ignorada`);
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

        // Verificar limite de mensagens
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

        // Verificar se é um humano assumindo o controle
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

        // Se humano está no controle, não responder
        if (voiceActivityTimers.get(botId)?.humanInControl) {
          console.log(`[${botId}] Mensagem ignorada - humano no controle`);
          return;
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
          const baseDuration = config.settings.typingDuration || 2;
          const variedDuration = baseDuration * (1 + (Math.random() * TYPING_VARIATION * 2 - TYPING_VARIATION));
          await new Promise(resolve => 
            setTimeout(resolve, variedDuration * 1000));
        }

        // Verificar se é comando de agendamento
        if (msg.body && msg.body.toLowerCase() === APPOINTMENT_COMMAND) {
          appointmentStates.set(contact, {
            state: APPOINTMENT_STATES.GETTING_NAME,
            data: {}
          });
          await chat.sendMessage(
            '📅 *Sistema de Agendamento*\n\n' +
            'Vou te ajudar a marcar seu compromisso!\n\n' +
            'Primeiro, me diga *como devo chamar este compromisso* (ex: Consulta médica, Reunião importante):'
          );
          return;
        }

        // Verificar se está em processo de agendamento
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
                'Certo! Agora me informe *a data e hora* do compromisso no formato:\n' +
                'DD/MM/AAAA HH:MM\n\n' +
                'Por exemplo: 25/12/2023 15:30'
              );
              break;
              
            case APPOINTMENT_STATES.GETTING_DATE:
              try {
                const [datePart, timePart] = msg.body.split(' ');
                const [day, month, year] = datePart.split('/').map(Number);
                const [hours, minutes] = timePart.split(':').map(Number);
                
                const appointmentDate = new Date(year, month - 1, day, hours, minutes);
                
                if (isNaN(appointmentDate.getTime())) {
                  throw new Error('Data inválida');
                }
                
                if (appointmentDate < new Date()) {
                  throw new Error('Data no passado');
                }
                
                appointmentState.data.appointmentDate = appointmentDate;
                appointmentState.state = APPOINTMENT_STATES.CONFIRMATION;
                
                await chat.sendMessage(
                  '📋 *Confirme os detalhes do agendamento:*\n\n' +
                  `*Nome:* ${appointmentState.data.name}\n` +
                  `*Descrição:* ${appointmentState.data.description}\n` +
                  `*Data/Hora:* ${formatAppointmentDate(appointmentState.data.appointmentDate)}\n\n` +
                  'Se estiver tudo correto, digite *CONFIRMAR*.\n' +
                  'Para cancelar, digite *CANCELAR*.'
                );
              } catch (error) {
                await chat.sendMessage(
                  '❌ *Data inválida!*\n\n' +
                  'Por favor, envie novamente no formato:\n' +
                  'DD/MM/AAAA HH:MM\n\n' +
                  'Certifique-se que é uma data futura.\n' +
                  'Exemplo: 25/12/2023 15:30'
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

        // Processar mídia se existir
        let response;
        if (msg.hasMedia) {
          response = await processMedia(msg, config, aiClient) || defaultResponse;
        } else {
          // Gerar resposta para texto (comportamento normal do bot)
          response = await generateAIResponse(msg.body, config, aiClient);
        }
        
        // Adicionar delay simulado variável
        const baseDelay = config.settings.responseDelay || 2;
        const variedDelay = baseDelay * (1 + (Math.random() * TYPING_VARIATION * 2 - TYPING_VARIATION));
        await new Promise(resolve => 
          setTimeout(resolve, variedDelay * 1000));
        
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

        // Adicionar ao cache de respostas
        const cacheKey = msg.body?.toLowerCase().substring(0, 50) || 'media';
        responseCache.set(cacheKey, {
          response,
          timestamp: Date.now()
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
        stopReminderChecker(botId); // Parar verificador de lembretes
        await activeClients.get(botId).destroy();
        activeClients.delete(botId);
        messageCounters.delete(botId);
        
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
