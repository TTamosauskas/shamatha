(() => {
  'use strict';
  const badge = document.getElementById('liveClassBadge');
  if (!badge || !window.ShamathaBackend?.request) return;
  const text = badge.querySelector('span:last-child');

  function formatWhen(value) {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone:'America/Sao_Paulo', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'
    }).format(new Date(value));
  }

  async function refresh() {
    try {
      const { liveClass } = await window.ShamathaBackend.request('/api/live-class');
      if (!liveClass) return;
      const diff = new Date(liveClass.startsAt).getTime() - Date.now();
      const active = diff <= 30 * 60 * 1000 && diff >= -4 * 60 * 60 * 1000;
      badge.classList.remove('hidden');
      if (text) text.textContent = active ? 'Ao Vivo' : 'Agendada';
      if (active) {
        badge.href = liveClass.url;
        badge.setAttribute('aria-label', 'Abrir aula ao vivo');
      } else {
        badge.removeAttribute('href');
        badge.setAttribute('aria-label', `Aula agendada para ${formatWhen(liveClass.startsAt)} — horário de Curitiba`);
      }
    } catch (_) {}
  }

  setTimeout(refresh, 350);
  setTimeout(refresh, 1500);
  setInterval(refresh, 60000);
})();
