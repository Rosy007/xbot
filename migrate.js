const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'database.sqlite'),
  logging: console.log
});

async function runMigrations() {
  const queryInterface = sequelize.getQueryInterface();

  try {
    // Verificar e adicionar isClient à tabela Users
    const usersTable = await queryInterface.describeTable('Users');
    if (!usersTable.isClient) {
      await queryInterface.addColumn('Users', 'isClient', {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      });
      console.log('✅ Coluna isClient adicionada em Users.');
    } else {
      console.log('ℹ️ Coluna isClient já existe em Users.');
    }

    // Verificar e adicionar planId à tabela Bots
    const botsTable = await queryInterface.describeTable('Bots');
    if (!botsTable.planId) {
      await queryInterface.addColumn('Bots', 'planId', {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'Plans', // nome da tabela referenciada
          key: 'id'
        }
      });
      console.log('✅ Coluna planId adicionada em Bots.');
    } else {
      console.log('ℹ️ Coluna planId já existe em Bots.');
    }

  } catch (error) {
    console.error('❌ Erro durante a migração:', error);
  } finally {
    await sequelize.close();
    console.log('🔁 Conexão com o banco de dados encerrada.');
  }
}

runMigrations();



