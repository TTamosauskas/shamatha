(() => {
  'use strict';
  const badge = document.getElementById('liveClassBadge');
  if (!badge || !window.ShamathaBackend?.request) return;
  const text = badge.querySelector('span:last-child');
  const parent = badge.parentElement;
  const scheduleText = document.createElement('div');
  scheduleText.className = 'live-class-schedule-text hidden';
  parent?.insertBefore(scheduleText, badge);

  function formatWhen(value) {
    const parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone:'America/Sao_Paulo', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'
    }).formatToParts(new Date(value));
    const map = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return `${map.day}/${map.month}, ${map.hour}:${map.minute}`;
  }

  function hideAll() {
    badge.classList.add('hidden');
    badge.removeAttribute('href');
    scheduleText.classList.add('hidden');
    scheduleText.textContent = '';
  }

  async function refresh() {
    try {
      const { liveClass } = await window.ShamathaBackend.request('/api/live-class');
      if (!liveClass) { hideAll(); return; }
      const diff = new Date(liveClass.startsAt).getTime() - Date.now();
      const active = diff <= 0 && diff >= -30 * 60 * 1000;
      const scheduled = diff > 0;

      if (active) {
        scheduleText.classList.add('hidden');
        badge.classList.remove('hidden');
        if (text) text.textContent = 'Aula Ao Vivo';
        badge.href = liveClass.url;
        badge.setAttribute('aria-label', 'Abrir aula ao vivo');
        return;
      }

      badge.classList.add('hidden');
      badge.removeAttribute('href');
      if (scheduled) {
        scheduleText.textContent = `Aula ao vivo: ${formatWhen(liveClass.startsAt)}`;
        scheduleText.classList.remove('hidden');
      } else {
        scheduleText.classList.add('hidden');
      }
    } catch (_) { hideAll(); }
  }

  setTimeout(refresh, 350);
  setTimeout(refresh, 1500);
  setInterval(refresh, 30000);
})();
