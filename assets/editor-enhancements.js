(() => {
  'use strict';

  const DEFAULT_LIVE_URL = 'https://us06web.zoom.us/j/84674720127';
  const CURITIBA_TZ = 'America/Sao_Paulo';
  const tbody = document.getElementById('usersBody');
  const liveUrl = document.getElementById('liveClassUrl');
  const liveForm = document.getElementById('liveClassForm');
  const inviteForm = document.getElementById('inviteForm');
  const accessStatus = document.getElementById('accessStatus');
  let lastSessionByEmail = {};
  let confirmedByEmail = {};
  let syncing = false;

  function formatLastSession(value) {
    if (!value) return 'Nenhuma';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Nenhuma';
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: CURITIBA_TZ,
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function setAccessMessage(message, kind = 'good') {
    if (!accessStatus) return;
    accessStatus.textContent = message;
    accessStatus.className = `status ${kind}`;
  }

  function ensureDefaultLiveUrl() {
    if (liveUrl && !String(liveUrl.value || '').trim()) liveUrl.value = DEFAULT_LIVE_URL;
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('Não foi possível copiar automaticamente.');
  }

  function inviteButton(email) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'invite-link-copy';
    button.dataset.email = email;
    button.textContent = '✉️';
    button.title = 'Copiar link de convite';
    button.setAttribute('aria-label', `Copiar link de convite para ${email}`);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const backend = window.ShamathaBackend;
        if (!backend?.getClient) throw new Error('Serviço indisponível.');
        const sb = backend.getClient();
        const { data, error } = await sb.functions.invoke('shamatha-ops', {
          body: { action: 'generate_invite_link', email }
        });
        if (error) {
          let message = error.message || 'Falha ao gerar o convite.';
          try {
            const payload = await error.context?.json?.();
            if (payload?.error) message = payload.error;
          } catch (_) {}
          throw new Error(message);
        }
        if (data?.error) throw new Error(data.error);
        if (!data?.link) throw new Error('O serviço não retornou o link do convite.');
        await copyText(data.link);
        setAccessMessage(`Link de convite de ${email} copiado para a área de transferência.`);
      } catch (error) {
        setAccessMessage(error?.message || 'Falha ao copiar o link do convite.', 'bad');
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  function syncUserRows() {
    if (!tbody || syncing) return;
    syncing = true;
    try {
      tbody.querySelectorAll('tr').forEach(row => {
        const emailCell = row.querySelector('.user-email-cell');
        if (!emailCell) {
          const only = row.querySelector('td[colspan]');
          if (only && only.getAttribute('colspan') !== '5') only.setAttribute('colspan', '5');
          return;
        }

        const email = String(emailCell.textContent || '').trim().toLowerCase();
        let activityCell = row.querySelector('.user-last-session-cell');
        if (!activityCell) {
          activityCell = document.createElement('td');
          activityCell.className = 'user-last-session-cell';
          emailCell.insertAdjacentElement('afterend', activityCell);
        }
        const display = formatLastSession(lastSessionByEmail[email]);
        if (activityCell.textContent !== display) activityCell.textContent = display;

        row.querySelectorAll('.badge.owner').forEach(badge => {
          if (badge.textContent !== 'Desenvolvedor') badge.textContent = 'Desenvolvedor';
        });

        const actionsCell = row.querySelector('.user-actions-cell');
        if (actionsCell) {
          const shouldShowInvite = confirmedByEmail[email] === false;
          let button = actionsCell.querySelector('.invite-link-copy');
          if (shouldShowInvite && !button) {
            button = inviteButton(email);
            actionsCell.insertBefore(button, actionsCell.firstChild);
          } else if (!shouldShowInvite && button) {
            button.remove();
          }
        }
      });
    } finally {
      syncing = false;
    }
  }

  async function loadActivity() {
    try {
      const backend = window.ShamathaBackend;
      if (!backend?.getClient) return;
      const sb = backend.getClient();
      const { data, error } = await sb.functions.invoke('shamatha-editor-activity', { body: {} });
      if (error || data?.error) return;
      lastSessionByEmail = data?.lastSessionByEmail || {};
      confirmedByEmail = data?.confirmedByEmail || {};
      syncUserRows();
    } catch (_) {}
  }

  function normalizeInviteSuccessMessage() {
    if (!accessStatus) return;
    const text = String(accessStatus.textContent || '');
    const match = text.match(/^Convite enviado para (.+?)\. Novo usuário criado/);
    if (!match) return;
    setAccessMessage(`Usuário ${match[1]} adicionado como Aluno e Pendente. Use ✉️ para copiar o link de convite.`);
  }

  ensureDefaultLiveUrl();

  if (liveForm) {
    liveForm.addEventListener('submit', () => {
      const button = liveForm.querySelector('button[type="submit"]');
      const started = Date.now();
      const timer = setInterval(() => {
        if (Date.now() - started > 15000) {
          clearInterval(timer);
          return;
        }
        if (button && !button.disabled) {
          clearInterval(timer);
          ensureDefaultLiveUrl();
        }
      }, 120);
    });
  }

  if (inviteForm) {
    inviteForm.addEventListener('submit', () => {
      const button = inviteForm.querySelector('button[type="submit"]');
      const started = Date.now();
      const timer = setInterval(() => {
        if (Date.now() - started > 15000) {
          clearInterval(timer);
          return;
        }
        if (button && !button.disabled) {
          clearInterval(timer);
          normalizeInviteSuccessMessage();
          loadActivity();
        }
      }, 120);
    });
  }

  if (accessStatus) {
    new MutationObserver(normalizeInviteSuccessMessage).observe(accessStatus, { childList: true, characterData: true, subtree: true });
  }

  if (tbody) {
    new MutationObserver(syncUserRows).observe(tbody, { childList: true, subtree: true });
  }

  syncUserRows();
  loadActivity();
  setInterval(loadActivity, 60000);
})();
