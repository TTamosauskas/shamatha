(() => {
  'use strict';

  const scroll = document.getElementById('unitScroll');
  const context = window.ShamathaPracticeContext;
  if (!scroll || !context?.getData) return;

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

  function validSession(session) {
    return session?.valid === true || (session?.valid == null && session?.countedForProgress === true);
  }

  function activeParentStage() {
    const childParent = Number(context.getParentPosition?.() || 0);
    if (childParent > 0) return childParent;
    const toolbar = String(document.getElementById('toolbarStage')?.textContent || '');
    const match = toolbar.match(/Etapa\s+(\d+)/i);
    return match ? Number(match[1]) : 0;
  }

  function latestLucidity(stage) {
    const sessions = context.getData()?.progress?.stages?.[stage]?.sessions || [];
    let latest = null;
    for (const session of sessions) {
      if (!validSession(session) || session?.lucidity == null || session.lucidity === '') continue;
      const value = Number(session.lucidity);
      if (!Number.isFinite(value)) continue;
      const time = sessionTime(session);
      if (!latest || time > latest.time) latest = { value:Math.max(0, Math.min(100, value)), time };
    }
    return latest?.value ?? null;
  }

  function removeMarker(shell) {
    shell?.querySelector('.previous-lucidity-marker')?.remove();
  }

  function renderMarker() {
    renderFrame = null;
    const range = scroll.querySelector('#lucidity');
    const shell = range?.closest('.range-shell');
    if (!range || !shell) return;
    if (document.getElementById('saveArea')?.children?.length) return;

    removeMarker(shell);
    const stage = activeParentStage();
    if (!stage) return;
    const value = latestLucidity(stage);
    if (value == null) return;

    const rounded = Math.round(value);
    const marker = document.createElement('div');
    marker.className = 'previous-lucidity-marker';
    marker.setAttribute('aria-label', `Sessão anterior: ${rounded}% de concentração`);

    const pointer = document.createElement('span');
    pointer.className = 'previous-lucidity-pointer';
    pointer.title = `Anterior: ${rounded}%`;
    if (value <= 8) pointer.classList.add('edge-low');
    if (value >= 92) pointer.classList.add('edge-high');
    pointer.style.left = `${value}%`;
    pointer.innerHTML = '<span class="previous-lucidity-arrow" aria-hidden="true">△</span><span class="previous-lucidity-label">anterior</span>';
    marker.appendChild(pointer);

    const labels = shell.querySelector('.range-labels');
    if (labels) shell.insertBefore(marker, labels);
    else shell.appendChild(marker);
  }

  function scheduleRender() {
    if (renderFrame != null) cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(renderMarker);
  }

  new MutationObserver(scheduleRender).observe(scroll, { childList:true, subtree:true });
  document.addEventListener('shamatha:child-context-changed', scheduleRender);
  scheduleRender();
})();