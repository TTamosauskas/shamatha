(() => {
  'use strict';

  const el = {
    modal: document.getElementById('unitModal'),
    scroll: document.getElementById('unitScroll'),
    close: document.getElementById('closeUnit'),
    continuePath: document.getElementById('continuePath'),
    homeStatus: document.getElementById('homeStatus'),
    liveClassBadge: document.getElementById('liveClassBadge'),
    stageLabel: document.getElementById('currentStageLabel'),
    unitName: document.getElementById('currentUnitName'),
    objective: document.getElementById('currentObjective'),
    miniProgress: document.getElementById('miniProgress'),
    elephant: document.getElementById('journeyElephant'),
    stages: [...document.querySelectorAll('.stage')],
    toast: document.getElementById('toast'),
    sessionPopup: document.getElementById('sessionPopup'),
    audio: document.getElementById('meditationAudio'),
    toolbarStage: document.getElementById('toolbarStage'),
    modalTitle: document.getElementById('modalTitle'),
    accountEmail: document.getElementById('accountEmail'),
    editorLink: document.getElementById('editorLink'),
    logout: document.getElementById('logout')
  };

  let appData = null;
  let progress = null;
  let selectedStage = 1;
  let sessionState = 'preparation';
  let currentSession = null;
  let countdownTimer = null;
  let saveTimer = null;
  let toastTimer = null;
  let journeySamples = [];
  let journeyVisualLength = 0;
  let journeyLayoutTimer = null;
  let recoveredSessionPending = false;
  let progressWatchTimer = null;
  let endControlTimer = null;
  let endControlPinned = false;

  const DAY_MS = 86400000;
  const stagePositions = {
    1:{left:26,top:87.5},2:{left:57,top:80.5},3:{left:66,top:69.5},4:{left:33,top:61},5:{left:27,top:49},6:{left:63,top:43},7:{left:73,top:32},8:{left:49,top:22},9:{left:76,top:10}
  };

  async function api(path, options = {}) {
    try {
      return await window.ShamathaBackend.request(path, options);
    } catch (error) {
      if (error?.status === 401) location.href = './index.html';
      if (error?.status === 403) location.href = './index.html?pending=1';
      throw error;
    }
  }

  function config(stage = selectedStage) { return appData.stages[stage - 1]; }
  function stageState(stage = selectedStage) { return progress.stages[stage]; }

  function saveProgress({ immediate = false } = {}) {
    if (appData.user.role === 'editor') return Promise.resolve();
    clearTimeout(saveTimer);
    const send = () => api('/api/progress', { method:'PUT', body:JSON.stringify({ progress }) }).catch(error => showToast(error.message));
    if (immediate) return send();
    saveTimer = setTimeout(send, 450);
    return Promise.resolve();
  }

  function localDateKey(value) {
    const d = value instanceof Date ? value : new Date(value);
    return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  }

  function formatDuration(totalSeconds) {
    const total = Math.max(0, Math.floor(Number(totalSeconds || 0)));
    const min = Math.floor(total / 60), sec = total % 60;
    return min ? `${min} min ${String(sec).padStart(2,'0')} s` : `${sec} s`;
  }

  function formatRoundedDuration(totalSeconds) {
    const total = Math.max(0, Number(totalSeconds || 0));
    if (total >= 60) { const m = Math.max(1, Math.round(total/60)); return `${m} ${m === 1 ? 'minuto' : 'minutos'}`; }
    const s = Math.round(total); return `${s} ${s === 1 ? 'segundo' : 'segundos'}`;
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

  function sessionDateKey(session) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(session?.dateKey || ''))) return session.dateKey;
    const time = sessionTime(session);
    return time ? localDateKey(time) : '';
  }

  function isValidSession(session) {
    return session?.valid === true || (session?.valid == null && session?.countedForProgress === true);
  }

  function windowStartKey(stage = selectedStage, now = Date.now()) {
    const days = Math.max(1, Number(config(stage).deadlineDays || 1));
    const start = new Date(now);
    start.setHours(0,0,0,0);
    start.setDate(start.getDate() - (days - 1));
    return localDateKey(start);
  }

  function validWindowSessions(stage = selectedStage) {
    const startKey = windowStartKey(stage);
    const byDate = new Map();
    const sessions = (stageState(stage).sessions || [])
      .filter(isValidSession)
      .slice()
      .sort((a,b) => sessionTime(a) - sessionTime(b));
    for (const session of sessions) {
      const key = sessionDateKey(session);
      if (!key || key < startKey || byDate.has(key)) continue;
      byDate.set(key, session);
    }
    return [...byDate.values()];
  }

  function refreshWindowFlags(stage = selectedStage) {
    const st = stageState(stage), required = Math.max(1, Number(config(stage).sessionsRequired || 1));
    const eligible = validWindowSessions(stage).slice(-required);
    const active = new Set(eligible);
    let changed = false;
    for (const session of st.sessions || []) {
      const next = active.has(session);
      if (Boolean(session.countedForProgress) !== next) {
        session.countedForProgress = next;
        changed = true;
      }
    }
    return { count:eligible.length, changed };
  }

  function completedCount(stage = selectedStage) {
    return Math.min(Number(config(stage).sessionsRequired || 0), validWindowSessions(stage).length);
  }

  function latestValidPracticeAt() {
    let latest = 0;
    for (const st of Object.values(progress?.stages || {})) {
      for (const session of st?.sessions || []) {
        if (!isValidSession(session)) continue;
        latest = Math.max(latest, sessionTime(session));
      }
    }
    return latest;
  }

  function completeStage(stage) {
    const st = stageState(stage);
    if (st.completedAt) return { completed:false, advanced:false };
    st.completedAt = Date.now();
    let advanced = false;
    if (stage === progress.currentStage && progress.currentStage < 9) {
      progress.currentStage += 1;
      advanced = true;
    }
    return { completed:true, advanced };
  }

  function regressForInactivity() {
    const from = Number(progress.currentStage || 1);
    if (from <= 1 || appData.user.role === 'editor') return { regressed:false };
    const days = Math.max(1, Number(config(from).deadlineDays || 1));
    const latest = latestValidPracticeAt();
    const resetAnchor = Number(progress.inactivityAnchorAt || 0);
    const anchor = Math.max(latest, resetAnchor);
    if (!anchor || Date.now() - anchor < days * DAY_MS) return { regressed:false };

    const to = from - 1;
    progress.currentStage = to;
    for (let stage = to; stage <= 9; stage += 1) stageState(stage).completedAt = null;
    progress.inactivityAnchorAt = Date.now();
    refreshWindowFlags(to);
    saveProgress({ immediate:true });
    return { regressed:true, from, to, days };
  }

  function applyProgressRules() {
    const regression = regressForInactivity();
    const stage = Number(progress.currentStage || 1);
    const refreshed = refreshWindowFlags(stage);
    const cfg = config(stage), st = stageState(stage);
    let completed = false, advanced = false;
    if (!regression.regressed && !st.completedAt && refreshed.count >= cfg.sessionsRequired) {
      const result = completeStage(stage);
      completed = result.completed;
      advanced = result.advanced;
    }
    if ((refreshed.changed || completed) && appData.user.role !== 'editor') saveProgress({ immediate:true });
    return { ...regression, completed, advanced, stage };
  }

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3300);
  }

  function practiceEndFooter() {
    return document.getElementById('practiceEndFooter');
  }

  function showPracticeEndControl({ persistent = false, hideAfter = 2400 } = {}) {
    const footer = practiceEndFooter();
    if (!footer) return;
    clearTimeout(endControlTimer);
    if (persistent) endControlPinned = true;
    footer.classList.add('activity-visible');
    if (!endControlPinned && hideAfter > 0) {
      endControlTimer = setTimeout(() => footer.classList.remove('activity-visible'), hideAfter);
    }
  }

  function revealEndControlFromInteraction() {
    if (sessionState !== 'active' || endControlPinned) return;
    showPracticeEndControl({ hideAfter:2400 });
  }

  function rebuildUniformJourneyLayout() {
    const path = document.querySelector('.path-line');
    const svg = document.querySelector('.journey-svg');
    if (!path || !svg || typeof path.getTotalLength !== 'function') return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const pathLength = path.getTotalLength(), sampleCount = 900, scaleX = rect.width/1000, scaleY = rect.height/1400;
    let visualDistance = 0, previous = null;
    const samples = [];
    for (let i=0;i<=sampleCount;i+=1) {
      const length = pathLength * (i/sampleCount), point = path.getPointAtLength(length);
      if (previous) visualDistance += Math.hypot((point.x-previous.x)*scaleX,(point.y-previous.y)*scaleY);
      samples.push({ length, x:point.x, y:point.y, visualDistance }); previous = point;
    }
    journeySamples = samples; journeyVisualLength = visualDistance;
    for (let stage=1; stage<=9; stage+=1) {
      const pos = pointOnJourneyVisual((stage-1)/8); stagePositions[stage] = pos;
      const button = el.stages.find(item => Number(item.dataset.stage) === stage);
      if (button) { button.style.left=`${pos.left}%`; button.style.top=`${pos.top}%`; }
    }
  }

  function pointOnJourneyVisual(progressRatio) {
    const ratio = Math.max(0,Math.min(1,Number(progressRatio || 0)));
    if (!journeySamples.length || !journeyVisualLength) {
      const a=stagePositions[1], b=stagePositions[9]; return { left:a.left+(b.left-a.left)*ratio, top:a.top+(b.top-a.top)*ratio };
    }
    const target=journeyVisualLength*ratio; let low=0, high=journeySamples.length-1;
    while(low<high){const mid=Math.floor((low+high)/2); if(journeySamples[mid].visualDistance<target) low=mid+1; else high=mid;}
    const after=journeySamples[low], before=journeySamples[Math.max(0,low-1)], span=Math.max(.0001,after.visualDistance-before.visualDistance);
    const local=Math.max(0,Math.min(1,(target-before.visualDistance)/span));
    const x=before.x+(after.x-before.x)*local, y=before.y+(after.y-before.y)*local;
    return { left:(x/1000)*100, top:(y/1400)*100 };
  }

  function currentPosition() {
    const stage = progress.currentStage;
    if (stage >= 9 && stageState(9).completedAt) return { ...stagePositions[9], stage:9 };
    const cfg = config(stage), count = completedCount(stage), ratio = Math.max(0, Math.min(1, count/cfg.sessionsRequired));
    const pathRatio = ((stage-1)+ratio)/8;
    return { ...pointOnJourneyVisual(pathRatio), stage };
  }

  function updateHome({ animateAdvance = false } = {}) {
    const ruleResult = applyProgressRules();
    if (ruleResult.regressed) {
      showToast(`${ruleResult.days} dias sem uma sessão válida. Você retornou para a etapa ${ruleResult.to}.`);
    } else if (ruleResult.completed) {
      animateAdvance = true;
      showToast(ruleResult.advanced ? 'Meta cumprida na janela atual. A próxima etapa foi liberada.' : 'Meta cumprida. Caminho concluído.');
    }

    const current = progress.currentStage;
    const cfg = config(current), count = completedCount(current), allDone = current === 9 && Boolean(stageState(9).completedAt);
    const pos = currentPosition();
    el.elephant.style.left = `${pos.left}%`; el.elephant.style.top = `${pos.top}%`;
    const nextPos = stagePositions[Math.min(9,current+1)], face = nextPos && nextPos.left > pos.left ? -1 : 1;
    el.elephant.style.setProperty('--face', face);
    el.elephant.className = `elephant stage-${current}${animateAdvance ? ' walking journey-elephant-progress-glow' : ''}`;
    if (animateAdvance) setTimeout(()=>el.elephant.classList.remove('walking','journey-elephant-progress-glow'),1900);

    el.stages.forEach(btn => {
      const n=Number(btn.dataset.stage); btn.classList.remove('current','done','future');
      if (allDone || n < current) btn.classList.add('done'); else if (n === current) btn.classList.add('current'); else btn.classList.add('future');
      btn.setAttribute('aria-disabled', n > current ? 'true' : 'false');
    });

    el.homeStatus.textContent = allDone ? 'Caminho concluído' : `Etapa ${current} de 9`;
    el.unitName.textContent = `Etapa ${current} – ${cfg.unitName}`;
    el.objective.textContent = cfg.objective || '';
    el.miniProgress.textContent = allDone ? '9 etapas concluídas' : `${count}/${cfg.sessionsRequired} · últimos ${cfg.deadlineDays} dias`;
    el.continuePath.textContent = allDone ? 'Rever etapa 9' : 'Abrir etapa';
  }

  function setToolbar() {
    const cfg = config();
    el.toolbarStage.textContent = `Etapa ${selectedStage} — ${cfg.stageName}`;
    el.modalTitle.textContent = cfg.unitName;
  }

  function openUnit(view) {
    setToolbar();
    el.modal.classList.remove('hidden'); document.body.style.overflow='hidden';
    if (view === 'intro') renderIntro(); else if (view === 'reflection') renderReflection(); else renderPreparation();
    setTimeout(()=>el.scroll.scrollTop=0,0);
  }

  function closeUnit() {
    if (['active','countdown'].includes(sessionState)) { showToast('Use “Encerrar prática” para registrar corretamente a prática em andamento.'); return; }
    el.modal.classList.add('hidden'); document.body.style.overflow='';
  }

  function mediaMarkup(url) {
    if (!url) return '<div class="media-empty">O editor ainda está configurando o vídeo desta etapa.</div>';
    const youtubeId = extractYouTubeId(url);
    if (youtubeId) return `<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?rel=0&playsinline=1" title="Vídeo da etapa" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
    if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(url)) return `<div class="video-frame"><video controls playsinline preload="metadata" src="${escapeHtml(url)}"></video></div>`;
    return `<div class="video-frame"><iframe src="${escapeHtml(url)}" title="Vídeo da etapa" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  }

  function extractYouTubeId(value) {
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

  function renderIntro() {
    sessionState='intro';
    const st=stageState(), cfg=config(); st.introStarted=true; saveProgress();
    el.scroll.innerHTML=`<div class="view"><div class="unit-heading"><p class="eyebrow">Etapa ${selectedStage}</p><h1>${escapeHtml(cfg.unitName)}</h1><p>${escapeHtml(cfg.objective || '')}</p></div>${mediaMarkup(cfg.videoUrl)}<div class="action-stack"><button class="primary" id="goPractice">${st.introDone ? 'Ir para a prática' : 'Continuar para a prática'}</button><button class="ghost" id="backHomeIntro">Voltar ao caminho</button></div></div>`;
    document.getElementById('goPractice').addEventListener('click',()=>{st.introDone=true;saveProgress();renderPreparation();});
    document.getElementById('backHomeIntro').addEventListener('click',closeUnit);
  }

  function renderPreparation() {
    sessionState='preparation'; currentSession=null; clearActiveSession();
    clearTimeout(endControlTimer); endControlPinned=false;
    const cfg=config(), next=Math.min(completedCount()+1,cfg.sessionsRequired);
    el.scroll.innerHTML=`<div class="view prep"><button class="prep-back-link" id="backFromPreparation" type="button">◀️ Voltar</button><div class="prep-inner"><p class="session-count">Sessão ${next} · etapa ${selectedStage}</p><p class="prep-copy" id="prepCopy">Encontre uma posição estável.<br>Quando estiver pronto, comece.</p><div class="start-orb-wrap"><button class="start-orb" id="startSession" aria-live="polite">Começar</button></div><div class="review-video-row" id="reviewVideoRow"><button class="review-video-link" id="reviewVideo" type="button">Rever vídeo</button></div></div><footer class="active-footer" id="countdownEndFooter"><button class="danger" id="endCountdown" type="button">Encerrar prática</button></footer></div>`;
    document.getElementById('startSession').addEventListener('click',beginCountdown);
    document.getElementById('reviewVideo').addEventListener('click',renderIntro);
    document.getElementById('backFromPreparation').addEventListener('click',closeUnit);
    document.getElementById('endCountdown').addEventListener('click',()=>{
      if(sessionState!=='countdown' || !currentSession) return;
      currentSession.startedAt=Date.now();
      endPractice(true);
    });
  }

  async function unlockAudio() {
    const cfg=config();
    if (!cfg.audioUrl) return;
    try { el.audio.src=cfg.audioUrl; el.audio.currentTime=0; el.audio.volume=0; const p=el.audio.play(); if(p) await p; el.audio.pause(); el.audio.currentTime=0; el.audio.volume=1; } catch (_) { el.audio.volume=1; }
  }

  async function beginCountdown() {
    if(sessionState!=='preparation') return;
    document.getElementById('prepCopy')?.classList.add('departing'); document.getElementById('reviewVideoRow')?.classList.add('departing'); document.getElementById('backFromPreparation')?.classList.add('departing');
    await unlockAudio();
    sessionState='countdown';
    currentSession={id:`s_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,stage:selectedStage,sessionNumber:Math.min(completedCount()+1,config().sessionsRequired),startedAt:null,endedAt:null,elapsedSeconds:0,playbackSeconds:0,audioDuration:Number.isFinite(el.audio.duration)?el.audio.duration:0,endedEarly:false,paused:false};
    saveActiveSession();
    document.getElementById('countdownEndFooter')?.classList.add('activity-visible');
    const btn=document.getElementById('startSession'); btn.classList.add('breathing','counting'); btn.disabled=true;
    let n=5; const tick=()=>{btn.classList.remove('tick');void btn.offsetWidth;btn.textContent=String(n);btn.classList.add('tick');if(n===1)countdownTimer=setTimeout(startPractice,1000);else{n-=1;countdownTimer=setTimeout(tick,1000);}}; tick();
  }

  async function startPractice() {
    clearTimeout(countdownTimer); sessionState='active'; currentSession.startedAt=Date.now(); endControlPinned=false;
    const cfg=config();
    if (cfg.audioUrl) {
      el.audio.src=cfg.audioUrl; el.audio.currentTime=0; el.audio.volume=1;
      try { await el.audio.play(); } catch (_) { showToast('Toque no botão central para iniciar o áudio.'); currentSession.paused=true; }
    } else { currentSession.audioDuration=0; currentSession.paused=false; }
    saveActiveSession(); renderActive();
    showPracticeEndControl({ hideAfter:1000 });
  }

  function renderActive() {
    const hasAudio=Boolean(config().audioUrl);
    el.scroll.innerHTML=`<div class="view practice-active"><div class="active-center"><div class="active-breath ${currentSession.paused?'paused':''}" id="audioProgressRing" style="--audio-progress:0%"><button class="active-toggle" id="audioToggle" type="button" aria-label="${currentSession.paused?'Retomar áudio':'Pausar áudio'}"><span class="active-symbol">${currentSession.paused?'▶':'Ⅱ'}</span></button></div><p class="active-started"><strong>Prática iniciada</strong>${hasAudio?'Acompanhe o áudio e volte à respiração.':'A etapa está configurada como prática silenciosa.'}</p></div><footer class="active-footer activity-visible" id="practiceEndFooter"><button class="danger" id="endSession">Encerrar prática</button></footer></div>`;
    document.getElementById('audioToggle').addEventListener('click',toggleAudio);
    document.getElementById('endSession').addEventListener('click',()=>endPractice(true));
  }

  async function toggleAudio() {
    if(!config().audioUrl) return;
    const ring=document.getElementById('audioProgressRing'), btn=document.getElementById('audioToggle');
    if(el.audio.paused){try{await el.audio.play();currentSession.paused=false;ring?.classList.remove('paused');if(btn)btn.innerHTML='<span class="active-symbol">Ⅱ</span>';}catch(_){showToast('O navegador aguarda outro toque para liberar o áudio.');}}
    else{el.audio.pause();currentSession.paused=true;ring?.classList.add('paused');if(btn)btn.innerHTML='<span class="active-symbol">▶</span>';}
    saveActiveSession();
  }

  function endPractice(endedEarly) {
    if(!currentSession) return;
    clearTimeout(countdownTimer); clearTimeout(endControlTimer); endControlPinned=false;
    document.dispatchEvent(new CustomEvent('shamatha:practice-ended'));
    const now=Date.now(), startedAt=Number(currentSession.startedAt || now), playback=config().audioUrl && Number.isFinite(el.audio.currentTime)?el.audio.currentTime:Math.max(0,(now-startedAt)/1000);
    const duration=Number.isFinite(el.audio.duration)?el.audio.duration:(currentSession.audioDuration||0);
    el.audio.pause();
    currentSession={...currentSession,startedAt,endedAt:now,elapsedSeconds:Math.max(0,Math.round((now-startedAt)/1000)),playbackSeconds:Math.max(0,playback),audioDuration:duration,endedEarly:Boolean(endedEarly),paused:false};
    clearActiveSession(); sessionState='reflection'; renderReflection();
  }

  function renderReflection() {
    if(!currentSession){renderPreparation();return;}
    const cfg=config();
    el.scroll.innerHTML=`<div class="view reflection"><div class="unit-heading reflection-heading"><p class="eyebrow">Registro da prática</p><h1>Como foi esta sessão?</h1></div><div class="elapsed-card"><small>Tempo de prática</small><strong>${escapeHtml(formatDuration(currentSession.elapsedSeconds))}</strong></div><div class="field"><div class="field-label"><span>Nível de concentração</span><span class="lucidity-value" id="lucidityValue">Escolha um valor</span></div><div class="range-shell"><input id="lucidity" class="empty-range" type="range" min="0" max="100" value="50" data-chosen="false"><div class="range-labels"><span>Baixa</span><span>Média</span><span>Alta</span></div></div></div><div class="field"><div class="field-label"><span>Observações</span></div><div class="notes-wrap"><textarea id="notes" placeholder="O que você percebeu durante a prática?"></textarea></div></div><div class="validation-note">Uma sessão válida por dia entra na janela móvel dos últimos ${escapeHtml(cfg.deadlineDays)} dias.</div><div class="after-actions"><button class="primary" id="saveSession">Salvar sessão</button><button class="ghost" id="discardReflection">Voltar ao caminho</button></div><div id="saveArea"></div></div>`;
    const range=document.getElementById('lucidity'); range.addEventListener('input',()=>{range.dataset.chosen='true';range.classList.remove('empty-range');document.getElementById('lucidityValue').textContent=`${range.value}%`;});
    document.getElementById('saveSession').addEventListener('click',saveCurrentSession);
    document.getElementById('discardReflection').addEventListener('click',()=>{currentSession=null;sessionState='preparation';closeUnit();});
  }

  function saveCurrentSession() {
    if(!currentSession || currentSession.saved) return;
    const lucidityEl=document.getElementById('lucidity'), notesEl=document.getElementById('notes');
    if(!lucidityEl || lucidityEl.dataset.chosen!=='true'){showToast('Escolha o nível de concentração antes de salvar.');lucidityEl?.focus();return;}
    const cfg=config(), st=stageState();
    const dateKey=localDateKey(currentSession.startedAt);
    const effectivePractice=config().audioUrl ? Number(currentSession.playbackSeconds||0) : Number(currentSession.elapsedSeconds||0);
    const valid=effectivePractice>=cfg.minSessionSeconds;
    const saved={...currentSession,dateKey,lucidity:Number(lucidityEl.value),notes:notesEl.value.trim(),valid,countedForProgress:false,savedAt:Date.now(),sharedAt:null};
    st.sessions.push(saved);
    if (valid) progress.inactivityAnchorAt = saved.savedAt;
    const refreshed=refreshWindowFlags(selectedStage);
    currentSession={...saved,countedForProgress:Boolean(saved.countedForProgress),saved:true};
    const count=refreshed.count; let advanced=false;
    if(count>=cfg.sessionsRequired && !st.completedAt){advanced=completeStage(selectedStage).advanced;}
    saveProgress({immediate:true}); renderSavedResult(currentSession,advanced); updateHome({animateAdvance:Boolean(saved.countedForProgress) || advanced});
  }

  function renderSavedResult(savedSession, advanced) {
    const saveArea=document.getElementById('saveArea'); document.getElementById('saveSession').disabled=true;
    const cfg=config(), st=stageState(), count=completedCount(), pct=Math.round((count/cfg.sessionsRequired)*100), prior=Math.max(0,count-(savedSession.countedForProgress?1:0)), priorPct=Math.round((prior/cfg.sessionsRequired)*100);
    const stageFinished=Boolean(st.completedAt), remaining=Math.max(0,cfg.sessionsRequired-count);
    const message=savedSession.countedForProgress?'Sessão válida incorporada à janela atual.':savedSession.valid?'Sessão registrada como prática adicional.':'Sessão registrada como prática livre; o progresso começa a partir do tempo mínimo definido para a etapa.';
    const preview=buildShareText(savedSession), resultClass=savedSession.countedForProgress?'good':'neutral';
    const progressStatus=stageFinished
      ? `Meta cumprida nos últimos ${cfg.deadlineDays} dias. Etapa concluída.`
      : `${remaining === 1 ? 'Falta' : 'Faltam'} ${remaining} ${remaining === 1 ? 'sessão válida' : 'sessões válidas'} nos últimos ${cfg.deadlineDays} dias.`;
    saveArea.innerHTML=`<div class="save-result ${resultClass}">${escapeHtml(message)}</div><section class="progress-card"><h3>Seu progresso</h3><div class="progress-line"><div class="progress-track"></div><div class="progress-fill" id="progressFill" style="width:${priorPct}%"></div><span class="progress-mark" style="left:0%"></span><span class="progress-mark" style="left:33.333%"></span><span class="progress-mark" style="left:66.666%"></span><span class="progress-mark" style="left:100%"></span><span class="progress-elephant" id="progressElephant" style="left:${priorPct}%">🐘</span></div><div class="progress-facts"><span><strong>${count} de ${cfg.sessionsRequired}</strong> sessões válidas nos últimos ${cfg.deadlineDays} dias.</span><span>${escapeHtml(progressStatus)}</span></div></section>${appData.settings.whatsappPhone?`<section class="share-card"><pre class="preview">${escapeHtml(preview)}</pre><div class="share-actions"><a class="whatsapp" id="shareWhatsapp" target="_blank" rel="noopener">Enviar ao Professor</a></div></section>`:''}${stageFinished?`<div class="completion"><div class="completion-symbol">🐘</div><h2>${selectedStage===9?'Caminho concluído.':'Etapa concluída.'}</h2><p>${advanced?'A próxima etapa foi liberada e já aparece no caminho.':'Esta etapa permanece disponível no seu histórico.'}</p><button class="primary" id="completeStage">Voltar ao caminho</button></div>`:''}`;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{const pe=document.getElementById('progressElephant'),pf=document.getElementById('progressFill');if(savedSession.countedForProgress&&pe)pe.classList.add('session-advance');if(pe)pe.style.left=`${pct}%`;if(pf)pf.style.width=`${pct}%`;}));
    const share=document.getElementById('shareWhatsapp'); if(share){share.href=`https://api.whatsapp.com/send?phone=${encodeURIComponent(appData.settings.whatsappPhone)}&text=${encodeURIComponent(preview)}`;share.addEventListener('click',()=>markShared(savedSession.id));}
    document.getElementById('completeStage')?.addEventListener('click',()=>{el.modal.classList.add('hidden');document.body.style.overflow='';selectedStage=progress.currentStage;updateHome({animateAdvance:advanced});showSessionCompletionPopup(advanced);});
  }

  function buildShareText(session) {
    const observation=(session.notes||'').trim(); return `Hoje meditei por ${formatRoundedDuration(session.elapsedSeconds)} e estimo ${session.lucidity}% de concentração.${observation?` ${observation}`:''}`;
  }

  function markShared(id) {
    const st=stageState(); const index=st.sessions.findIndex(s=>s.id===id); if(index>=0){st.sessions[index].sharedAt=Date.now();saveProgress();}
  }

  function showSessionCompletionPopup(advanced) {
    el.sessionPopup.innerHTML=`<section class="session-popup"><div class="session-popup-elephant" aria-hidden="true">🐘</div><h2>${advanced?'Próxima etapa liberada':'Sessão concluída'}</h2><p>${advanced?'O caminho avançou para a etapa seguinte.':'A prática ficou registrada no seu caminho.'}</p><button class="primary" id="closeSessionPopup">Continuar</button></section>`;
    el.sessionPopup.classList.remove('hidden'); document.getElementById('closeSessionPopup').addEventListener('click',()=>{el.sessionPopup.classList.add('hidden');el.sessionPopup.innerHTML='';});
  }

  function escapeHtml(value) { return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

  function activeKey() { return `caminhoShamathaActive:${appData?.user?.id || 'anon'}`; }
  function saveActiveSession() { if(!currentSession || !['countdown','active'].includes(sessionState)) return; try{localStorage.setItem(activeKey(),JSON.stringify({...currentSession,sessionState,playbackSeconds:Number.isFinite(el.audio.currentTime)?el.audio.currentTime:(currentSession.playbackSeconds||0),savedAt:Date.now()}));}catch(_){} }
  function clearActiveSession(){try{localStorage.removeItem(activeKey());}catch(_){} }
  function recoverInterruptedSession(){try{const raw=localStorage.getItem(activeKey());if(!raw)return false;const recovered=JSON.parse(raw);clearActiveSession();selectedStage=Math.max(1,Math.min(progress.currentStage,Number(recovered.stage||progress.currentStage)));currentSession={...recovered,endedAt:Date.now(),endedEarly:true,interruptedByReload:true,elapsedSeconds:Math.max(0,Math.round(Number(recovered.playbackSeconds||0)))};sessionState='reflection';return true;}catch(_){clearActiveSession();return false;}}

  el.audio.addEventListener('timeupdate',()=>{
    if(sessionState==='active'&&currentSession){currentSession.playbackSeconds=el.audio.currentTime;currentSession.audioDuration=Number.isFinite(el.audio.duration)?el.audio.duration:currentSession.audioDuration;const ring=document.getElementById('audioProgressRing'),duration=Number(el.audio.duration||currentSession.audioDuration||0),pct=duration>0?Math.max(0,Math.min(100,(el.audio.currentTime/duration)*100)):0;if(ring){ring.style.setProperty('--audio-progress',`${pct}%`);ring.setAttribute('aria-label',`Progresso da meditação: ${Math.round(pct)}%`);}saveActiveSession();}
  });
  el.audio.addEventListener('ended',()=>endPractice(false));

  document.addEventListener('shamatha:audio-ended',()=>{
    if(sessionState!=='active') return;
    showPracticeEndControl({ persistent:true, hideAfter:0 });
  });
  el.scroll.addEventListener('pointerdown',revealEndControlFromInteraction,{passive:true});
  el.scroll.addEventListener('keydown',revealEndControlFromInteraction);

  el.continuePath.addEventListener('click',()=>{
    if(recoveredSessionPending&&currentSession){recoveredSessionPending=false;openUnit('reflection');showToast('A prática interrompida foi recuperada para registro.');return;}
    applyProgressRules(); selectedStage=progress.currentStage; openUnit(stageState().introDone?'practice':'intro');
  });
  el.close.addEventListener('click',closeUnit);
  el.modal.addEventListener('click',event=>{if(event.target===el.modal&&!['active','countdown'].includes(sessionState))closeUnit();});

  el.stages.forEach(btn=>btn.addEventListener('click',()=>{
    const stage=Number(btn.dataset.stage), current=progress.currentStage;
    if(stage>current){showToast(`A etapa ${stage} será liberada pelo avanço nas etapas anteriores.`);return;}
    selectedStage=stage;
    openUnit(stageState().introDone?'practice':'intro');
  }));

  el.logout.addEventListener('click',async()=>{await api('/api/logout',{method:'POST',body:'{}'}).catch(()=>null);location.href='./index.html';});
  window.addEventListener('beforeunload',()=>{if(['active','countdown'].includes(sessionState))saveActiveSession();clearInterval(progressWatchTimer);clearTimeout(endControlTimer);});
  window.addEventListener('resize',()=>{clearTimeout(journeyLayoutTimer);journeyLayoutTimer=setTimeout(()=>{rebuildUniformJourneyLayout();updateHome();},120);});

  async function init() {
    appData=await api('/api/app-data'); progress=appData.progress;
    el.accountEmail.textContent=appData.user.email;
    if(appData.user.role==='editor')el.editorLink.classList.remove('hidden');
    const live=String(appData.settings.liveClassUrl||'').trim();
    if(live){el.liveClassBadge.href=live;el.liveClassBadge.classList.remove('hidden');el.liveClassBadge.setAttribute('aria-label',`Abrir aula ao vivo: ${live}`);}else{el.liveClassBadge.classList.add('hidden');}
    selectedStage=progress.currentStage; rebuildUniformJourneyLayout(); updateHome(); recoveredSessionPending=recoverInterruptedSession();
    progressWatchTimer=setInterval(()=>{if(progress && el.modal.classList.contains('hidden'))updateHome();},60000);
  }

  init().catch(error=>showToast(error.message));
})();
