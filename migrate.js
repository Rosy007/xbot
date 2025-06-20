// migrate.js
const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

// Configuração do Sequelize - deve ser IDÊNTICA à do seu arquivo principal
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'database.sqlite'),
  logging: console.log
});

async function addIsClientColumn() {
  try {
    // Verifica se a coluna já existe
    const tableInfo = await sequelize.getQueryInterface().describeTable('Users');
    
    if (!tableInfo.isClient) {
      // Adiciona a coluna se não existir
      await sequelize.getQueryInterface().addColumn('Users', 'isClient', {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      });
      console.log('Coluna isClient adicionada com sucesso!');
    } else {
      console.log('Coluna isClient já existe na tabela Users');
    }
  } catch (error) {
    console.error('Erro durante a migração:', error);
  } finally {
    await sequelize.close();
  }
}

addIsClientColumn();
