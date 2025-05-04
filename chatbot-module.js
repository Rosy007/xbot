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

executablePath: '/usr/bin/google-chrome-stable';
const activeClients = new Map();
const voiceActivityTimers = new Map();

const defaultResponse = `🤖 Não estou conseguindo processar sua mensagem no momento. 
Por favor, tente novamente mais tarde ou entre em contato com o suporte.`;

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
    
    // Configurar APIs de IA
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
        console.error(`[${config.id}] Erro ao gerar QR:`, err);
      }
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

        // Processar mídia se existir
        let response;
        if (msg.hasMedia) {
          response = await processMedia(msg, config, aiClient) || defaultResponse;
        } else {
          // Gerar resposta para texto
          response = await generateAIResponse(msg.body, config, aiClient);
        }
        
        // Adicionar delay simulado
        await new Promise(resolve => 
          setTimeout(resolve, config.settings.responseDelay * 1000));
        
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
async function generateAIResponse(prompt, config, aiClient, mediaType = 'text') {
  try {
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
    `;

    if (mediaType !== 'text') {
      fullPrompt += `\n6. Você está respondendo a ${mediaType === 'image' ? 'uma imagem' : 'uma mensagem de voz'}. Seja criativo na resposta.`;
    }

    if (aiClient?.type === 'gemini') {
      const model = aiClient.instance.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent(fullPrompt);
      return result.response.text();
    } else if (aiClient?.type === 'openai') {
      const completion = await aiClient.instance.chat.completions.create({
        messages: [
          { role: "system", content: BOT_IDENTITY },
          { role: "user", content: mediaType === 'text' ? prompt : `Responda a ${mediaType === 'image' ? 'uma imagem' : 'uma mensagem de voz'}` }
        ],
        model: "gpt-3.5-turbo",
        max_tokens: config.settings.maxResponseLength
      });
      return completion.choices[0].message.content;
    }
    
    return defaultResponse;
  } catch (error) {
    console.error('Erro na geração de resposta:', error);
    return defaultResponse;
  }
}

// Processar mídia (imagens e voz)
async function processMedia(msg, config, aiClient) {
  try {
    if (msg.hasMedia) {
      const media = await msg.downloadMedia();
      
      if (msg.type === 'image') {
        // Processar imagem
        const imagePrompt = "Descreva esta imagem e responda de forma natural";
        return generateAIResponse(imagePrompt, config, aiClient, 'image');
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