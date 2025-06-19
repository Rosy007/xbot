// redis-service.js
const redis = require('redis');
const { promisify } = require('util');
const moment = require('moment');
const { Bot, ScheduledMessage } = require('./database');

class RedisService {
  constructor() {
    this.client = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    this.client.on('error', (err) => {
      console.error('Redis error:', err);
    });
    
    this.ready = false;
    this.client.on('connect', () => {
      console.log('Connected to Redis');
      this.ready = true;
    });
    
    // Promisify methods
    this.setAsync = promisify(this.client.set).bind(this.client);
    this.getAsync = promisify(this.client.get).bind(this.client);
    this.delAsync = promisify(this.client.del).bind(this.client);
    this.keysAsync = promisify(this.client.keys).bind(this.client);
    this.hsetAsync = promisify(this.client.hset).bind(this.client);
    this.hgetAsync = promisify(this.client.hget).bind(this.client);
    this.hdelAsync = promisify(this.client.hdel).bind(this.client);
    this.hgetallAsync = promisify(this.client.hgetall).bind(this.client);
    this.zaddAsync = promisify(this.client.zadd).bind(this.client);
    this.zrangebyscoreAsync = promisify(this.client.zrangebyscore).bind(this.client);
    this.zremAsync = promisify(this.client.zrem).bind(this.client);
  }

  async cacheSession(botId, sessionData) {
    if (!this.ready) return false;
    try {
      await this.setAsync(`session:${botId}`, JSON.stringify(sessionData));
      return true;
    } catch (err) {
      console.error('Error caching session:', err);
      return false;
    }
  }

  async getSession(botId) {
    if (!this.ready) return null;
    try {
      const session = await this.getAsync(`session:${botId}`);
      return session ? JSON.parse(session) : null;
    } catch (err) {
      console.error('Error getting session:', err);
      return null;
    }
  }

  async deleteSession(botId) {
    if (!this.ready) return false;
    try {
      await this.delAsync(`session:${botId}`);
      return true;
    } catch (err) {
      console.error('Error deleting session:', err);
      return false;
    }
  }

  async scheduleMessage(botId, messageId, recipient, message, scheduledTime) {
    if (!this.ready) return false;
    try {
      const timestamp = moment(scheduledTime).valueOf();
      await this.zaddAsync('scheduled_messages', timestamp, `${botId}:${messageId}`);
      await this.hsetAsync(`message:${botId}:${messageId}`, {
        recipient,
        message,
        scheduledTime: scheduledTime.toISOString()
      });
      return true;
    } catch (err) {
      console.error('Error scheduling message:', err);
      return false;
    }
  }

  async getDueMessages() {
    if (!this.ready) return [];
    try {
      const now = moment().valueOf();
      const messageKeys = await this.zrangebyscoreAsync('scheduled_messages', 0, now);
      
      const messages = [];
      for (const key of messageKeys) {
        const [botId, messageId] = key.split(':');
        const messageData = await this.hgetallAsync(`message:${botId}:${messageId}`);
        if (messageData) {
          messages.push({
            botId,
            messageId,
            recipient: messageData.recipient,
            message: messageData.message,
            scheduledTime: new Date(messageData.scheduledTime)
          });
        }
      }
      
      return messages;
    } catch (err) {
      console.error('Error getting due messages:', err);
      return [];
    }
  }

  async removeScheduledMessage(botId, messageId) {
    if (!this.ready) return false;
    try {
      await this.zremAsync('scheduled_messages', `${botId}:${messageId}`);
      await this.delAsync(`message:${botId}:${messageId}`);
      return true;
    } catch (err) {
      console.error('Error removing scheduled message:', err);
      return false;
    }
  }

  async cacheBotTraining(botId, trainingData) {
    if (!this.ready) return false;
    try {
      await this.setAsync(`training:${botId}`, JSON.stringify(trainingData));
      return true;
    } catch (err) {
      console.error('Error caching bot training:', err);
      return false;
    }
  }

  async getBotTraining(botId) {
    if (!this.ready) return null;
    try {
      const training = await this.getAsync(`training:${botId}`);
      return training ? JSON.parse(training) : null;
    } catch (err) {
      console.error('Error getting bot training:', err);
      return null;
    }
  }
}

const redisService = new RedisService();
module.exports = redisService;
