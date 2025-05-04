document.addEventListener('DOMContentLoaded', () => {
    // Elementos da UI
    const socket = io();
    const newBotBtn = document.getElementById('newBotBtn');
    const botModal = document.getElementById('botModal');
    const qrModal = document.getElementById('qrModal');
    const apiKeysModal = document.getElementById('apiKeysModal');
    const botForm = document.getElementById('botForm');
    const apiKeysForm = document.getElementById('apiKeysForm');
    const botList = document.getElementById('botList');
    const configureApiKeysBtn = document.getElementById('configureApiKeysBtn');
    const closeModalBtns = document.querySelectorAll('.close-modal');
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.section');
    const sectionTitle = document.getElementById('section-title');
  
    // Variáveis de estado
    let currentBotId = null;
  
    // Event Listeners
    newBotBtn.addEventListener('click', () => {
      document.getElementById('modalTitle').textContent = 'Novo Bot';
      resetBotForm();
      botModal.classList.add('active');
    });
  
    configureApiKeysBtn.addEventListener('click', () => {
      apiKeysModal.classList.add('active');
    });
  
    closeModalBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        botModal.classList.remove('active');
        qrModal.classList.remove('active');
        apiKeysModal.classList.remove('active');
      });
    });
  
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const section = item.dataset.section;
        navItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
        sections.forEach(sec => sec.classList.remove('active'));
        document.getElementById(`${section}-section`).classList.add('active');
        sectionTitle.textContent = item.querySelector('span').textContent;
      });
    });
  
    botForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const btn = botForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
      
      try {
        const botData = {
          botName: document.getElementById('botName').value.trim(),
          botIdentity: document.getElementById('botIdentity').value.trim(),
          segment: document.getElementById('botSegment').value,
          startDate: document.getElementById('startDate').value || null,
          endDate: document.getElementById('endDate').value || null
        };
  
        if (!botData.botName) {
          throw new Error('Por favor, insira um nome para o bot');
        }
  
        const response = await fetch(currentBotId ? `/api/bot/${currentBotId}` : '/api/bot', {
          method: currentBotId ? 'POST' : 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(botData)
        });
  
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Falha ao salvar bot');
        }
  
        const data = await response.json();
        showSuccess(currentBotId ? 'Bot atualizado com sucesso!' : 'Bot criado com sucesso!');
        botModal.classList.remove('active');
        loadBots();
      } catch (error) {
        showError(error.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Salvar Bot';
      }
    });
  
    apiKeysForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const btn = apiKeysForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
      
      try {
        const apiKeys = {
          gemini: document.getElementById('geminiKey').value.trim(),
          openai: document.getElementById('openaiKey').value.trim()
        };
  
        const response = await fetch(`/api/bot/${currentBotId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ apiKeys })
        });
  
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Falha ao salvar chaves');
        }
  
        showSuccess('Chaves de API atualizadas com sucesso!');
        apiKeysModal.classList.remove('active');
      } catch (error) {
        showError(error.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Salvar Chaves';
      }
    });
  
    // Socket.io Events
    socket.on('qr-update', (data) => {
      if (data.botId === currentBotId) {
        document.getElementById('qrModalTitle').textContent = `Conectar ${data.botName || 'Bot'}`;
        document.getElementById('qrCodeImage').src = data.qrImage;
        document.getElementById('statusMessage').innerHTML = `
          <i class="fas fa-qrcode"></i> Escaneie o QR Code com o WhatsApp
        `;
        qrModal.classList.add('active');
      }
    });
  
    socket.on('status-update', (data) => {
      if (data.botId === currentBotId) {
        const statusElement = document.getElementById('statusMessage');
        
        if (data.status === 'connected') {
          statusElement.innerHTML = `
            <i class="fas fa-check-circle" style="color: var(--success)"></i> 
            Conectado com sucesso!
          `;
          statusElement.className = 'status-message success';
          updateBotStatus(currentBotId, 'connected');
        } else if (data.status === 'error') {
          statusElement.innerHTML = `
            <i class="fas fa-exclamation-circle" style="color: var(--error)"></i> 
            ${data.message}
          `;
          statusElement.className = 'status-message error';
        }
      }
    });
  
    // Funções
    function resetBotForm() {
      document.getElementById('botName').value = '';
      document.getElementById('botIdentity').value = 'Você é um assistente útil. Responda de forma educada e profissional.';
      document.getElementById('botSegment').value = 'geral';
      document.getElementById('startDate').value = '';
      document.getElementById('endDate').value = '';
      document.getElementById('geminiKey').value = '';
      document.getElementById('openaiKey').value = '';
      currentBotId = null;
    }
  
    function loadBots() {
      fetch('/api/bots')
        .then(response => {
          if (!response.ok) throw new Error('Falha ao carregar bots');
          return response.json();
        })
        .then(bots => {
          if (bots.length === 0) {
            botList.innerHTML = `
              <div class="empty-state">
                <i class="fas fa-robot"></i>
                <p>Nenhum bot criado ainda</p>
              </div>
            `;
            return;
          }
  
          botList.innerHTML = bots.map(bot => `
            <div class="bot-card" data-bot-id="${bot.botId}">
              <div class="bot-status ${bot.status}"></div>
              <div class="card-header">
                <h3>${bot.botName || 'Novo Bot'}</h3>
                <span class="bot-badge ${bot.status}">
                  ${getStatusText(bot.status)}
                  ${bot.status === 'scheduled' && bot.startDate ? 
                    `<br><small>Inicia: ${new Date(bot.startDate).toLocaleString()}</small>` : ''}
                  ${bot.status === 'expired' && bot.endDate ? 
                    `<br><small>Encerrou: ${new Date(bot.endDate).toLocaleString()}</small>` : ''}
                </span>
              </div>
              <p><strong>Segmento:</strong> ${bot.segment || 'Geral'}</p>
              <div class="bot-actions">
                <button class="btn btn-sm btn-primary" onclick="startBot('${bot.botId}')" 
                  ${['scheduled', 'expired'].includes(bot.status) ? 'disabled' : ''}>
                  <i class="fas fa-play"></i> Iniciar
                </button>
                <button class="btn btn-sm btn-secondary" onclick="editBot('${bot.botId}')">
                  <i class="fas fa-cog"></i> Configurar
                </button>
                <button class="btn btn-sm btn-danger" onclick="deleteBot('${bot.botId}')">
                  <i class="fas fa-trash"></i> Excluir
                </button>
              </div>
            </div>
          `).join('');
        })
        .catch(error => {
          console.error('Erro ao carregar bots:', error);
          botList.innerHTML = `
            <div class="error-message">
              <i class="fas fa-exclamation-triangle"></i>
              <p>${error.message}</p>
              <button onclick="loadBots()" class="btn btn-sm">
                <i class="fas fa-sync-alt"></i> Tentar novamente
              </button>
            </div>
          `;
        });
    }
  
    function getStatusText(status) {
      const statusMap = {
        'connected': 'Conectado',
        'inactive': 'Inativo',
        'scheduled': 'Agendado',
        'expired': 'Expirado',
        'error': 'Erro'
      };
      return statusMap[status] || status;
    }
  
    function updateBotStatus(botId, status) {
      const botCard = document.querySelector(`.bot-card[data-bot-id="${botId}"]`);
      if (botCard) {
        const statusElement = botCard.querySelector('.bot-status');
        const badgeElement = botCard.querySelector('.bot-badge');
        if (statusElement) statusElement.className = `bot-status ${status}`;
        if (badgeElement) {
          badgeElement.className = `bot-badge ${status}`;
          badgeElement.innerHTML = getStatusText(status);
        }
      }
    }
  
    function showSuccess(message) {
      const alert = document.createElement('div');
      alert.className = 'alert success';
      alert.innerHTML = `
        <i class="fas fa-check-circle"></i>
        <span>${message}</span>
      `;
      document.body.appendChild(alert);
      setTimeout(() => alert.remove(), 3000);
    }
  
    function showError(message) {
      const alert = document.createElement('div');
      alert.className = 'alert error';
      alert.innerHTML = `
        <i class="fas fa-exclamation-circle"></i>
        <span>${message}</span>
      `;
      document.body.appendChild(alert);
      setTimeout(() => alert.remove(), 3000);
    }
  
    // Funções globais
    window.startBot = async (botId) => {
      currentBotId = botId;
      document.getElementById('statusMessage').innerHTML = `
        <i class="fas fa-sync-alt fa-spin"></i> Preparando conexão...
      `;
      qrModal.classList.add('active');
      
      try {
        const response = await fetch(`/api/bot/${botId}/start`, {
          method: 'POST'
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Falha ao iniciar bot');
        }
      } catch (error) {
        console.error('Erro ao iniciar bot:', error);
        document.getElementById('statusMessage').innerHTML = `
          <i class="fas fa-exclamation-circle" style="color: var(--error)"></i>
          ${error.message}
        `;
      }
    };
  
    window.editBot = async (botId) => {
      currentBotId = botId;
      try {
        const response = await fetch(`/api/bot/${botId}`);
        if (!response.ok) throw new Error('Falha ao carregar bot');
        
        const bot = await response.json();
        
        document.getElementById('modalTitle').textContent = `Editar ${bot.botName || 'Bot'}`;
        document.getElementById('botName').value = bot.botName || '';
        document.getElementById('botIdentity').value = bot.botIdentity || '';
        document.getElementById('botSegment').value = bot.segment || 'geral';
        document.getElementById('startDate').value = bot.startDate ? bot.startDate.substring(0, 16) : '';
        document.getElementById('endDate').value = bot.endDate ? bot.endDate.substring(0, 16) : '';
        
        // Carrega as chaves de API (não mascaradas)
        if (bot.apiKeys) {
          document.getElementById('geminiKey').value = bot.apiKeys.gemini || '';
          document.getElementById('openaiKey').value = bot.apiKeys.openai || '';
        }
        
        botModal.classList.add('active');
      } catch (error) {
        console.error('Erro ao carregar bot:', error);
        showError(error.message);
      }
    };
  
    window.deleteBot = async (botId) => {
      if (!confirm('Tem certeza que deseja excluir este bot? Esta ação não pode ser desfeita.')) {
        return;
      }
      
      try {
        const response = await fetch(`/api/bot/${botId}`, {
          method: 'DELETE'
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Falha ao excluir bot');
        }
        
        showSuccess('Bot excluído com sucesso!');
        loadBots();
      } catch (error) {
        console.error('Erro ao excluir bot:', error);
        showError(error.message);
      }
    };
  
    // Inicialização
    loadBots();
  });