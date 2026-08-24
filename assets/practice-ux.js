(() => {
  'use strict';

  const backend = window.ShamathaBackend;
  if (!backend || typeof backend.request !== 'function') return;

  const state = {
    appData: null,
    progress: null,
    activeStage: null,
    activeSessionNumber: null
  };

  const originalRequest = backend.request.bind(backend);

  function stageState(progress, stage) {
    return progress?.stages?.[stage] || progress?.stages?.[String(stage)] || null;
  }

  function stageConfig(stage) {
    return state.appData?.stages?.[Number(stage) - 1] || null;
  }

  function countedCount(stage) {
    const st = stageState(state.progress, stage);
    const cfg = stageConfig(stage);
    if (!st || !cfg) return 0;
    return Math.min(Number(cfg.sessionsRequired || 0), (st.sessions || []).filter(session => session.countedForProgress).length);
  }

  function nextSessionNumber(stage) {
    const cfg = stageConfig(stage);
    if (!cfg) return 1;
    return Math.max(1, Math.min(Number(cfg.sessionsRequired || 1), countedCount(stage) + 1));
  }

  function markNewestFreeSession(progress) {
    const now = Date.now();
    for (const st of Object.values(progress?.stages || {})) {
      for (const session of st?.sessions || []) {
        const savedAt = Number(session?.savedAt || 0);
        if (
          session?.countedForProgress === false &&
          session?.freeSession !== true &&
          savedAt > 0 &&
          Math.abs(now - savedAt) <= 60000
        ) {
          session.freeSession = true;
        }
      }
    }
    return progress;
  }

  backend.request = async function wrappedRequest(path, options = {}) {
    let nextOptions = options;

    if (path === '/api/progress' && String(options.method || '').toUpperCase() === 'PUT' && typeof options.body === 'string') {
      try {
        const payload = JSON.parse(options.body);
        if (payload?.progress) {
          payload.progress = markNewestFreeSession(payload.progress);
          state.progress = payload.progress;
          nextOptions = { ...options, body: JSON.stringify(payload) };
        }
      } catch (_) {}
    }

    const result = await originalRequest(path, nextOptions);

    if (path === '/api/app-data' && result) {
      state.appData = result;
      state.progress = result.progress;
    }

    return result;
  };

  function parseStageFromToolbar() {
    const toolbar = document.getElementById('toolbarStage');
    const text = String(toolbar?.textContent || '').trim();
    const match = text.match(/^Etapa\s+(\d+)/i);
    if (!match) return null;
    return Number(match[1]);
  }

  function parseSessionCount() {
    const label = document.querySelector('#unitScroll .session-count');
    const text = String(label?.textContent || '').trim();
    const match = text.match(/Sessão\s+(\d+)\s*[·•]\s*etapa\s+(\d+)/i);
    if (!match) return null;
    return { session: Number(match[1]), stage: Number(match[2]) };
  }

  function syncSessionHeader() {
    const toolbar = document.getElementById('toolbarStage');
    if (!toolbar) return;

    const parsedCount = parseSessionCount();
    if (parsedCount) {
      state.activeStage = parsedCount.stage;
      state.activeSessionNumber = parsedCount.session;
    } else {
      const parsedStage = parseStageFromToolbar();
      if (parsedStage) {
        state.activeStage = parsedStage;
        state.activeSessionNumber = nextSessionNumber(parsedStage);
      }
    }

    if (state.activeStage && state.activeSessionNumber) {
      const desired = `Sessão ${state.activeSessionNumber} · etapa ${state.activeStage}`;
      if (toolbar.textContent !== desired) toolbar.textContent = desired;
    }
  }

  function freeSessionCount(stage) {
    const st = stageState(state.progress, stage);
    return (st?.sessions || []).filter(session => session?.freeSession === true).length;
  }

  function syncProgressFacts() {
    const reflection = document.querySelector('#unitScroll .reflection');
    const saveArea = document.getElementById('saveArea');
    const firstFact = saveArea?.querySelector('.progress-facts > span:first-child');
    if (!reflection || !saveArea || !saveArea.children.length || !firstFact) return;

    reflection.classList.add('session-saved');

    const stage = state.activeStage;
    const cfg = stageConfig(stage);
    if (!stage || !cfg) return;

    const count = countedCount(stage);
    const required = Number(cfg.sessionsRequired || 0);
    const free = freeSessionCount(stage);

    if (free > 0) {
      const freeLabel = free === 1 ? 'sessão livre' : 'sessões livres';
      firstFact.innerHTML = `<strong>${count} de ${required}</strong> sessões diárias concluídas e <strong>${free}</strong> ${freeLabel}.`;
    }
  }

  function showPresenceError(range) {
    const field = range?.closest('.field');
    if (!field) return;
    field.classList.add('presence-invalid');
    let error = field.querySelector('.presence-error');
    if (!error) {
      error = document.createElement('div');
      error.className = 'presence-error';
      error.setAttribute('role', 'alert');
      error.textContent = 'Escolha um valor em Presença percebida antes de salvar.';
      field.appendChild(error);
    }
    range.focus();
  }

  function clearPresenceError(range) {
    const field = range?.closest('.field');
    field?.classList.remove('presence-invalid');
    field?.querySelector('.presence-error')?.remove();
  }

  function closePracticeWindow() {
    const modal = document.getElementById('unitModal');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    const scroll = document.getElementById('unitScroll');
    if (scroll) scroll.scrollTop = 0;
  }

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const saveButton = target?.closest('#saveSession');
    if (saveButton) {
      const range = document.getElementById('lucidity');
      if (range && range.dataset.chosen !== 'true') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        showPresenceError(range);
        return;
      }
      clearPresenceError(range);
    }
  }, true);

  document.addEventListener('input', event => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.id === 'lucidity') clearPresenceError(target);
  });

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('#shareWhatsapp')) {
      setTimeout(closePracticeWindow, 0);
    }
  });

  const scroll = document.getElementById('unitScroll');
  const toolbar = document.getElementById('toolbarStage');

  const sync = () => {
    syncSessionHeader();
    syncProgressFacts();
  };

  if (scroll) new MutationObserver(sync).observe(scroll, { childList: true, subtree: true });
  if (toolbar) new MutationObserver(syncSessionHeader).observe(toolbar, { childList: true, subtree: true, characterData: true });

  sync();
})();
