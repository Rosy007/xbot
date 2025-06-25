const redis = require('redis');
const { promisify } = require('util');
const moment = require('moment');
const { v4: uuidv4 } = require('uuid');

class RedisService {
  constructor() {
    this.client = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('Too many retries on REDIS. Connection terminated');
            return new Error('Too many retries');
          }
          return Math.min(retries * 100, 5000);
        }
      }
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    this.client.on('connect', () => {
      console.log('Connected to Redis');
    });

    this.client.on('ready', () => {
      console.log('Redis client ready');
    });

    this.client.on('reconnecting', () => {
      console.log('Redis client reconnecting...');
    });

    // Promisify methods
    this.getAsync = promisify(this.client.get).bind(this.client);
    this.setAsync = promisify(this.client.set).bind(this.client);
    this.delAsync = promisify(this.client.del).bind(this.client);
    this.incrAsync = promisify(this.client.incr).bind(this.client);
    this.decrAsync = promisify(this.client.decr).bind(this.client);
    this.expireAsync = promisify(this.client.expire).bind(this.client);
    this.ttlAsync = promisify(this.client.ttl).bind(this.client);
    this.keysAsync = promisify(this.client.keys).bind(this.client);
    this.zaddAsync = promisify(this.client.zadd).bind(this.client);
    this.zrangeAsync = promisify(this.client.zrange).bind(this.client);
    this.zremAsync = promisify(this.client.zrem).bind(this.client);
    this.zrangebyscoreAsync = promisify(this.client.zrangebyscore).bind(this.client);
    this.saddAsync = promisify(this.client.sadd).bind(this.client);
    this.smembersAsync = promisify(this.client.smembers).bind(this.client);
    this.sremAsync = promisify(this.client.srem).bind(this.client);
    this.hsetAsync = promisify(this.client.hset).bind(this.client);
    this.hgetAsync = promisify(this.client.hget).bind(this.client);
    this.hgetallAsync = promisify(this.client.hgetall).bind(this.client);
    this.hdelAsync = promisify(this.client.hdel).bind(this.client);
    this.flushallAsync = promisify(this.client.flushall).bind(this.client);
  }

  async connect() {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
    return this;
  }

  async disconnect() {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  // Métodos básicos
  async get(key) {
    try {
      const value = await this.getAsync(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`Redis GET error for key ${key}:`, error);
      throw error;
    }
  }

  async set(key, value, ttl = null) {
    try {
      const stringValue = JSON.stringify(value);
      if (ttl) {
        await this.setAsync(key, stringValue, 'EX', ttl);
      } else {
        await this.setAsync(key, stringValue);
      }
      return true;
    } catch (error) {
      console.error(`Redis SET error for key ${key}:`, error);
      throw error;
    }
  }

  async del(key) {
    try {
      return await this.delAsync(key);
    } catch (error) {
      console.error(`Redis DEL error for key ${key}:`, error);
      throw error;
    }
  }

  async exists(key) {
    try {
      return await this.getAsync(key) !== null;
    } catch (error) {
      console.error(`Redis EXISTS error for key ${key}:`, error);
      throw error;
    }
  }

  // Contadores
  async increment(key, ttl = null) {
    try {
      const count = await this.incrAsync(key);
      if (ttl && count === 1) {
        await this.expireAsync(key, ttl);
      }
      return count;
    } catch (error) {
      console.error(`Redis INCR error for key ${key}:`, error);
      throw error;
    }
  }

  async decrement(key) {
    try {
      return await this.decrAsync(key);
    } catch (error) {
      console.error(`Redis DECR error for key ${key}:`, error);
      throw error;
    }
  }

  // Expiração
  async expire(key, seconds) {
    try {
      return await this.expireAsync(key, seconds);
    } catch (error) {
      console.error(`Redis EXPIRE error for key ${key}:`, error);
      throw error;
    }
  }

  async ttl(key) {
    try {
      return await this.ttlAsync(key);
    } catch (error) {
      console.error(`Redis TTL error for key ${key}:`, error);
      throw error;
    }
  }

  // Conjuntos ordenados (para agendamentos)
  async addToSortedSet(key, score, value) {
    try {
      return await this.zaddAsync(key, score, JSON.stringify(value));
    } catch (error) {
      console.error(`Redis ZADD error for key ${key}:`, error);
      throw error;
    }
  }

  async getFromSortedSet(key, start = 0, stop = -1) {
    try {
      const values = await this.zrangeAsync(key, start, stop);
      return values.map(v => JSON.parse(v));
    } catch (error) {
      console.error(`Redis ZRANGE error for key ${key}:`, error);
      throw error;
    }
  }

  async removeFromSortedSet(key, value) {
    try {
      return await this.zremAsync(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Redis ZREM error for key ${key}:`, error);
      throw error;
    }
  }

  async getRangeByScore(key, min, max) {
    try {
      const values = await this.zrangebyscoreAsync(key, min, max);
      return values.map(v => JSON.parse(v));
    } catch (error) {
      console.error(`Redis ZRANGEBYSCORE error for key ${key}:`, error);
      throw error;
    }
  }

  // Conjuntos
  async addToSet(key, value) {
    try {
      return await this.saddAsync(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Redis SADD error for key ${key}:`, error);
      throw error;
    }
  }

  async getSetMembers(key) {
    try {
      const values = await this.smembersAsync(key);
      return values.map(v => JSON.parse(v));
    } catch (error) {
      console.error(`Redis SMEMBERS error for key ${key}:`, error);
      throw error;
    }
  }

  async removeFromSet(key, value) {
    try {
      return await this.sremAsync(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Redis SREM error for key ${key}:`, error);
      throw error;
    }
  }

  // Hash
  async setHashField(key, field, value) {
    try {
      return await this.hsetAsync(key, field, JSON.stringify(value));
    } catch (error) {
      console.error(`Redis HSET error for key ${key} field ${field}:`, error);
      throw error;
    }
  }

  async getHashField(key, field) {
    try {
      const value = await this.hgetAsync(key, field);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`Redis HGET error for key ${key} field ${field}:`, error);
      throw error;
    }
  }

  async getAllHashFields(key) {
    try {
      const values = await this.hgetallAsync(key);
      if (!values) return null;
      
      const result = {};
      for (const [field, value] of Object.entries(values)) {
        result[field] = JSON.parse(value);
      }
      return result;
    } catch (error) {
      console.error(`Redis HGETALL error for key ${key}:`, error);
      throw error;
    }
  }

  async deleteHashField(key, field) {
    try {
      return await this.hdelAsync(key, field);
    } catch (error) {
      console.error(`Redis HDEL error for key ${key} field ${field}:`, error);
      throw error;
    }
  }

  // Métodos específicos para o bot
  async cacheSession(botId, sessionData) {
    try {
      const ttl = sessionData.ttl || 86400; // 24 horas padrão
      return await this.set(`session:${botId}`, sessionData, ttl);
    } catch (error) {
      console.error(`Error caching session for bot ${botId}:`, error);
      throw error;
    }
  }

  async getSession(botId) {
    try {
      return await this.get(`session:${botId}`);
    } catch (error) {
      console.error(`Error getting session for bot ${botId}:`, error);
      throw error;
    }
  }

  async deleteSession(botId) {
    try {
      return await this.del(`session:${botId}`);
    } catch (error) {
      console.error(`Error deleting session for bot ${botId}:`, error);
      throw error;
    }
  }

  async addMessageToHistory(botId, conversationId, message) {
    try {
      const key = `history:${botId}:${conversationId}`;
      const history = await this.get(key) || [];
      
      // Limitar o histórico ao tamanho configurado
      const maxSize = 50; // Pode ser configurável
      if (history.length >= maxSize) {
        history.shift();
      }
      
      history.push({
        ...message,
        timestamp: moment().toISOString(),
        id: uuidv4()
      });
      
      await this.set(key, history, 604800); // 7 dias de retenção
      return history;
    } catch (error) {
      console.error(`Error adding message to history for bot ${botId}:`, error);
      throw error;
    }
  }

  async getMessageHistory(botId, conversationId) {
    try {
      const key = `history:${botId}:${conversationId}`;
      return await this.get(key) || [];
    } catch (error) {
      console.error(`Error getting message history for bot ${botId}:`, error);
      throw error;
    }
  }

  async clearMessageHistory(botId, conversationId) {
    try {
      const key = `history:${botId}:${conversationId}`;
      return await this.del(key);
    } catch (error) {
      console.error(`Error clearing message history for bot ${botId}:`, error);
      throw error;
    }
  }

  async scheduleMessage(botId, message) {
    try {
      const score = new Date(message.scheduledAt).getTime();
      const jobId = uuidv4();
      const job = {
        ...message,
        jobId,
        status: 'scheduled',
        createdAt: moment().toISOString()
      };
      
      await this.addToSortedSet(`schedules:${botId}`, score, job);
      return jobId;
    } catch (error) {
      console.error(`Error scheduling message for bot ${botId}:`, error);
      throw error;
    }
  }

  async getScheduledMessages(botId, limit = 10) {
    try {
      return await this.getFromSortedSet(`schedules:${botId}`, 0, limit - 1);
    } catch (error) {
      console.error(`Error getting scheduled messages for bot ${botId}:`, error);
      throw error;
    }
  }

  async removeScheduledMessage(botId, jobId) {
    try {
      const messages = await this.getFromSortedSet(`schedules:${botId}`);
      const messageToRemove = messages.find(m => m.jobId === jobId);
      
      if (messageToRemove) {
        await this.removeFromSortedSet(`schedules:${botId}`, messageToRemove);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Error removing scheduled message for bot ${botId}:`, error);
      throw error;
    }
  }

  async processDueMessages(botId) {
    try {
      const now = Date.now();
      const dueMessages = await this.getRangeByScore(`schedules:${botId}`, 0, now);
      
      const processedMessages = [];
      for (const message of dueMessages) {
        try {
          // Marcar como processado
          message.status = 'processing';
          message.processingAt = moment().toISOString();
          
          // Adicionar à lista de processados
          processedMessages.push(message);
          
          // Remover da lista de agendados
          await this.removeFromSortedSet(`schedules:${botId}`, message);
          
          // Adicionar à lista de processados (opcional)
          await this.addToSet(`processed:${botId}`, message);
        } catch (error) {
          console.error(`Error processing message ${message.jobId}:`, error);
          message.status = 'failed';
          message.error = error.message;
          await this.addToSet(`failed:${botId}`, message);
        }
      }
      
      return processedMessages;
    } catch (error) {
      console.error(`Error processing due messages for bot ${botId}:`, error);
      throw error;
    }
  }

  async getMessageCounts(botId) {
    try {
      const now = moment();
      const hourKey = `count:${botId}:${now.format('YYYY-MM-DD-HH')}`;
      const dayKey = `count:${botId}:${now.format('YYYY-MM-DD')}`;
      
      const hourlyCount = parseInt(await this.getAsync(hourKey) || '0');
      const dailyCount = parseInt(await this.getAsync(dayKey) || '0');
      
      return { hourlyCount, dailyCount };
    } catch (error) {
      console.error(`Error getting message counts for bot ${botId}:`, error);
      throw error;
    }
  }

  async incrementMessageCount(botId) {
    try {
      const now = moment();
      const hourKey = `count:${botId}:${now.format('YYYY-MM-DD-HH')}`;
      const dayKey = `count:${botId}:${now.format('YYYY-MM-DD')}`;
      
      const hourlyCount = await this.increment(hourKey, 3600);
      const dailyCount = await this.increment(dayKey, 86400);
      
      return { hourlyCount, dailyCount };
    } catch (error) {
      console.error(`Error incrementing message count for bot ${botId}:`, error);
      throw error;
    }
  }

  async resetCounters(botId) {
    try {
      const keys = await this.keysAsync(`count:${botId}:*`);
      if (keys.length > 0) {
        await this.delAsync(keys);
      }
      return true;
    } catch (error) {
      console.error(`Error resetting counters for bot ${botId}:`, error);
      throw error;
    }
  }

  async flushAll() {
    try {
      return await this.flushallAsync();
    } catch (error) {
      console.error('Error flushing Redis:', error);
      throw error;
    }
  }
}

// Criar e exportar instância singleton
const redisService = new RedisService();

// Conectar automaticamente ao iniciar
redisService.connect().catch(err => {
  console.error('Failed to connect to Redis:', err);
  process.exit(1);
});

// Lidar com desligamento gracioso
process.on('SIGINT', async () => {
  await redisService.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await redisService.disconnect();
  process.exit(0);
});

module.exports = redisService;
