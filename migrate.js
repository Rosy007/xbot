const botsTable = await queryInterface.describeTable('Bots');

if (!botsTable.planId) {
  await queryInterface.addColumn('Bots', 'planId', {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'Plans',
      key: 'id'
    }
  });
  console.log('✅ Coluna planId adicionada em Bots.');
} else {
  console.log('ℹ️ Coluna planId já existe em Bots.');
}

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


