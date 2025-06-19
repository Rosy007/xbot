// redis-service.js
const { createClient } = require('redis');
const moment = require('moment');
const { Bot, ScheduledMessage } = require('./database');

class RedisService {
  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    this.client.on('error', (err) => {
      console.error('Redis error:', err);
    });
    
    this.ready = false;
  }

  async connect() {
    if (!this.ready) {
      await this.client.connect();
      this.ready = true;
      console.log('Connected to Redis');
    }
  }

  async cacheSession(botId, sessionData) {
    try {
      await this.connect();
      await this.client.set(`session:${botId}`, JSON.stringify(sessionData));
      return true;
    } catch (err) {
      console.error('Error caching session:', err);
      return false;
    }
  }

  async getSession(botId) {
    try {
      await this.connect();
      const session = await this.client.get(`session:${botId}`);
      return session ? JSON.parse(session) : null;
    } catch (err) {
      console.error('Error getting session:', err);
      return null;
    }
  }

  async deleteSession(botId) {
    try {
      await this.connect();
      await this.client.del(`session:${botId}`);
      return true;
    } catch (err) {
      console.error('Error deleting session:', err);
      return false;
    }
  }

  async scheduleMessage(botId, messageId, recipient, message, scheduledTime) {
    try {
      await this.connect();
      const timestamp = moment(scheduledTime).valueOf();
      await this.client.zAdd('scheduled_messages', [
        { score: timestamp, value: `${botId}:${messageId}` }
      ]);
      await this.client.hSet(`message:${botId}:${messageId}`, {
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
    try {
      await this.connect();
      const now = moment().valueOf();
      const messageKeys = await this.client.zRangeByScore('scheduled_messages', 0, now);
      
      const messages = [];
      for (const key of messageKeys) {
        const [botId, messageId] = key.split(':');
        const messageData = await this.client.hGetAll(`message:${botId}:${messageId}`);
        if (messageData && messageData.recipient) {
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
    try {
      await this.connect();
      await this.client.zRem('scheduled_messages', `${botId}:${messageId}`);
      await this.client.del(`message:${botId}:${messageId}`);
      return true;
    } catch (err) {
      console.error('Error removing scheduled message:', err);
      return false;
    }
  }

  async cacheBotTraining(botId, trainingData) {
    try {
      await this.connect();
      await this.client.set(`training:${botId}`, JSON.stringify(trainingData));
      return true;
    } catch (err) {
      console.error('Error caching bot training:', err);
      return false;
    }
  }

  async getBotTraining(botId) {
    try {
      await this.connect();
      const training = await this.client.get(`training:${botId}`);
      return training ? JSON.parse(training) : null;
    } catch (err) {
      console.error('Error getting bot training:', err);
      return null;
    }
  }
}

const redisService = new RedisService();
module.exports = redisService;
