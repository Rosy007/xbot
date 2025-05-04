// Carregar lista de bots
function loadBots() {
  fetch('/api/bots')
    .then(response => response.json())
    .then(data => {
      const botsList = document.getElementById('botsList');
      botsList.innerHTML = '';
      
      data.forEach(bot => {
        const botElement = document.createElement('div');
        botElement.className = 'bot-item';
        botElement.innerHTML = `
          <div class="bot-info">
            <h3>${bot.name}</h3>
            <p>${bot.botIdentity.substring(0, 50)}...</p>
            <div class="bot-status ${bot.isActive ? 'active' : 'inactive'}">
              ${bot.isActive ? 'Ativo' : 'Inativo'}
            </div>
          </div>
          <div class="bot-actions">
            ${bot.isActive ? 
              `<button onclick="stopBot('${bot.id}')">Parar</button>` : 
              `<button onclick="startBot('${bot.id}')">Iniciar</button>`
            }
            <button onclick="editBot('${bot.id}')">Editar</button>
            <button onclick="deleteBot('${bot.id}')">Excluir</button>
          </div>
        `;
        botsList.appendChild(botElement);
      });
    });
}

// Funções para manipular bots
function createBot() {
  const name = document.getElementById('botName').value;
  const geminiKey = document.getElementById('geminiKey').value;
  const openaiKey = document.getElementById('openaiKey').value;
  const botIdentity = document.getElementById('botIdentity').value;
  
  fetch('/api/bots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      apiKeys: { gemini: geminiKey, openai: openaiKey },
      botIdentity
    })
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      loadBots();
      closeModal();
    }
  });
}

function startBot(botId) {
  fetch(`/api/start/${botId}`, { method: 'POST' })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        loadBots();
      }
    });
}

function stopBot(botId) {
  fetch(`/api/stop/${botId}`, { method: 'POST' })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        loadBots();
      }
    });
}

// Carregar bots quando a página carregar
document.addEventListener('DOMContentLoaded', loadBots);