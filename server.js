// Rotas FIM
// Inicialização do servidor
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Servidor rodando na porta ${PORT}`);
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (err) => {
  console.error('[ERROR] Erro não tratado:', err);
});

process.on('uncaughtException', (err) => {
  console.error('[ERROR] Exceção não capturada:', err);
});

// Função para iniciar todos os bots ativos ao iniciar o servidor
async function initializeActiveBots() {
  try {
    const activeBots = await Bot.findAll({ 
      where: { 
        isActive: true,
        startDate: { [Op.lte]: new Date() },
        endDate: { [Op.gte]: new Date() }
      },
      include: [{
        model: Subscription,
        include: [Plan]
      }]
    });

    console.log(`[SERVER] Iniciando ${activeBots.length} bots ativos...`);
    
    for (const bot of activeBots) {
      try {
        await initChatbot(bot, io);
        console.log(`[SERVER] Bot ${bot.id} (${bot.name}) iniciado com sucesso`);
      } catch (error) {
        console.error(`[SERVER] Erro ao iniciar bot ${bot.id}:`, error);
        await bot.update({ isActive: false });
      }
    }
  } catch (error) {
    console.error('[SERVER] Erro ao inicializar bots ativos:', error);
  }
}

// Inicializar bots ativos quando o servidor iniciar
initializeActiveBots();

