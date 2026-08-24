(() => {
  'use strict';

  const DEFAULT_LIVE_URL = 'https://us06web.zoom.us/j/84674720127';
  const CURITIBA_TZ = 'America/Sao_Paulo';
  const tbody = document.getElementById('usersBody');
  const liveUrl = document.getElementById('liveClassUrl');
  const liveForm = document.getElementById('liveClassForm');
  let lastSessionByEmail = {};

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

  function ensureDefaultLiveUrl() {
    if (liveUrl && !String(liveUrl.value || '').trim()) liveUrl.value = DEFAULT_LIVE_URL;
  }

  function syncUserRows() {
    if (!tbody) return;
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
    });
  }

  async function loadLastSessions() {
    try {
      const backend = window.ShamathaBackend;
      if (!backend?.getClient) return;
      const sb = backend.getClient();
      const { data, error } = await sb.functions.invoke('shamatha-editor-activity', { body: {} });
      if (error || data?.error) return;
      lastSessionByEmail = data?.lastSessionByEmail || {};
      syncUserRows();
    } catch (_) {}
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

  if (tbody) {
    new MutationObserver(syncUserRows).observe(tbody, { childList: true, subtree: true });
  }

  syncUserRows();
  loadLastSessions();
})();
