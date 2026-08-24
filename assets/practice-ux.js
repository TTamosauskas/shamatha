(() => {
  'use strict';

  const backend = window.ShamathaBackend;
  if (!backend || typeof backend.request !== 'function') return;

  const state = { appData:null, progress:null, activeStage:null };
  const originalRequest = backend.request.bind(backend);

  function stageState(progress, stage) {
    return progress?.stages?.[stage] || progress?.stages?.[String(stage)] || null;
  }

  function stageConfig(stage) {
    return state.appData?.stages?.[Number(stage) - 1] || null;
  }

  function localDateKey(value) {
    const d = value instanceof Date ? value : new Date(value);
    return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  }

  function sessionTime(session) {
    for (const value of [session?.startedAt, session?.savedAt, session?.endedAt]) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) return numeric;
      const parsed = new Date(value).getTime();
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
  }

  function inWindow(session, stage) {
    const cfg = stageConfig(stage);
    if (!cfg) return false;
    const days = Math.max(1, Number(cfg.deadlineDays || 1));
    const start = new Date();
    start.setHours(0,0,0,0);
    start.setDate(start.getDate() - (days - 1));
    const key = /^\d{4}-\d{2}-\d{2}$/.test(String(session?.dateKey || '')) ? session.dateKey : (sessionTime(session) ? localDateKey(sessionTime(session)) : '');
    return Boolean(key && key >= localDateKey(start));
  }

  function countedCount(stage) {
    const st = stageState(state.progress, stage);
    const cfg = stageConfig(stage);
    if (!st || !cfg) return 0;
    return Math.min(Number(cfg.sessionsRequired || 0), (st.sessions || []).filter(session => session.countedForProgress && inWindow(session, stage)).length);
  }

  function markNewestFreeSession(progress) {
    const now = Date.now();
    for (const st of Object.values(progress?.stages || {})) {
      for (const session of st?.sessions || []) {
        const savedAt = Number(session?.savedAt || 0);
        if (session?.countedForProgress === false && session?.freeSession !== true && savedAt > 0 && Math.abs(now - savedAt) <= 60000) {
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
          nextOptions = { ...options, body:JSON.stringify(payload) };
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
    const text = String(document.getElementById('toolbarStage')?.textContent || '').trim();
    const match = text.match(/^Etapa\s+(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  function parseStageFromSessionLabel() {
    const text = String(document.querySelector('#unitScroll .session-count')?.textContent || '').trim();
    const match = text.match(/Sessão\s+\d+\s*[·•]\s*etapa\s+(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  function syncPracticeHeader() {
    const toolbar = document.getElementById('toolbarStage');
    if (!toolbar) return;
    const stage = parseStageFromSessionLabel() || parseStageFromToolbar() || state.activeStage;
    if (!stage) return;
    state.activeStage = stage;
    const cfg = stageConfig(stage);
    if (!cfg) return;
    const desired = `Etapa ${stage} — ${cfg.unitName}`;
    if (toolbar.textContent !== desired) toolbar.textContent = desired;
  }

  function freeSessionCount(stage) {
    const st = stageState(state.progress, stage);
    return (st?.sessions || []).filter(session => session?.freeSession === true && inWindow(session, stage)).length;
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
    const days = Number(cfg.deadlineDays || 0);
    const free = freeSessionCount(stage);
    const base = `<strong>${count} de ${required}</strong> sessões válidas nos últimos ${days} dias`;
    if (free > 0) {
      const freeLabel = free === 1 ? 'sessão livre' : 'sessões livres';
      firstFact.innerHTML = `${base} e <strong>${free}</strong> ${freeLabel}.`;
    } else {
      firstFact.innerHTML = `${base}.`;
    }
  }

  function showPresenceError(range) {
    const field = range?.closest('.field');
    if (!field) return;
    field.classList.add('presence-invalid');
    const value = field.querySelector('.lucidity-value');
    if (value) value.textContent = 'Escolha um valor';
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
    if (target?.closest('#saveSession')) {
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
    if (target?.closest('#shareWhatsapp')) setTimeout(closePracticeWindow, 0);
  }, true);

  const scroll = document.getElementById('unitScroll');
  const toolbar = document.getElementById('toolbarStage');
  const sync = () => { syncPracticeHeader(); syncProgressFacts(); };
  if (scroll) new MutationObserver(sync).observe(scroll, { childList:true, subtree:true });
  if (toolbar) new MutationObserver(syncPracticeHeader).observe(toolbar, { childList:true, subtree:true, characterData:true });
  sync();
})();
