(() => {
  'use strict';

  const api = (path, options = {}) => window.ShamathaBackend.request(path, options);
  const PROMPT_KEY = 'shamathaOnboardingPromptAfter';
  const DONE_KEY = 'shamathaOnboardingDone';
  const DEFAULT_TIME = '20:00';
  const DEFAULT_TZ = 'America/Sao_Paulo';
  let deferredInstallPrompt = null;
  let activeRegistration = null;
  let activeMode = null;
  let reminderState = { enabled:false, localTime:DEFAULT_TIME, timezone:DEFAULT_TZ };

  function b64urlToUint8(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(ch => ch.charCodeAt(0)));
  }

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function timezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ; }
    catch (_) { return DEFAULT_TZ; }
  }

  function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function promptAllowedNow() {
    return Date.now() >= Number(localStorage.getItem(PROMPT_KEY) || 0);
  }

  function closeCard() {
    document.getElementById('pushPermissionPrompt')?.remove();
    activeMode = null;
  }

  function deferOnboarding(days = 7) {
    localStorage.setItem(PROMPT_KEY, String(Date.now() + days * 86400000));
    closeCard();
  }

  function finishOnboarding() {
    localStorage.setItem(DONE_KEY, '1');
    localStorage.removeItem(PROMPT_KEY);
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

  async function invokeReminder(action, extra = {}) {
    const backend = window.ShamathaBackend;
    if (!backend?.getClient) throw new Error('Serviço de lembretes indisponível.');
    const sb = backend.getClient();
    const result = await sb.functions.invoke('shamatha-reminders', { body:{ action, ...extra } });
    if (result.error) {
      let message = result.error.message || 'Falha no serviço de lembretes.';
      try {
        const payload = await result.error.context?.json?.();
        if (payload?.error) message = payload.error;
      } catch (_) {}
      throw new Error(message);
    }
    if (result.data?.error) throw new Error(result.data.error);
    return result.data || {};
  }

  async function loadReminder() {
    const data = await invokeReminder('get');
    reminderState = {
      enabled:Boolean(data.reminder?.enabled),
      localTime:String(data.reminder?.localTime || DEFAULT_TIME).slice(0, 5),
      timezone:String(data.reminder?.timezone || timezone())
    };
    return reminderState;
  }

  async function saveReminder(enabled, localTime) {
    const data = await invokeReminder('save', {
      enabled:Boolean(enabled),
      localTime:String(localTime || DEFAULT_TIME),
      timezone:timezone()
    });
    reminderState = {
      enabled:Boolean(data.reminder?.enabled),
      localTime:String(data.reminder?.localTime || localTime || DEFAULT_TIME).slice(0, 5),
      timezone:String(data.reminder?.timezone || timezone())
    };
    return reminderState;
  }

  function card() {
    let box = document.getElementById('pushPermissionPrompt');
    if (!box) {
      box = document.createElement('section');
      box.id = 'pushPermissionPrompt';
      box.className = 'push-permission-card onboarding-card';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      document.body.appendChild(box);
    }
    return box;
  }

  function statusNode(box, message, kind = '') {
    const status = box.querySelector('#pushPermissionStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `push-permission-status${kind ? ` ${kind}` : ''}`;
  }

  function showIOSInstall() {
    activeMode = 'onboarding';
    const box = card();
    box.innerHTML = `<div class="onboarding-step"><span class="onboarding-kicker">1 de 3 · Instalar</span><strong>Adicione o Centro Pineal à Tela de Início</strong><p>No iPhone ou iPad, abra este site no Safari, toque em <b>Compartilhar</b> e escolha <b>Adicionar à Tela de Início</b>. Depois abra o Centro Pineal pelo novo ícone para continuar com as notificações.</p></div><div class="push-permission-actions"><button class="primary" id="iosInstallUnderstood" type="button">Entendi</button><button class="ghost" id="laterPush" type="button">Agora não</button></div>`;
    box.querySelector('#iosInstallUnderstood').addEventListener('click', closeCard);
    box.querySelector('#laterPush').addEventListener('click', () => deferOnboarding(7));
  }

  function showInstallStep() {
    if (isStandalone()) return showPushStep();
    if (isIOS()) return showIOSInstall();
    if (!deferredInstallPrompt) return showPushStep();

    activeMode = 'onboarding';
    const box = card();
    box.innerHTML = `<div class="onboarding-step"><span class="onboarding-kicker">1 de 3 · Instalar</span><strong>Adicione o Centro Pineal ao seu aparelho</strong><p>Assim você abre sua prática como um app, direto pela tela inicial.</p></div><div class="push-permission-actions"><button class="primary" id="installApp" type="button">Adicionar à tela inicial</button><button class="ghost" id="laterPush" type="button">Agora não</button></div><div class="push-permission-status hidden" id="pushPermissionStatus"></div>`;
    box.querySelector('#laterPush').addEventListener('click', () => deferOnboarding(7));
    box.querySelector('#installApp').addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const prompt = deferredInstallPrompt;
        if (!prompt) return showPushStep();
        await prompt.prompt();
        const choice = await prompt.userChoice;
        deferredInstallPrompt = null;
        if (choice?.outcome === 'accepted') showPushStep();
        else {
          statusNode(box, 'A instalação foi cancelada. Você pode tentar novamente depois.');
          button.disabled = false;
        }
      } catch (_) {
        statusNode(box, 'Não foi possível abrir a instalação neste navegador.', 'bad');
        button.disabled = false;
      }
    });
  }

  async function showPushStep() {
    activeMode = 'onboarding';
    const box = card();
    if (!pushSupported()) {
      box.innerHTML = `<div class="onboarding-step"><span class="onboarding-kicker">2 de 3 · Notificações</span><strong>Notificações não disponíveis</strong><p>Este navegador não oferece Web Push para o Centro Pineal. Você ainda pode usar o app normalmente.</p></div><div class="push-permission-actions"><button class="primary" id="closeUnsupported" type="button">Continuar</button></div>`;
      box.querySelector('#closeUnsupported').addEventListener('click', () => { finishOnboarding(); closeCard(); });
      return;
    }

    if (Notification.permission === 'granted') {
      try { await subscribe(activeRegistration); }
      catch (_) {}
      return showReminderStep();
    }

    if (Notification.permission === 'denied') {
      box.innerHTML = `<div class="onboarding-step"><span class="onboarding-kicker">2 de 3 · Notificações</span><strong>Notificações estão bloqueadas</strong><p>Para receber avisos de aulas e lembretes de meditação, libere as notificações nas configurações do navegador ou do aparelho.</p></div><div class="push-permission-actions"><button class="primary" id="finishBlocked" type="button">Concluir</button></div>`;
      box.querySelector('#finishBlocked').addEventListener('click', () => { finishOnboarding(); closeCard(); });
      return;
    }

    box.innerHTML = `<div class="onboarding-step"><span class="onboarding-kicker">2 de 3 · Notificações</span><strong>Ative os avisos do Centro Pineal</strong><p>Você receberá avisos das aulas ao vivo e poderá escolher um horário diário para lembrar de meditar.</p></div><div class="push-permission-actions"><button class="primary" id="enablePush" type="button">Ativar notificações</button><button class="ghost" id="laterPush" type="button">Agora não</button></div><div class="push-permission-status hidden" id="pushPermissionStatus"></div>`;
    box.querySelector('#laterPush').addEventListener('click', () => deferOnboarding(7));
    box.querySelector('#enablePush').addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          statusNode(box, 'As notificações ficaram desativadas neste navegador.');
          button.disabled = false;
          return;
        }
        await subscribe(activeRegistration);
        showReminderStep();
      } catch (error) {
        statusNode(box, error.message || 'Falha ao ativar notificações.', 'bad');
        button.disabled = false;
      }
    });
  }

  function showReminderStep() {
    activeMode = 'onboarding';
    const box = card();
    const time = reminderState.localTime || DEFAULT_TIME;
    box.innerHTML = `<div class="onboarding-step"><span class="onboarding-kicker">3 de 3 · Lembrete diário</span><strong>Que horas você gostaria de lembrar de meditar?</strong><p>O horário será salvo no seu fuso atual e pode ser alterado depois pelo botão Lembrete.</p></div><label class="reminder-time-field"><span>Horário</span><input id="dailyReminderTime" type="time" value="${time}" required></label><div class="push-permission-actions"><button class="primary" id="saveDailyReminder" type="button">Ativar lembrete diário</button><button class="ghost" id="skipDailyReminder" type="button">Agora não</button></div><div class="push-permission-status hidden" id="pushPermissionStatus"></div>`;
    box.querySelector('#skipDailyReminder').addEventListener('click', () => { finishOnboarding(); closeCard(); });
    box.querySelector('#saveDailyReminder').addEventListener('click', async event => {
      const button = event.currentTarget;
      const input = box.querySelector('#dailyReminderTime');
      button.disabled = true;
      try {
        await saveReminder(true, input.value);
        statusNode(box, `Lembrete diário ativado para ${reminderState.localTime}.`, 'good');
        finishOnboarding();
        setTimeout(closeCard, 1000);
      } catch (error) {
        statusNode(box, error.message || 'Falha ao salvar o lembrete.', 'bad');
        button.disabled = false;
      }
    });
  }

  function renderSettings() {
    activeMode = 'settings';
    const box = card();
    const permission = pushSupported() ? Notification.permission : 'unsupported';
    const installHint = !isStandalone() && isIOS()
      ? `<div class="settings-note"><strong>Instalação no iPhone/iPad</strong><p>No Safari: Compartilhar → Adicionar à Tela de Início. O Web Push no iOS funciona quando o Centro Pineal é aberto pelo ícone instalado.</p></div>`
      : (!isStandalone() && deferredInstallPrompt ? `<button class="ghost install-inline" id="settingsInstall" type="button">Adicionar à tela inicial</button>` : '');
    const permissionCopy = permission === 'granted' ? 'Notificações ativadas neste aparelho.' : permission === 'denied' ? 'Notificações bloqueadas neste navegador.' : permission === 'default' ? 'Notificações ainda não foram ativadas.' : 'Notificações não disponíveis neste navegador.';
    const canReminder = permission === 'granted';

    box.innerHTML = `<div class="onboarding-step"><span class="onboarding-kicker">Preferências</span><strong>Notificações e lembrete</strong><p>${permissionCopy}</p></div>${installHint}${permission === 'default' ? '<button class="primary settings-enable-push" id="settingsEnablePush" type="button">Ativar notificações</button>' : ''}<label class="reminder-toggle"><input id="dailyReminderEnabled" type="checkbox" ${reminderState.enabled ? 'checked' : ''} ${canReminder ? '' : 'disabled'}><span>Lembrete diário de meditação</span></label><label class="reminder-time-field"><span>Horário</span><input id="dailyReminderTime" type="time" value="${reminderState.localTime || DEFAULT_TIME}" ${canReminder ? '' : 'disabled'}></label><div class="push-permission-actions"><button class="primary" id="saveReminderSettings" type="button" ${canReminder ? '' : 'disabled'}>Salvar</button><button class="ghost" id="closeReminderSettings" type="button">Fechar</button></div><div class="push-permission-status hidden" id="pushPermissionStatus"></div>`;

    box.querySelector('#closeReminderSettings').addEventListener('click', closeCard);
    box.querySelector('#settingsInstall')?.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      await deferredInstallPrompt.prompt().catch(() => null);
      await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      renderSettings();
    });
    box.querySelector('#settingsEnablePush')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const permissionResult = await Notification.requestPermission();
        if (permissionResult === 'granted') await subscribe(activeRegistration);
        renderSettings();
      } catch (error) {
        statusNode(box, error.message || 'Falha ao ativar notificações.', 'bad');
        button.disabled = false;
      }
    });
    box.querySelector('#saveReminderSettings').addEventListener('click', async event => {
      const button = event.currentTarget;
      const enabled = box.querySelector('#dailyReminderEnabled').checked;
      const time = box.querySelector('#dailyReminderTime').value;
      button.disabled = true;
      try {
        await saveReminder(enabled, time);
        statusNode(box, enabled ? `Lembrete diário salvo para ${reminderState.localTime}.` : 'Lembrete diário desativado.', 'good');
        setTimeout(closeCard, 900);
      } catch (error) {
        statusNode(box, error.message || 'Falha ao salvar o lembrete.', 'bad');
        button.disabled = false;
      }
    });
  }

  function ensureSettingsButton() {
    const homeActions = document.querySelector('.home-actions');
    if (!homeActions || document.getElementById('reminderSettingsButton')) return;
    const button = document.createElement('button');
    button.id = 'reminderSettingsButton';
    button.className = 'reminder-settings-button';
    button.type = 'button';
    button.textContent = 'Lembrete';
    button.setAttribute('aria-label', 'Configurar notificações e lembrete diário');
    button.addEventListener('click', async () => {
      try { await loadReminder(); } catch (_) {}
      renderSettings();
    });
    homeActions.appendChild(button);
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (activeMode === 'onboarding' && !isStandalone() && !isIOS()) showInstallStep();
    if (activeMode === 'settings') renderSettings();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (activeMode === 'onboarding') showPushStep();
    if (activeMode === 'settings') renderSettings();
  });

  (async () => {
    const me = await api('/api/me').catch(() => null);
    if (!me?.user || !(me.user.accessStatus === 'approved' || me.user.accessGranted)) return;

    ensureSettingsButton();
    if ('serviceWorker' in navigator) activeRegistration = await registerWorker().catch(() => null);
    await loadReminder().catch(() => null);

    if (pushSupported() && activeRegistration && Notification.permission === 'granted') {
      await subscribe(activeRegistration).catch(() => null);
    }

    if (localStorage.getItem(DONE_KEY) === '1' || !promptAllowedNow()) return;
    setTimeout(() => {
      if (!isStandalone() && (isIOS() || deferredInstallPrompt)) showInstallStep();
      else showPushStep();
    }, 1200);
  })();
})();
