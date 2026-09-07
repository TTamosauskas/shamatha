(() => {
  'use strict';

  const scroll = document.getElementById('unitScroll');
  if (!scroll || !window.ShamathaBackend?.request) return;

  let pending = false;
  let scheduleTimer = null;

  function sessionTime(session) {
    for (const value of [session?.savedAt, session?.endedAt, session?.startedAt]) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) return numeric;
      const parsed = new Date(value).getTime();
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
  }

  function latestLucidity(progress) {
    let latest = null;
    for (const stage of Object.values(progress?.stages || {})) {
      for (const session of stage?.sessions || []) {
        if (session?.lucidity == null || session.lucidity === '') continue;
        const value = Number(session.lucidity);
        if (!Number.isFinite(value)) continue;
        const time = sessionTime(session);
        if (!latest || time > latest.time) {
          latest = { value: Math.max(0, Math.min(100, value)), time };
        }
      }
    }
    return latest?.value ?? null;
  }

  async function renderPreviousMarker() {
    const initialRange = scroll.querySelector('#lucidity');
    if (!initialRange || pending) return;
    if (initialRange.dataset.previousLucidityChecked === 'true') return;

    pending = true;
    try {
      const appData = await window.ShamathaBackend.request('/api/app-data');

      const range = scroll.querySelector('#lucidity');
      const shell = range?.closest('.range-shell');
      if (!range || !shell) return;
      if (shell.querySelector('.previous-lucidity-marker')) {
        range.dataset.previousLucidityChecked = 'true';
        return;
      }

      const value = latestLucidity(appData?.progress);
      range.dataset.previousLucidityChecked = 'true';
      if (value == null) return;

      const roundedValue = Math.round(value);
      const marker = document.createElement('div');
      marker.className = 'previous-lucidity-marker';
      marker.setAttribute('aria-label', `Sessão anterior: ${roundedValue}% de concentração`);

      const pointer = document.createElement('span');
      pointer.className = 'previous-lucidity-pointer';
      pointer.title = `Anterior: ${roundedValue}%`;
      if (value <= 8) pointer.classList.add('edge-low');
      if (value >= 92) pointer.classList.add('edge-high');
      pointer.style.left = `${value}%`;
      pointer.innerHTML = '<span class="previous-lucidity-arrow" aria-hidden="true">△</span><span class="previous-lucidity-label">anterior</span>';
      marker.appendChild(pointer);

      const labels = shell.querySelector('.range-labels');
      if (labels) shell.insertBefore(marker, labels);
      else shell.appendChild(marker);
    } catch (_) {
      const range = scroll.querySelector('#lucidity');
      if (range) range.dataset.previousLucidityChecked = 'true';
    } finally {
      pending = false;
    }
  }

  function scheduleRender() {
    clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(renderPreviousMarker, 40);
  }

  const observer = new MutationObserver(scheduleRender);
  observer.observe(scroll, { childList: true, subtree: true });
  scheduleRender();
})();
