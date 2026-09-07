(() => {
  'use strict';

  const scroll = document.getElementById('unitScroll');
  if (!scroll || !window.ShamathaBackend?.request) return;

  let cachedAppData = null;
  let cacheReady = false;
  let appDataPromise = null;
  let renderFrame = null;

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

  function refreshAppData(force = false) {
    if (appDataPromise && !force) return appDataPromise;
    appDataPromise = window.ShamathaBackend.request('/api/app-data')
      .then(data => {
        cachedAppData = data || null;
        cacheReady = true;
        return cachedAppData;
      })
      .catch(() => {
        cacheReady = true;
        return cachedAppData;
      })
      .finally(() => {
        appDataPromise = null;
      });
    return appDataPromise;
  }

  function insertMarker(progress) {
    const range = scroll.querySelector('#lucidity');
    const shell = range?.closest('.range-shell');
    if (!range || !shell || shell.querySelector('.previous-lucidity-marker')) return;

    const value = latestLucidity(progress);
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
  }

  function renderPreviousMarker() {
    if (!scroll.querySelector('#lucidity')) return;

    if (cacheReady) {
      insertMarker(cachedAppData?.progress);
      return;
    }

    refreshAppData().then(data => insertMarker(data?.progress));
  }

  function scheduleRender() {
    if (renderFrame != null) cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(() => {
      renderFrame = null;
      renderPreviousMarker();

      const saveResult = scroll.querySelector('.save-result');
      if (saveResult && saveResult.dataset.previousLucidityCacheRefreshed !== 'true') {
        saveResult.dataset.previousLucidityCacheRefreshed = 'true';
        setTimeout(() => refreshAppData(true), 300);
      }
    });
  }

  const observer = new MutationObserver(scheduleRender);
  observer.observe(scroll, { childList: true, subtree: true });

  refreshAppData();
  scheduleRender();
})();
