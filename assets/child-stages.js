(() => {
  'use strict';

  const journey = document.querySelector('.journey');
  const svg = document.querySelector('.journey-svg');
  const elephant = document.getElementById('journeyElephant');
  const context = window.ShamathaPracticeContext;
  if (!journey || !svg || !context?.getData) return;

  let data = context.getData() || null;
  let resizeTimer = null;
  let renderTimer = null;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[ch]));
  }

  function visualPoint(ratio) {
    const path = svg.querySelector('.path-line');
    if (!path || typeof path.getTotalLength !== 'function') return null;

    const rect = svg.getBoundingClientRect();
    const box = svg.viewBox.baseVal;
    if (!rect.width || !rect.height || !box.width || !box.height) return null;

    const pathLength = path.getTotalLength();
    const sampleCount = 1000;
    const scaleX = rect.width / box.width;
    const scaleY = rect.height / box.height;
    let distance = 0;
    let previous = null;
    const samples = [];

    for (let i = 0; i <= sampleCount; i += 1) {
      const length = pathLength * (i / sampleCount);
      const point = path.getPointAtLength(length);
      if (previous) {
        distance += Math.hypot(
          (point.x - previous.x) * scaleX,
          (point.y - previous.y) * scaleY
        );
      }
      samples.push({ x:point.x, y:point.y, distance });
      previous = point;
    }

    const target = Math.max(0, Math.min(1, ratio)) * distance;
    let low = 0;
    let high = samples.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (samples[mid].distance < target) low = mid + 1;
      else high = mid;
    }

    const after = samples[low];
    const before = samples[Math.max(0, low - 1)];
    const span = Math.max(.0001, after.distance - before.distance);
    const t = Math.max(0, Math.min(1, (target - before.distance) / span));
    const x = before.x + (after.x - before.x) * t;
    const y = before.y + (after.y - before.y) * t;
    return {
      left:(x / box.width) * 100,
      top:(y / box.height) * 100
    };
  }

  function dayOrdinal(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit'
    }).formatToParts(date);
    const map = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    return Math.floor(Date.UTC(map.year, map.month - 1, map.day) / 86400000);
  }

  function refreshLocalUnlocks() {
    if (!data?.childStages?.length) return;
    const today = dayOrdinal(Date.now());
    for (const child of data.childStages) {
      if (child.unlocked) continue;
      const parent = Math.max(1, Number(child.parentPosition || 1));
      const state = data.progress?.stages?.[parent] || {};
      let unlocked = Boolean(state.completedAt);
      const activatedAt = Number(state.activatedAt || 0);
      if (!unlocked && activatedAt) {
        const activatedDay = dayOrdinal(activatedAt);
        const practiceDay = activatedDay == null || today == null ? 1 : (today - activatedDay + 1);
        unlocked = practiceDay >= Math.max(1, Number(child.releaseDay || 1));
      }
      if (unlocked) child.unlocked = true;
    }
  }

  function markerRatio(child, total) {
    if (total <= 1) return .5;
    const parent = Math.max(1, Math.min(total, Number(child.parentPosition || 1)));
    const fraction = Math.max(
      .08,
      Math.min(
        .92,
        (Number(child.releaseDay || 1) - .5) /
        Math.max(1, Number(child.parentDeadlineDays || 1))
      )
    );
    if (parent < total) return ((parent - 1) + fraction) / (total - 1);
    return ((total - 2) + (.72 + fraction * .22)) / (total - 1);
  }

  function childState(child, current, allDone) {
    const parent = Math.max(1, Number(child.parentPosition || 1));
    if (allDone || parent < current) return 'past';
    if (parent > current || !child.unlocked) return 'future';
    return 'current';
  }

  function lotusMarkup(code) {
    return `<span class="child-stage-lotus" aria-hidden="true"><svg viewBox="0 0 64 64" focusable="false"><path class="lotus-petal lotus-petal-center" d="M32 9c7 8 10 16 8 24-2 7-5 11-8 14-3-3-6-7-8-14-2-8 1-16 8-24Z"/><path class="lotus-petal" d="M16 20c9 2 15 7 18 14 2 6 1 12-2 17-7-1-13-4-17-9-5-7-4-15 1-22Z"/><path class="lotus-petal" d="M48 20c-9 2-15 7-18 14-2 6-1 12 2 17 7-1 13-4 17-9 5-7 4-15-1-22Z"/><path class="lotus-petal lotus-petal-lower" d="M7 34c9-2 17 0 23 6 4 4 6 9 6 15-8 1-15 0-21-4-7-4-10-10-8-17Z"/><path class="lotus-petal lotus-petal-lower" d="M57 34c-9-2-17 0-23 6-4 4-6 9-6 15 8 1 15 0 21-4 7-4 10-10 8-17Z"/><path class="lotus-base" d="M14 52c7 3 13 4 18 4s11-1 18-4c-4 7-10 10-18 10s-14-3-18-10Z"/></svg></span><span class="child-stage-marker-code">${esc(code)}</span>`;
  }

  function renderMarkers() {
    if (!data) return;
    refreshLocalUnlocks();
    journey.querySelectorAll('.child-stage-marker').forEach(item => item.remove());

    const children = (data.childStages || []).filter(child => child.isActive);
    const total = Math.max(1, Number(data.stages?.length || 1));
    const current = Math.max(1, Number(data.progress?.currentStage || 1));
    const lastState = data.progress?.stages?.[total];
    const allDone = current === total && Boolean(lastState?.completedAt);

    for (const child of children) {
      const pos = visualPoint(markerRatio(child, total));
      if (!pos) continue;

      const state = childState(child, current, allDone);
      const button = document.createElement('button');
      button.className = `child-stage-marker child-stage-marker--${state}`;
      button.type = 'button';
      button.dataset.childStageId = child.stageId;
      button.dataset.state = state;
      button.style.left = `${pos.left}%`;
      button.style.top = `${pos.top}%`;
      button.innerHTML = lotusMarkup(child.displayCode);
      button.setAttribute(
        'aria-label',
        child.unlocked
          ? `Abrir etapa ${child.displayCode}: ${child.unitName || 'Aula de apoio'}`
          : `Etapa ${child.displayCode} ainda não liberada`
      );
      button.setAttribute('aria-disabled', child.unlocked ? 'false' : 'true');
      journey.insertBefore(button, elephant);
    }
  }

  function syncData(next = null) {
    data = next || context.getData() || data;
    renderMarkers();
  }

  function scheduleRender(delay = 80) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => syncData(), delay);
  }

  document.addEventListener('shamatha:app-data-ready', event => {
    syncData(event.detail?.data || context.getData());
  });

  document.addEventListener('shamatha:child-context-changed', () => {
    scheduleRender(0);
  });

  const status = document.getElementById('homeStatus');
  const progress = document.getElementById('miniProgress');
  if (status || progress) {
    const observer = new MutationObserver(() => scheduleRender(80));
    if (status) observer.observe(status, { childList:true, characterData:true, subtree:true });
    if (progress) observer.observe(progress, { childList:true, characterData:true, subtree:true });
  }

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderMarkers, 180);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleRender(0);
  });

  // Mantém o posicionamento visual atualizado sem refazer consultas ao backend.
  setInterval(() => scheduleRender(0), 60000);
  scheduleRender(0);
})();
