// migrate-simple.js
const { Bot, sequelize } = require('./database');
const botsData = require('./bots-config.json');

async function migrate() {
  try {
    await sequelize.sync({ force: true });
    
    for (const bot of botsData) {
      await Bot.create(bot);
    }
    
    console.log('Migração concluída!');
  } catch (error) {
    console.error('Erro:', error);
  } finally {
    await sequelize.close();
  }
}

migrate();