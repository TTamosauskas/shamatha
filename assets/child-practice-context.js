(() => {
  'use strict';

  const backend = window.ShamathaBackend;
  const modal = document.getElementById('unitModal');
  const scroll = document.getElementById('unitScroll');
  if (!backend?.request || !modal || !scroll) return;

  const originalRequest = backend.request.bind(backend);
  const dataRefs = new Set();
  const knownSessionIds = new Set();
  const originals = new Map();
  const introOriginals = new Map();
  let latestData = null;
  let active = null;
  let patchFrame = null;

  function rememberSessionIds(progress) {
    for (const state of Object.values(progress?.stages || {})) {
      for (const session of state?.sessions || []) {
        if (session?.id) knownSessionIds.add(String(session.id));
      }
    }
  }

  function childFromData(data, stageId) {
    return (data?.childStages || []).find(child => String(child.stageId) === String(stageId)) || null;
  }

  function proxyStage(parent, child) {
    return {
      ...parent,
      stageName: child.stageName || parent.stageName || 'Aula de apoio',
      unitName: child.unitName || parent.unitName || 'Aula de apoio',
      objective: child.objective || '',
      videoUrl: child.videoUrl || '',
      audioUrl: child.audioUrl || '',
      childPractice: true,
      childStageId: child.stageId,
      childDisplayCode: child.displayCode
    };
  }

  function applyContextToData(data) {
    if (!active || !data?.stages?.length) return;
    const index = active.parentPosition - 1;
    const parent = data.stages[index];
    if (!parent) return;

    if (!originals.has(data)) originals.set(data, parent);
    if (!introOriginals.has(data)) {
      const state = data.progress?.stages?.[active.parentPosition];
      introOriginals.set(data, state ? {
        introStarted: state.introStarted,
        introDone: state.introDone
      } : null);
    }

    const freshChild = childFromData(data, active.child.stageId) || active.child;
    data.stages[index] = proxyStage(parent, freshChild);
  }

  function restoreIntroFlags() {
    if (!active) return;
    for (const [data, original] of introOriginals.entries()) {
      if (!original) continue;
      const state = data?.progress?.stages?.[active.parentPosition];
      if (!state) continue;
      state.introStarted = original.introStarted;
      state.introDone = original.introDone;
    }
  }

  function restoreContext({ refreshHome = true } = {}) {
    if (!active) return;
    for (const [data, original] of originals.entries()) {
      const index = active.parentPosition - 1;
      if (data?.stages?.[index]) data.stages[index] = original;
    }
    restoreIntroFlags();
    active = null;
    originals.clear();
    introOriginals.clear();
    document.dispatchEvent(new CustomEvent('shamatha:child-context-changed', { detail:{ active:false } }));
    if (refreshHome) setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
  }

  function captureData(data) {
    if (!data || typeof data !== 'object') return data;
    latestData = data;
    dataRefs.add(data);
    rememberSessionIds(data.progress);
    if (active) applyContextToData(data);
    return data;
  }

  function syncSessionMetadata(payload) {
    const progress = payload?.progress;
    if (!progress?.stages) return payload;

    for (const [stageKey, state] of Object.entries(progress.stages)) {
      for (const session of state?.sessions || []) {
        if (!session?.id) continue;
        const id = String(session.id);
        if (knownSessionIds.has(id)) continue;

        if (!session.sourceType) {
          if (active && Number(stageKey) === active.parentPosition) {
            session.sourceType = 'child';
            session.childStageId = active.child.stageId;
            session.childDisplayCode = active.child.displayCode;
          } else {
            session.sourceType = 'root';
          }
        }

        for (const data of dataRefs) {
          const local = data?.progress?.stages?.[stageKey]?.sessions?.find(item => String(item?.id || '') === id);
          if (local) {
            local.sourceType = session.sourceType;
            if (session.childStageId) local.childStageId = session.childStageId;
            if (session.childDisplayCode) local.childDisplayCode = session.childDisplayCode;
          }
        }
        knownSessionIds.add(id);
      }
    }
    return payload;
  }

  backend.request = async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();

    if (path === '/api/app-data' && method === 'GET') {
      return captureData(await originalRequest(path, options));
    }

    if (path === '/api/progress' && method === 'PUT' && options.body) {
      let parsed = options.body;
      let wasString = false;
      if (typeof parsed === 'string') {
        wasString = true;
        try { parsed = JSON.parse(parsed); } catch (_) { parsed = null; }
      }
      if (parsed && typeof parsed === 'object') {
        syncSessionMetadata(parsed);
        options = { ...options, body: wasString ? JSON.stringify(parsed) : parsed };
      }
    }

    return originalRequest(path, options);
  };

  function schedulePatch() {
    if (!active || patchFrame != null) return;
    patchFrame = requestAnimationFrame(() => {
      patchFrame = null;
      patchLabels();
    });
  }

  function patchLabels() {
    if (!active) return;
    const code = active.child.displayCode;
    const toolbar = document.getElementById('toolbarStage');
    const title = document.getElementById('modalTitle');
    const eyebrow = scroll.querySelector('.unit-heading .eyebrow');
    const sessionCount = scroll.querySelector('.session-count');

    const toolbarText = `Etapa ${code} — ${active.child.stageName || 'Aula de apoio'}`;
    if (toolbar && toolbar.textContent !== toolbarText) toolbar.textContent = toolbarText;
    if (title && title.textContent !== (active.child.unitName || 'Aula de apoio')) title.textContent = active.child.unitName || 'Aula de apoio';
    if (eyebrow && /^Etapa\s+/i.test(eyebrow.textContent || '')) eyebrow.textContent = `Etapa ${code}`;
    if (sessionCount) {
      const next = String(sessionCount.textContent || '').replace(/etapa\s+\d+(?:\.\d+)?/i, `etapa ${code}`);
      if (next !== sessionCount.textContent) sessionCount.textContent = next;
    }
  }

  function openChild(child) {
    if (!child?.unlocked) return;
    if (active) restoreContext({ refreshHome:false });

    const parentPosition = Math.max(1, Number(child.parentPosition || 1));
    active = { child, parentPosition };
    for (const data of dataRefs) applyContextToData(data);
    document.dispatchEvent(new CustomEvent('shamatha:child-context-changed', {
      detail:{ active:true, stageId:child.stageId, parentPosition, displayCode:child.displayCode }
    }));

    const parentButton = document.querySelector(`.journey .stage[data-stage="${parentPosition}"]`);
    if (!parentButton) {
      restoreContext();
      return;
    }

    parentButton.click();

    queueMicrotask(() => {
      const review = scroll.querySelector('#reviewVideo');
      if (review) review.click();
      restoreIntroFlags();
      schedulePatch();
      setTimeout(() => {
        restoreIntroFlags();
        schedulePatch();
      }, 0);
    });
  }

  function findChild(stageId) {
    for (const data of [...dataRefs].reverse()) {
      const child = childFromData(data, stageId);
      if (child) return child;
    }
    return childFromData(latestData, stageId);
  }

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const marker = target?.closest('.child-stage-marker');
    if (marker) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const child = findChild(marker.dataset.childStageId);
      if (child?.unlocked) openChild(child);
      return;
    }

    if (active && target?.closest('#goPractice')) {
      queueMicrotask(() => {
        restoreIntroFlags();
        schedulePatch();
      });
    }
  }, true);

  const contentObserver = new MutationObserver(schedulePatch);
  contentObserver.observe(scroll, { childList:true, subtree:true });

  const modalObserver = new MutationObserver(() => {
    if (active && modal.classList.contains('hidden')) restoreContext();
  });
  modalObserver.observe(modal, { attributes:true, attributeFilter:['class'] });

  function annotateActiveStorage() {
    if (!active) return;
    const userId = latestData?.user?.id;
    if (!userId) return;
    const key = `caminhoShamathaActive:${userId}`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const value = JSON.parse(raw);
      if (Number(value?.stage) !== active.parentPosition || !['countdown','active'].includes(value?.sessionState)) return;
      if (value.sourceType === 'child' && String(value.childStageId || '') === String(active.child.stageId)) return;
      value.sourceType = 'child';
      value.childStageId = active.child.stageId;
      value.childDisplayCode = active.child.displayCode;
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  setInterval(annotateActiveStorage, 250);

  window.ShamathaPracticeContext = {
    getData: () => latestData,
    getActiveChild: () => active ? active.child : null,
    getParentPosition: () => active?.parentPosition || null,
    openChild,
    restore: restoreContext
  };
})();