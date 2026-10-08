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
    journey: document.querySelector('.journey'),
    journeySvg: document.querySelector('.journey-svg'),
    stages: [],
    toast: document.getElementById('toast'),
    sessionPopup: document.getElementById('sessionPopup'),
    audio: document.getElementById('meditationAudio'),
    toolbarStage: document.getElementById('toolbarStage'),
    modalTitle: document.getElementById('modalTitle'),
    accountEmail: document.getElementById('accountEmail'),
    editorLink: document.getElementById('editorLink'),
    logout: document.getElementById('logout'),
    logbookButton: document.getElementById('logbookButton'),
    logbookModal: document.getElementById('logbookModal'),
    closeLogbook: document.getElementById('closeLogbook'),
    logbookList: document.getElementById('logbookList')
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
  let logbookProgressStage = null;

  const DAY_MS = 86400000;
  const PROFESSOR_TZ = 'America/Sao_Paulo';
  const BASE_JOURNEY_PATH = 'M260 1225 C620 1165 760 1085 640 975 C520 865 235 880 250 745 C265 610 720 655 730 505 C740 355 430 350 540 210 C600 135 690 110 760 95';
  const stagePositions = { 1:{left:26,top:87.5} };
  function totalStages() { return Math.max(1, Number(appData?.stages?.length || 1)); }
  function lastStage() { return totalStages(); }

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

  function logbookTime(value) {
    const numeric=Number(value);
    if(Number.isFinite(numeric) && numeric>0) return numeric;
    const parsed=new Date(value).getTime();
    return Number.isFinite(parsed) && parsed>0 ? parsed : 0;
  }

  function normalizeStageCode(value) {
    const code=String(value??'').trim().replace(/^Etapa\s+/i,'');
    if(/^\d+\.\d+$/.test(code)) return code;
    if(/^\d+$/.test(code)) return `${code}.0`;
    return '';
  }

  function logbookStageCode(raw, stage=null) {
    const explicit=normalizeStageCode(raw?.stageCode || raw?.childDisplayCode);
    if(explicit) return explicit;
    const stageId=String(raw?.stageId || raw?.childStageId || '');
    if(stageId) {
      const child=(appData?.childStages||[]).find(item=>String(item?.stageId||'')===stageId);
      const childCode=normalizeStageCode(child?.displayCode);
      if(childCode) return childCode;
    }
    return normalizeStageCode(stage);
  }

  function normalizeLogbookRecord(raw) {
    if(!raw || typeof raw!=='object') return null;
    const at=logbookTime(raw.at || raw.savedAt || raw.endedAt || raw.startedAt);
    if(!at) return null;
    const durationSeconds=Math.max(0,Math.round(Number(raw.durationSeconds ?? raw.elapsedSeconds ?? raw.playbackSeconds ?? 0)));
    const concentrationValue=Number(raw.concentration ?? raw.lucidity);
    const concentration=Number.isFinite(concentrationValue)?Math.max(0,Math.min(100,Math.round(concentrationValue))):null;
    const notes=String(raw.notes||'').trim().slice(0,2000);
    const stageValue=Number(raw.stage);
    const stage=Number.isInteger(stageValue) && stageValue>0 ? stageValue : null;
    const stageId=String(raw.stageId||raw.childStageId||'');
    const stageCode=logbookStageCode({...raw,stageId},stage);
    const sentAtValue=logbookTime(raw.sentAt || raw.sharedAt);
    const fallbackText=`Hoje meditei por ${formatRoundedDuration(durationSeconds)}${concentration==null?'.':` e estimo ${concentration}% de concentração.`}${notes?` ${notes}`:''}`;
    const baseText=String(raw.text||fallbackText).trim().replace(/^\[Etapa\s+\d+(?:\.\d+)?\]\s*/i,'');
    const text=(stageCode?`[Etapa ${stageCode}] `:'')+baseText;
    return {
      id:String(raw.id || `${at}:${stage||''}:${durationSeconds}:${concentration??''}`),
      at,
      stage,
      stageCode,
      stageId,
      durationSeconds,
      concentration,
      notes,
      sentAt:sentAtValue || null,
      text:text.slice(0,2600)
    };
  }

  function normalizeLogbook(entries) {
    const byId=new Map();
    for(const raw of Array.isArray(entries)?entries:[]) {
      const entry=normalizeLogbookRecord(raw);
      if(entry) byId.set(entry.id,entry);
    }
    return [...byId.values()].sort((a,b)=>a.at-b.at).slice(-50);
  }

  function logbookEntryFromSession(session, stageNumber=selectedStage) {
    const at=sessionTime(session)||Date.now();
    const stage=Number(stageNumber);
    const cfg=Number.isInteger(stage) && stage>0 ? appData?.stages?.[stage-1] : null;
    return normalizeLogbookRecord({
      id:session?.id || `${at}:${stage||''}`,
      at,
      stage:Number.isInteger(stage) && stage>0 ? stage : null,
      stageId:session?.childStageId || session?.stageId || cfg?.childStageId || cfg?.stageId || '',
      stageCode:session?.childDisplayCode || cfg?.childDisplayCode || `${stage}.0`,
      durationSeconds:Number(session?.elapsedSeconds ?? session?.playbackSeconds ?? 0),
      concentration:session?.lucidity,
      notes:session?.notes || '',
      sentAt:session?.sentAt || session?.sharedAt || (Number(progress?.logbookTransitionSentAt || 0) >= at ? Number(progress.logbookTransitionSentAt) : null),
      text:buildShareText(session)
    });
  }

  function reconcileLogbook() {
    const existing=Array.isArray(progress?.logbook)?progress.logbook:[];
    const before=JSON.stringify(existing);
    const merged=[];
    for(const [stageKey,state] of Object.entries(progress?.stages||{})) {
      for(const session of Array.isArray(state?.sessions)?state.sessions:[]) {
        const entry=logbookEntryFromSession(session,Number(stageKey));
        if(entry) merged.push(entry);
      }
    }
    merged.push(...existing);
    progress.logbook=normalizeLogbook(merged);
    return before!==JSON.stringify(progress.logbook);
  }

  function appendLogbookEntry(session, stageNumber=selectedStage) {
    const entry=logbookEntryFromSession(session,stageNumber);
    if(!entry) return;
    progress.logbook=normalizeLogbook([...(Array.isArray(progress.logbook)?progress.logbook:[]),entry]);
  }

  function professorDateParts(value=Date.now()) {
    const date=new Date(value);
    const parts=new Intl.DateTimeFormat('en-US',{
      timeZone:PROFESSOR_TZ,year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(date);
    return Object.fromEntries(parts.filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
  }

  function professorDateKey(value=Date.now()) {
    const parts=professorDateParts(value);
    return `${parts.year}-${String(parts.month).padStart(2,'0')}-${String(parts.day).padStart(2,'0')}`;
  }

  function professorCycleKey(value=Date.now()) {
    const parts=professorDateParts(value);
    const utcDay=Date.UTC(parts.year,parts.month-1,parts.day);
    const weekday=new Date(utcDay).getUTCDay();
    const daysSinceThursday=(weekday-4+7)%7;
    const thursday=new Date(utcDay-daysSinceThursday*DAY_MS);
    return [
      thursday.getUTCFullYear(),
      String(thursday.getUTCMonth()+1).padStart(2,'0'),
      String(thursday.getUTCDate()).padStart(2,'0')
    ].join('-');
  }

  function professorSendState(now=Date.now()) {
    const entries=normalizeLogbook(progress?.logbook||[]);
    const unsent=entries.filter(entry=>!entry.sentAt);
    const cycleKey=professorCycleKey(now);
    const hasDueEntry=unsent.some(entry=>professorDateKey(entry.at)<=cycleKey);
    const due=Boolean(
      appData?.settings?.whatsappPhone &&
      unsent.length &&
      hasDueEntry &&
      String(progress?.lastProfessorSentCycle||'')!==cycleKey
    );
    return { entries, unsent, cycleKey, due };
  }

  function buildProfessorWeeklyText(entries) {
    const ordered=entries.slice().sort((a,b)=>a.at-b.at);
    const rows=ordered.map(entry=>{
      const date=`*${formatLogbookDate(entry.at)}*`;
      const match=String(entry.text||'').match(/^(\[Etapa\s+\d+(?:\.\d+)?\])\s*(.*)$/i);
      if(match) return `${date} ${match[1]} - ${match[2]}`;
      return `${date} - ${entry.text}`;
    });
    const averageMinutes=ordered.length ? Math.round(ordered.reduce((sum,entry)=>sum+Number(entry.durationSeconds||0),0)/ordered.length/60) : 0;
    const withConcentration=ordered.filter(entry=>entry.concentration!=null);
    const averageConcentration=withConcentration.length ? Math.round(withConcentration.reduce((sum,entry)=>sum+Number(entry.concentration),0)/withConcentration.length) : 0;
    return `Diário de Bordo\nMédia: ${averageMinutes} minutos, ${averageConcentration}% concentração\n\n${rows.join('\n\n')}`;
  }

  async function markProfessorLogbookSent(entries, cycleKey) {
    const ids=new Set(entries.map(entry=>String(entry.id)));
    const sentAt=Date.now();
    progress.logbook=normalizeLogbook((progress.logbook||[]).map(raw=>{
      const entry=normalizeLogbookRecord(raw);
      if(!entry) return raw;
      return ids.has(String(entry.id)) ? {...entry,sentAt} : entry;
    }));
    progress.lastProfessorSentCycle=cycleKey;

    for(const state of Object.values(progress?.stages||{})) {
      for(const session of state?.sessions||[]) {
        if(ids.has(String(session?.id||''))) session.sharedAt=sentAt;
      }
    }

    await saveProgress({immediate:true});
    renderLogbook();
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
    if (stage === progress.currentStage && progress.currentStage < lastStage()) {
      progress.currentStage += 1;
      advanced = true;
    }
    return { completed:true, advanced };
  }

  function regressForInactivity() {
    const from = Number(progress.currentStage || 1);
    if (from <= 1) return { regressed:false };
    const days = Math.max(1, Number(config(from).deadlineDays || 1));
    const latest = latestValidPracticeAt();
    const resetAnchor = Number(progress.inactivityAnchorAt || 0);
    const anchor = Math.max(latest, resetAnchor);
    if (!anchor || Date.now() - anchor < days * DAY_MS) return { regressed:false };

    const to = from - 1;
    progress.currentStage = to;
    for (let stage = to; stage <= lastStage(); stage += 1) stageState(stage).completedAt = null;
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
    if (refreshed.changed || completed) saveProgress({ immediate:true });
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

  function journeyViewBox() {
    const box = el.journeySvg?.viewBox?.baseVal;
    return {
      width: Number(box?.width || 1000),
      height: Number(box?.height || 1400)
    };
  }

  function catmullRomPath(points) {
    if (points.length < 2) return '';
    let d = `M${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x} ${p2.y}`;
    }
    return d;
  }

  function journeyGeometry() {
    const total = totalStages();
    if (total <= 9) return { path:BASE_JOURNEY_PATH, viewHeight:1400, extraCurves:0 };
    const extraCurves = Math.ceil((total - 9) / 4);
    const turns = 4 + extraCurves;
    const viewHeight = 1400 + extraCurves * 420;
    const bottom = viewHeight - 175;
    const top = 95;
    const usable = bottom - top;
    const points = [{ x:260, y:bottom }];
    for (let i = 1; i <= turns; i += 1) {
      points.push({
        x: i % 2 ? 735 : 250,
        y: Math.round(bottom - usable * (i / (turns + 1)))
      });
    }
    points.push({ x:760, y:top });
    return { path:catmullRomPath(points), viewHeight, extraCurves };
  }

  function renderStageMarkers() {
    if (!el.journey) return;
    el.journey.querySelectorAll('.stage').forEach(button => button.remove());
    const fragment = document.createDocumentFragment();
    for (let stage = 1; stage <= totalStages(); stage += 1) {
      const button = document.createElement('button');
      button.className = 'stage future';
      button.type = 'button';
      button.dataset.stage = String(stage);
      button.setAttribute('aria-label', `Abrir etapa ${stage}`);
      button.innerHTML = `<span>${stage}</span>`;
      fragment.appendChild(button);
    }
    el.journey.insertBefore(fragment, el.elephant);
    el.stages = [...el.journey.querySelectorAll('.stage')];
  }

  function configureJourneyGeometry() {
    if (!el.journeySvg) return;
    const geometry = journeyGeometry();
    el.journeySvg.setAttribute('viewBox', `0 0 1000 ${geometry.viewHeight}`);
    document.querySelectorAll('.path-shadow,.path-line,.path-glow').forEach(path => path.setAttribute('d', geometry.path));
    const shell = document.getElementById('appShell');
    if (geometry.extraCurves > 0) {
      const height = Math.max(window.innerHeight, window.innerHeight + geometry.extraCurves * 320);
      shell?.classList.add('dynamic-journey');
      document.body.classList.add('dynamic-journey-scroll');
      shell?.style.setProperty('--journey-height', `${height}px`);
    } else {
      shell?.classList.remove('dynamic-journey');
      document.body.classList.remove('dynamic-journey-scroll');
      shell?.style.removeProperty('--journey-height');
      window.scrollTo(0, 0);
    }
    renderStageMarkers();
  }

  function rebuildUniformJourneyLayout() {
    const path = document.querySelector('.path-line');
    const svg = el.journeySvg;
    if (!path || !svg || typeof path.getTotalLength !== 'function') return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const view = journeyViewBox();
    const pathLength = path.getTotalLength(), sampleCount = Math.max(900, totalStages() * 80), scaleX = rect.width/view.width, scaleY = rect.height/view.height;
    let visualDistance = 0, previous = null;
    const samples = [];
    for (let i=0;i<=sampleCount;i+=1) {
      const length = pathLength * (i/sampleCount), point = path.getPointAtLength(length);
      if (previous) visualDistance += Math.hypot((point.x-previous.x)*scaleX,(point.y-previous.y)*scaleY);
      samples.push({ length, x:point.x, y:point.y, visualDistance }); previous = point;
    }
    journeySamples = samples; journeyVisualLength = visualDistance;
    const total = totalStages(), denominator = Math.max(1, total - 1);
    for (let stage=1; stage<=total; stage+=1) {
      const pos = pointOnJourneyVisual((stage-1)/denominator); stagePositions[stage] = pos;
      const button = el.stages.find(item => Number(item.dataset.stage) === stage);
      if (button) { button.style.left=`${pos.left}%`; button.style.top=`${pos.top}%`; }
    }
  }

  function pointOnJourneyVisual(progressRatio) {
    const ratio = Math.max(0,Math.min(1,Number(progressRatio || 0)));
    if (!journeySamples.length || !journeyVisualLength) {
      const a=stagePositions[1] || {left:26,top:87.5}, b=stagePositions[lastStage()] || a; return { left:a.left+(b.left-a.left)*ratio, top:a.top+(b.top-a.top)*ratio };
    }
    const target=journeyVisualLength*ratio; let low=0, high=journeySamples.length-1;
    while(low<high){const mid=Math.floor((low+high)/2); if(journeySamples[mid].visualDistance<target) low=mid+1; else high=mid;}
    const after=journeySamples[low], before=journeySamples[Math.max(0,low-1)], span=Math.max(.0001,after.visualDistance-before.visualDistance);
    const local=Math.max(0,Math.min(1,(target-before.visualDistance)/span));
    const x=before.x+(after.x-before.x)*local, y=before.y+(after.y-before.y)*local;
    const view=journeyViewBox();
    return { left:(x/view.width)*100, top:(y/view.height)*100 };
  }

  function currentPosition() {
    const stage = progress.currentStage, total = totalStages(), last = lastStage();
    if (total <= 1) return { ...(stagePositions[1] || {left:26,top:87.5}), stage:1 };
    if (stage >= last && stageState(last).completedAt) return { ...stagePositions[last], stage:last };
    const cfg = config(stage), count = completedCount(stage), ratio = Math.max(0, Math.min(1, count/cfg.sessionsRequired));
    const pathRatio = ((stage-1)+ratio)/Math.max(1,total-1);
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
    const last = lastStage(), total = totalStages();
    const cfg = config(current), count = completedCount(current), allDone = current === last && Boolean(stageState(last).completedAt);
    const pos = currentPosition();
    el.elephant.style.left = `${pos.left}%`; el.elephant.style.top = `${pos.top}%`;
    const nextPos = stagePositions[Math.min(last,current+1)], face = nextPos && nextPos.left > pos.left ? -1 : 1;
    el.elephant.style.setProperty('--face', face);
    el.elephant.className = `elephant stage-${current}${current >= 6 ? ' stage-late' : ''}${animateAdvance ? ' walking journey-elephant-progress-glow' : ''}`;
    if (animateAdvance) setTimeout(()=>el.elephant.classList.remove('walking','journey-elephant-progress-glow'),1900);

    el.stages.forEach(btn => {
      const n=Number(btn.dataset.stage); btn.classList.remove('current','done','future');
      if (allDone || n < current) btn.classList.add('done'); else if (n === current) btn.classList.add('current'); else btn.classList.add('future');
      btn.setAttribute('aria-disabled', n > current ? 'true' : 'false');
    });

    el.homeStatus.textContent = allDone ? 'Caminho concluído' : `Etapa ${current} de ${total}`;
    el.unitName.textContent = `Etapa ${current} – ${cfg.unitName}`;
    el.objective.textContent = cfg.objective || '';
    el.miniProgress.textContent = allDone ? `${total} etapas concluídas` : `${count}/${cfg.sessionsRequired} · ${cfg.deadlineDays} dias`;
    el.continuePath.textContent = allDone ? `Rever etapa ${last}` : 'Abrir etapa';
    if (animateAdvance && document.getElementById('appShell')?.classList.contains('dynamic-journey')) {
      const targetY = Math.max(0, (pos.top / 100) * document.getElementById('appShell').offsetHeight - window.innerHeight * .48);
      window.scrollTo({ top:targetY, behavior:'smooth' });
    }
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
    document.dispatchEvent(new CustomEvent('shamatha:practice-preparing', { detail:{ hasAudio:Boolean(config().audioUrl) } }));
    document.getElementById('prepCopy')?.classList.add('departing'); document.getElementById('reviewVideoRow')?.classList.add('departing'); document.getElementById('backFromPreparation')?.classList.add('departing');
    await unlockAudio();
    sessionState='countdown';
    currentSession={id:`s_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,stage:selectedStage,sessionNumber:Math.min(completedCount()+1,config().sessionsRequired),startedAt:null,endedAt:null,elapsedSeconds:0,playbackSeconds:0,audioDuration:Number.isFinite(el.audio.duration)?el.audio.duration:0,endedEarly:false,paused:false,cuts:[]};
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
    if (cfg.audioUrl) document.dispatchEvent(new CustomEvent('shamatha:practice-started', { detail:{ hasAudio:true, sessionId:currentSession.id } }));
  }

  function formatCutTime(seconds) {
    const total=Math.max(0,Math.floor(Number(seconds||0))), min=Math.floor(total/60), sec=total%60;
    return `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  function renderCutMarkers() {
    const box=document.getElementById('cutMarkers');
    if(!box || !currentSession) return;
    const cuts=Array.isArray(currentSession.cuts)?currentSession.cuts:[];
    box.innerHTML=cuts.map((cut,index)=>{
      const time=formatCutTime(cut?.time);
      return `<span class="cut-marker" title="Corte ${index+1} em ${escapeHtml(time)}"><span aria-hidden="true">🔪</span><span>${escapeHtml(time)}</span></span>`;
    }).join('');
  }

  function renderActive() {
    const hasAudio=Boolean(config().audioUrl);
    const voiceMarker=hasAudio?'<div class="voice-cut-panel" id="voiceCutPanel"><div class="voice-cut-status" id="voiceCutStatus" role="status" aria-live="polite">Preparando marcador por voz…</div><div class="cut-markers" id="cutMarkers" aria-label="Cortes marcados nesta sessão"></div></div>':'';
    el.scroll.innerHTML=`<div class="view practice-active"><div class="active-center"><div class="active-breath ${currentSession.paused?'paused':''}" id="audioProgressRing" style="--audio-progress:0%"><button class="active-toggle" id="audioToggle" type="button" aria-label="${currentSession.paused?'Retomar áudio':'Pausar áudio'}"><span class="active-symbol">${currentSession.paused?'▶':'Ⅱ'}</span></button></div><p class="active-started"><strong>Prática iniciada</strong>${hasAudio?'Acompanhe o áudio e volte à respiração.':'A etapa está configurada como prática silenciosa.'}</p>${voiceMarker}</div><footer class="active-footer activity-visible" id="practiceEndFooter"><button class="danger" id="endSession">Encerrar prática</button></footer></div>`;
    document.getElementById('audioToggle').addEventListener('click',toggleAudio);
    document.getElementById('endSession').addEventListener('click',()=>endPractice(true));
    renderCutMarkers();
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

  async function saveCurrentSession() {
    if(!currentSession || currentSession.saved) return;
    const lucidityEl=document.getElementById('lucidity'), notesEl=document.getElementById('notes');
    if(!lucidityEl || lucidityEl.dataset.chosen!=='true'){showToast('Escolha o nível de concentração antes de salvar.');lucidityEl?.focus();return;}

    const savedStage=selectedStage;
    const cfg=config(savedStage), st=stageState(savedStage);
    const dateKey=localDateKey(currentSession.startedAt);
    const effectivePractice=cfg.audioUrl ? Number(currentSession.playbackSeconds||0) : Number(currentSession.elapsedSeconds||0);
    const valid=effectivePractice>=cfg.minSessionSeconds;
    const saved={...currentSession,dateKey,lucidity:Number(lucidityEl.value),notes:notesEl.value.trim(),valid,countedForProgress:false,savedAt:Date.now(),sharedAt:null};

    st.sessions.push(saved);
    appendLogbookEntry(saved,savedStage);
    if(valid) progress.inactivityAnchorAt=saved.savedAt;

    const refreshed=refreshWindowFlags(savedStage);
    currentSession={...saved,countedForProgress:Boolean(saved.countedForProgress),saved:true};

    if(refreshed.count>=cfg.sessionsRequired && !st.completedAt) completeStage(savedStage);

    const saveButton=document.getElementById('saveSession');
    saveButton.disabled=true;
    saveButton.textContent='⏳ aguarde';
    await saveProgress({immediate:true});
    updateHome({animateAdvance:Boolean(saved.countedForProgress) || savedStage!==progress.currentStage});

    closeUnit();
    openLogbook(savedStage);
  }

  function buildShareText(session) {
    const observation=(session.notes||'').trim(); return `Hoje meditei por ${formatRoundedDuration(session.elapsedSeconds)} e estimo ${session.lucidity}% de concentração.${observation?` ${observation}`:''}`;
  }

  function formatLogbookDate(value) {
    const date=new Date(logbookTime(value));
    if(!Number.isFinite(date.getTime())) return 'Data indisponível';
    return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(date);
  }

  function logbookProgressMarkup(stageNumber) {
    const maxStage=totalStages();
    const stage=Math.max(1,Math.min(maxStage,Number(stageNumber||progress?.currentStage||1)));
    const cfg=config(stage), st=stageState(stage);
    const count=completedCount(stage);
    const required=Math.max(1,Number(cfg.sessionsRequired||1));
    const pct=Math.max(0,Math.min(100,Math.round((count/required)*100)));
    const marks=Array.from({length:required+1},(_,index)=>{
      const left=required===0?0:(index/required)*100;
      return `<span class="progress-mark" style="left:${left}%"></span>`;
    }).join('');

    return `<section class="progress-card logbook-progress-card"><div class="logbook-progress-heading"><div><h3>Seu progresso</h3></div></div><div class="progress-line"><div class="progress-track"></div><div class="progress-fill" style="width:${pct}%"></div>${marks}<span class="progress-elephant" style="left:${pct}%">🐘</span></div><div class="progress-facts"><span><strong>${count} de ${required}</strong> sessões válidas nos últimos ${cfg.deadlineDays} dias</span></div></section>`;
  }

  function renderLogbook() {
    if(!el.logbookList) return;
    const state=professorSendState();
    const entries=state.entries.slice().sort((a,b)=>b.at-a.at);
    const progressMarkup=logbookProgressMarkup(logbookProgressStage || progress?.currentStage);

    const weeklyShare=state.due
      ? `<section class="logbook-weekly-share"><strong>Envio semanal ao professor</strong><p>${state.unsent.length===1?'Há 1 registro ainda não enviado.':`Há ${state.unsent.length} registros ainda não enviados.`} O envio reúne todos eles em uma única mensagem.</p><a class="whatsapp" id="logbookShareWhatsapp" target="_blank" rel="noopener">Enviar ao Professor</a></section>`
      : '';

    const recordsMarkup=entries.length
      ? entries.map(entry=>{
          const sentStatus=entry.sentAt ? '<div class="logbook-sent-status">✔️ enviado ao professor</div>' : '';
          return `<article class="logbook-entry"><div class="logbook-entry-head"><time datetime="${new Date(entry.at).toISOString()}">${escapeHtml(formatLogbookDate(entry.at))}</time></div><p class="logbook-entry-text">${escapeHtml(entry.text)}</p>${sentStatus}</article>`;
        }).join('')
      : '<div class="logbook-empty">Seu Diário de Bordo começa quando uma prática é registrada.</div>';

    el.logbookList.innerHTML=progressMarkup+weeklyShare+recordsMarkup;

    const share=document.getElementById('logbookShareWhatsapp');
    if(share){
      const message=buildProfessorWeeklyText(state.unsent);
      share.href=`https://api.whatsapp.com/send?phone=${encodeURIComponent(appData.settings.whatsappPhone)}&text=${encodeURIComponent(message)}`;
      share.addEventListener('click',()=>{share.textContent='⏳ aguarde';share.setAttribute('aria-disabled','true');markProfessorLogbookSent(state.unsent,state.cycleKey).catch(error=>{share.textContent='Enviar ao Professor';share.removeAttribute('aria-disabled');showToast(error.message);});});
    }
  }

  function openLogbook(stageNumber=progress?.currentStage) {
    logbookProgressStage=Math.max(1,Math.min(totalStages(),Number(stageNumber||progress?.currentStage||1)));
    renderLogbook();
    el.logbookModal?.classList.remove('hidden');
    document.body.style.overflow='hidden';
    setTimeout(()=>{const scroll=el.logbookModal?.querySelector('.logbook-scroll');if(scroll)scroll.scrollTop=0;},0);
  }

  function closeLogbook() {
    el.logbookModal?.classList.add('hidden');
    document.body.style.overflow='';
    logbookProgressStage=null;
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

  document.addEventListener('shamatha:cut-detected',event=>{
    if(sessionState!=='active' || !currentSession || !config().audioUrl || el.audio.paused || el.audio.ended) return;
    const time=Number(event.detail?.time);
    if(!Number.isFinite(time) || time<0) return;
    const cuts=Array.isArray(currentSession.cuts)?currentSession.cuts:[];
    const last=cuts[cuts.length-1];
    if(last && Math.abs(Number(last.time||0)-time)<0.8) return;
    cuts.push({time,detectedAt:Number(event.detail?.detectedAt||Date.now())});
    currentSession.cuts=cuts;
    saveActiveSession();
    renderCutMarkers();
  });

  document.addEventListener('shamatha:audio-ended',()=>{
    if(sessionState!=='active') return;
    showPracticeEndControl({ persistent:true, hideAfter:0 });
  });
  el.scroll.addEventListener('pointerdown',revealEndControlFromInteraction,{passive:true});
  el.scroll.addEventListener('keydown',revealEndControlFromInteraction);
  el.logbookButton?.addEventListener('click',()=>openLogbook());
  el.closeLogbook?.addEventListener('click',closeLogbook);
  el.logbookModal?.addEventListener('click',event=>{if(event.target===el.logbookModal)closeLogbook();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!el.logbookModal?.classList.contains('hidden'))closeLogbook();});

  el.continuePath.addEventListener('click',()=>{
    if(recoveredSessionPending&&currentSession){recoveredSessionPending=false;openUnit('reflection');showToast('A prática interrompida foi recuperada para registro.');return;}
    applyProgressRules(); selectedStage=progress.currentStage; openUnit(stageState().introDone?'practice':'intro');
  });
  el.close.addEventListener('click',closeUnit);
  el.modal.addEventListener('click',event=>{if(event.target===el.modal&&!['active','countdown'].includes(sessionState))closeUnit();});

  el.journey?.addEventListener('click',event=>{
    const btn=event.target.closest('.stage');
    if(!btn || !el.journey.contains(btn) || !progress)return;
    const stage=Number(btn.dataset.stage), current=progress.currentStage;
    if(stage>current){showToast(`A etapa ${stage} será liberada pelo avanço nas etapas anteriores.`);return;}
    selectedStage=stage;
    openUnit(stageState().introDone?'practice':'intro');
  });

  el.logout.addEventListener('click',async()=>{await api('/api/logout',{method:'POST',body:'{}'}).catch(()=>null);location.href='./index.html';});
  window.addEventListener('beforeunload',()=>{if(['active','countdown'].includes(sessionState))saveActiveSession();clearInterval(progressWatchTimer);clearTimeout(endControlTimer);});
  window.addEventListener('resize',()=>{clearTimeout(journeyLayoutTimer);journeyLayoutTimer=setTimeout(()=>{configureJourneyGeometry();rebuildUniformJourneyLayout();updateHome();},120);});

  async function init() {
    appData=await api('/api/app-data'); progress=appData.progress;
    reconcileLogbook();
    el.accountEmail.textContent=appData.user.email;
    if(appData.user.role==='editor')el.editorLink.classList.remove('hidden');
    const live=String(appData.settings.liveClassUrl||'').trim();
    if(live){el.liveClassBadge.href=live;el.liveClassBadge.classList.remove('hidden');el.liveClassBadge.setAttribute('aria-label',`Abrir aula ao vivo: ${live}`);}else{el.liveClassBadge.classList.add('hidden');}
    selectedStage=progress.currentStage; configureJourneyGeometry(); rebuildUniformJourneyLayout(); updateHome(); recoveredSessionPending=recoverInterruptedSession();
    progressWatchTimer=setInterval(()=>{if(progress && el.modal.classList.contains('hidden'))updateHome();},60000);
  }

  init().catch(error=>{
    showToast(error.message);
    window.ShamathaLoading?.finish?.();
  });
})();
