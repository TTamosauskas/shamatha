(() => {
  'use strict';
  const api = (path, options = {}) => window.ShamathaBackend.request(path, options);
  const PROMPT_KEY = 'shamathaPushPromptAfter';

  function b64urlToUint8(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(ch => ch.charCodeAt(0)));
  }

  async function registerWorker() {
    return navigator.serviceWorker.register('./service-worker.js', { scope:'./' });
  }

  async function persistSubscription(subscription) {
    const json = subscription.toJSON();
    await api('/api/push/subscribe', {
      method:'POST',
      body:JSON.stringify({ subscription:json, userAgent:navigator.userAgent })
    });
  }

  async function subscribe(registration) {
    const config = await api('/api/push/config');
    if (!config.publicKey) throw new Error('As notificações ainda estão sendo configuradas.');
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:b64urlToUint8(config.publicKey)
      });
    }
    await persistSubscription(subscription);
    return subscription;
  }

  function dismissPrompt(days = 7) {
    localStorage.setItem(PROMPT_KEY, String(Date.now() + days * 86400000));
    document.getElementById('pushPermissionPrompt')?.remove();
  }

  function promptAllowedNow() {
    return Date.now() >= Number(localStorage.getItem(PROMPT_KEY) || 0);
  }

  function showPrompt(registration) {
    if (document.getElementById('pushPermissionPrompt')) return;
    const box = document.createElement('section');
    box.id = 'pushPermissionPrompt';
    box.className = 'push-permission-card';
    box.innerHTML = `<div><strong>Receber avisos das aulas ao vivo?</strong><p>Este aparelho pode avisar quando uma aula for agendada e 30 minutos antes do início.</p></div><div class="push-permission-actions"><button class="primary" id="enablePush" type="button">Ativar notificações</button><button class="ghost" id="laterPush" type="button">Agora não</button></div><div class="push-permission-status hidden" id="pushPermissionStatus"></div>`;
    document.body.appendChild(box);
    box.querySelector('#laterPush').addEventListener('click', () => dismissPrompt(7));
    box.querySelector('#enablePush').addEventListener('click', async event => {
      const button = event.currentTarget;
      const status = box.querySelector('#pushPermissionStatus');
      button.disabled = true;
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          status.textContent = 'As notificações ficaram desativadas neste navegador.';
          status.className = 'push-permission-status';
          dismissPrompt(30);
          return;
        }
        await subscribe(registration);
        status.textContent = 'Notificações ativadas neste aparelho.';
        status.className = 'push-permission-status good';
        localStorage.removeItem(PROMPT_KEY);
        setTimeout(() => box.remove(), 1200);
      } catch (error) {
        status.textContent = error.message || 'Falha ao ativar notificações.';
        status.className = 'push-permission-status bad';
        button.disabled = false;
      }
    });
  }

  (async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    const me = await api('/api/me').catch(() => null);
    if (!me?.user || !(me.user.accessStatus === 'approved' || me.user.accessGranted)) return;
    const registration = await registerWorker();
    if (Notification.permission === 'granted') {
      await subscribe(registration).catch(() => null);
      return;
    }
    if (Notification.permission === 'default' && promptAllowedNow()) {
      setTimeout(() => showPrompt(registration), 700);
    }
  })();
})();
