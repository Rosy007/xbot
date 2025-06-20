// create-migration.js
const { sequelize } = require('./seu-arquivo-de-modelos'); // ajuste o caminho

async function runMigration() {
  try {
    // Adiciona a coluna isClient à tabela Users
    await sequelize.getQueryInterface().addColumn('Users', 'isClient', {
      type: Sequelize.BOOLEAN,
      defaultValue: false
    });
    
    console.log('Migração concluída com sucesso!');
  } catch (error) {
    console.error('Erro na migração:', error);
  } finally {
    await sequelize.close();
  }
}

runMigration();
