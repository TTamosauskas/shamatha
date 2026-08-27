(() => {
  'use strict';

  const backend = window.ShamathaBackend;
  const journey = document.querySelector('.journey');
  const svg = document.querySelector('.journey-svg');
  const elephant = document.getElementById('journeyElephant');
  if (!backend?.request || !journey || !svg) return;

  let data = null;
  let refreshTimer = null;
  let resizeTimer = null;
  let modal = null;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function youtubeId(value) {
    try {
      const u = new URL(value);
      if (u.hostname.includes('youtu.be')) return u.pathname.split('/').filter(Boolean)[0] || '';
      if (u.hostname.includes('youtube.com')) {
        if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || '';
        if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || '';
        return u.searchParams.get('v') || '';
      }
    } catch (_) {}
    return /^[A-Za-z0-9_-]{11}$/.test(String(value || '')) ? value : '';
  }

  function mediaMarkup(url) {
    if (!url) return '';
    const id = youtubeId(url);
    if (id) return `<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&playsinline=1" title="Vídeo da etapa filha" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
    if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(url)) return `<div class="video-frame"><video controls playsinline preload="metadata" src="${esc(url)}"></video></div>`;
    return `<div class="video-frame"><iframe src="${esc(url)}" title="Vídeo da etapa filha" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'modal-backdrop child-stage-modal hidden';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.innerHTML = `<section class="unit-window"><header class="unit-toolbar unit-toolbar-minimal"><div class="unit-toolbar-title"><small id="childModalCode"></small><strong id="childModalTitle"></strong></div><button class="icon-btn" id="childModalClose" aria-label="Fechar aula">×</button></header><div class="unit-scroll" id="childModalScroll"></div></section>`;
    document.body.appendChild(modal);
    modal.querySelector('#childModalClose').addEventListener('click', closeModal);
    modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
    return modal;
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    const audio = modal.querySelector('audio');
    if (audio) { try { audio.pause(); } catch (_) {} }
  }

  function openChild(child) {
    const root = ensureModal();
    root.querySelector('#childModalCode').textContent = `Etapa ${child.displayCode}`;
    root.querySelector('#childModalTitle').textContent = child.unitName || 'Aula de apoio';
    const audioBlock = child.audioUrl ? `<div class="child-stage-audio"><strong>Áudio da prática</strong><audio controls preload="metadata" src="${esc(child.audioUrl)}"></audio><small>${child.inheritsAudio ? `Usando o áudio da Etapa ${child.parentPosition}.` : 'Áudio próprio desta aula.'}</small></div>` : '';
    root.querySelector('#childModalScroll').innerHTML = `<div class="child-stage-view"><p class="child-code">Etapa ${esc(child.displayCode)} · disponível a partir do dia ${child.releaseDay}</p><h1>${esc(child.unitName || 'Aula de apoio')}</h1>${child.objective ? `<p class="child-objective">${esc(child.objective)}</p>` : ''}${mediaMarkup(child.videoUrl)}${audioBlock}<div class="child-stage-close-row"><button class="ghost" id="childCloseBottom" type="button">Voltar ao caminho</button></div></div>`;
    root.querySelector('#childCloseBottom').addEventListener('click', closeModal);
    root.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    setTimeout(() => { root.querySelector('#childModalScroll').scrollTop = 0; }, 0);
  }

  function visualPoint(ratio) {
    const path = svg.querySelector('.path-line');
    if (!path || typeof path.getTotalLength !== 'function') return null;
    const rect = svg.getBoundingClientRect();
    const box = svg.viewBox.baseVal;
    if (!rect.width || !rect.height || !box.width || !box.height) return null;
    const pathLength = path.getTotalLength();
    const sampleCount = 1000;
    const scaleX = rect.width / box.width, scaleY = rect.height / box.height;
    let distance = 0, previous = null;
    const samples = [];
    for (let i = 0; i <= sampleCount; i += 1) {
      const length = pathLength * (i / sampleCount);
      const point = path.getPointAtLength(length);
      if (previous) distance += Math.hypot((point.x - previous.x) * scaleX, (point.y - previous.y) * scaleY);
      samples.push({ x:point.x, y:point.y, distance });
      previous = point;
    }
    const target = Math.max(0, Math.min(1, ratio)) * distance;
    let low = 0, high = samples.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (samples[mid].distance < target) low = mid + 1; else high = mid;
    }
    const after = samples[low], before = samples[Math.max(0, low - 1)];
    const span = Math.max(.0001, after.distance - before.distance);
    const t = Math.max(0, Math.min(1, (target - before.distance) / span));
    const x = before.x + (after.x - before.x) * t;
    const y = before.y + (after.y - before.y) * t;
    return { left:(x / box.width) * 100, top:(y / box.height) * 100 };
  }

  function markerRatio(child, total) {
    if (total <= 1) return .5;
    const parent = Math.max(1, Math.min(total, Number(child.parentPosition || 1)));
    const fraction = Math.max(.08, Math.min(.92, (Number(child.releaseDay || 1) - .5) / Math.max(1, Number(child.parentDeadlineDays || 1))));
    if (parent < total) return ((parent - 1) + fraction) / (total - 1);
    return ((total - 2) + (.72 + fraction * .22)) / (total - 1);
  }

  function renderMarkers() {
    journey.querySelectorAll('.child-stage-marker').forEach(item => item.remove());
    const children = (data?.childStages || []).filter(child => child.isActive && child.unlocked);
    const total = Math.max(1, Number(data?.stages?.length || 1));
    const current = Math.max(1, Number(data?.progress?.currentStage || 1));
    for (const child of children) {
      const pos = visualPoint(markerRatio(child, total));
      if (!pos) continue;
      const button = document.createElement('button');
      button.className = 'child-stage-marker';
      button.type = 'button';
      button.dataset.childStageId = child.stageId;
      button.dataset.parentCurrent = String(Number(child.parentPosition) === current);
      button.style.left = `${pos.left}%`;
      button.style.top = `${pos.top}%`;
      button.textContent = child.displayCode;
      button.setAttribute('aria-label', `Abrir etapa ${child.displayCode}: ${child.unitName || 'Aula de apoio'}`);
      button.addEventListener('click', () => openChild(child));
      journey.insertBefore(button, elephant);
    }
  }

  async function refresh() {
    try {
      data = await backend.request('/api/app-data');
      renderMarkers();
    } catch (_) {}
  }

  function scheduleRefresh(delay = 250) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, delay);
  }

  const status = document.getElementById('homeStatus');
  const progress = document.getElementById('miniProgress');
  if (status || progress) {
    const observer = new MutationObserver(() => scheduleRefresh(180));
    if (status) observer.observe(status, { childList:true, characterData:true, subtree:true });
    if (progress) observer.observe(progress, { childList:true, characterData:true, subtree:true });
  }

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderMarkers, 180);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRefresh(0); });
  setInterval(() => scheduleRefresh(0), 60000);
  scheduleRefresh(500);
})();
