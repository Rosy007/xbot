const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'database.sqlite'),
  logging: console.log
});

async function migrate() {
  const queryInterface = sequelize.getQueryInterface();

  try {
    // Adiciona coluna isClient na tabela Users (caso não exista)
    const usersTable = await queryInterface.describeTable('Users');
    if (!usersTable.isClient) {
      await queryInterface.addColumn('Users', 'isClient', {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      });
      console.log('Coluna isClient adicionada à tabela Users.');
    } else {
      console.log('Coluna isClient já existe em Users.');
    }

    // Adiciona coluna planId na tabela Bots (caso não exista)
    const botsTable = await queryInterface.describeTable('Bots');
    if (!botsTable.planId) {
      await queryInterface.addColumn('Bots', 'planId', {
        type: DataTypes.UUID,
        references: {
          model: 'Plans', // o nome deve estar certo aqui (case-sensitive)
          key: 'id'
        },
        allowNull: true
      });
      console.log('Coluna planId adicionada à tabela Bots.');
    } else {
      console.log('Coluna planId já existe em Bots.');
    }

  } catch (error) {
    console.error('Erro durante a migração:', error);
  } finally {
    await sequelize.close();
  }
}
    // Verificar e adicionar SubscriptionId à tabela Bots
    if (!botsTable.SubscriptionId) {
      await queryInterface.addColumn('Bots', 'SubscriptionId', {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'Subscriptions',
          key: 'id'
        }
      });
      console.log('✅ Coluna SubscriptionId adicionada em Bots.');
    } else {
      console.log('ℹ️ Coluna SubscriptionId já existe em Bots.');
    }

migrate();

