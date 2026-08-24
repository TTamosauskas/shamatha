(() => {
  'use strict';

  function placeReminderBell() {
    const status = document.getElementById('homeStatus');
    const button = document.getElementById('reminderSettingsButton');
    if (!status || !button) return false;

    let row = status.closest('.home-status-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'home-status-row';
      status.parentElement?.insertBefore(row, status);
      row.appendChild(status);
    }

    button.textContent = '🔔';
    button.title = 'Configurar notificações e lembrete diário';
    button.setAttribute('aria-label', 'Configurar notificações e lembrete diário');
    if (button.parentElement !== row) row.appendChild(button);
    return true;
  }

  if (!placeReminderBell()) {
    const observer = new MutationObserver(() => {
      if (placeReminderBell()) observer.disconnect();
    });
    observer.observe(document.body, { childList:true, subtree:true });
  }
})();
