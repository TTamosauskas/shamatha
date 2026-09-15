(() => {
  'use strict';

  const base = window.ShamathaBackend;
  if (!base?.request || !base?.getClient) return;

  const sb = base.getClient();
  const originalRequest = base.request.bind(base);
  const AUDIO_BUCKET = 'shamatha-audio';
  const SIGNED_SECONDS = 6 * 60 * 60;
  const CACHE_MS = 5000;
  const DAY_MS = 86400000;
  const TZ = 'America/Sao_Paulo';

  let cachedData = null;
  let cachedAt = 0;
  let appDataPromise = null;
  const childAudioCache = new Map();

  function fail(message, status = 400) {
    const error = new Error(message || 'Falha ao carregar o aplicativo.');
    error.status = status;
    throw error;
  }

  function clone(value) {
    if (!value || typeof value !== 'object') return {};
    try { return structuredClone(value); }
    catch (_) { return JSON.parse(JSON.stringify(value)); }
  }

  function defaultState() {
    return {
      introStarted:false,
      introDone:false,
      videoPosition:0,
      cycleStartedAt:null,
      sessions:[],
      completedAt:null
    };
  }

  function normalizeState(value) {
    const state = { ...defaultState(), ...(value && typeof value === 'object' ? clone(value) : {}) };
    state.sessions = Array.isArray(state.sessions) ? state.sessions.slice(-500) : [];
    return state;
  }

  function dayOrdinal(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone:TZ, year:'numeric', month:'2-digit', day:'2-digit'
    }).formatToParts(date);
    const map = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    return Math.floor(Date.UTC(map.year, map.month - 1, map.day) / DAY_MS);
  }

  function stageStateMap(raw, rootRows) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const states = source.stagesById && typeof source.stagesById === 'object'
      ? clone(source.stagesById)
      : {};
    const legacy = source.stages && typeof source.stages === 'object' ? source.stages : {};
    const idByLegacy = new Map(rootRows.map(row => [Number(row.number), row.stage_id]));

    for (const [key, value] of Object.entries(legacy)) {
      const id = idByLegacy.get(Number(key));
      if (id && !states[id]) states[id] = normalizeState(value);
    }
    for (const row of rootRows) {
      if (!states[row.stage_id]) states[row.stage_id] = defaultState();
      else states[row.stage_id] = normalizeState(states[row.stage_id]);
    }
    return states;
  }

  function currentPosition(activeRoots, states) {
    if (!activeRoots.length) return 1;
    const index = activeRoots.findIndex(row => !states[row.stage_id]?.completedAt);
    return index >= 0 ? index + 1 : activeRoots.length;
  }

  function runtimeProgress(raw, activeRoots, states, childUnlocks) {
    const meta = raw && typeof raw === 'object' ? clone(raw) : {};
    delete meta.schemaVersion;
    delete meta.currentStageId;
    delete meta.stagesById;
    delete meta.currentStage;
    delete meta.stages;
    meta.childUnlocks = childUnlocks;

    const stages = {};
    activeRoots.forEach((row, index) => {
      stages[index + 1] = normalizeState(states[row.stage_id]);
    });

    return {
      ...meta,
      currentStage:currentPosition(activeRoots, states),
      stages,
      updatedAt:Date.now()
    };
  }

  function persistentProgress(raw, activeRoots, states, childUnlocks) {
    const runtimePosition = currentPosition(activeRoots, states);
    const meta = raw && typeof raw === 'object' ? clone(raw) : {};
    delete meta.currentStage;
    delete meta.stages;
    delete meta.schemaVersion;
    delete meta.currentStageId;
    delete meta.stagesById;
    return {
      ...meta,
      schemaVersion:2,
      currentStageId:activeRoots[runtimePosition - 1]?.stage_id || null,
      stagesById:states,
      childUnlocks,
      updatedAt:Date.now()
    };
  }

  function publicUser(profile) {
    const status = profile.access_status || (profile.access_granted ? 'approved' : 'pending');
    return {
      id:profile.id,
      email:profile.email,
      role:profile.role === 'editor' ? 'editor' : 'user',
      accessGranted:status === 'approved',
      accessStatus:status,
      isOwner:Boolean(profile.is_owner),
      createdAt:profile.created_at ? new Date(profile.created_at).getTime() : Date.now()
    };
  }

  function rootStage(row, position, audioUrl) {
    return {
      number:position,
      legacyNumber:Number(row.number),
      stageId:row.stage_id,
      position,
      isActive:Boolean(row.is_active),
      stageName:row.stage_name || '',
      unitName:row.unit_name || '',
      objective:row.objective || '',
      sessionsRequired:Number(row.sessions_required || 3),
      deadlineDays:Number(row.deadline_days || 7),
      minSessionSeconds:Number(row.min_session_seconds || 300),
      videoUrl:row.video_url || '',
      audioUrl:audioUrl || row.audio_url || '',
      audioPath:row.audio_path || '',
      audioName:row.audio_name || ''
    };
  }

  async function signedRootAudio(activeRoots) {
    const paths = [...new Set(activeRoots.map(row => String(row.audio_path || '')).filter(Boolean))];
    const byPath = new Map();
    if (!paths.length) return byPath;

    const multi = await sb.storage.from(AUDIO_BUCKET).createSignedUrls(paths, SIGNED_SECONDS);
    if (!multi.error && Array.isArray(multi.data)) {
      paths.forEach((path, index) => {
        const item = multi.data[index];
        if (item?.signedUrl) byPath.set(path, item.signedUrl);
      });
      return byPath;
    }

    await Promise.all(paths.map(async path => {
      const one = await sb.storage.from(AUDIO_BUCKET).createSignedUrl(path, SIGNED_SECONDS);
      if (one.data?.signedUrl) byPath.set(path, one.data.signedUrl);
    }));
    return byPath;
  }

  function decorateChildren(rows, activeRoots, rootStages, unlocks) {
    const rootById = new Map(activeRoots.map((row, index) => [row.stage_id, {
      row,
      stage:rootStages[index],
      position:index + 1
    }]));
    const activeChildren = rows
      .filter(row => row.parent_stage_id && row.is_active && rootById.has(row.parent_stage_id))
      .slice()
      .sort((a,b) =>
        Number(a.release_day || 1) - Number(b.release_day || 1) ||
        Number(a.child_position || 1) - Number(b.child_position || 1) ||
        Number(a.number) - Number(b.number)
      );

    const siblings = new Map();
    for (const row of activeChildren) {
      if (!siblings.has(row.parent_stage_id)) siblings.set(row.parent_stage_id, []);
      siblings.get(row.parent_stage_id).push(row);
    }

    return activeChildren.map(row => {
      const parent = rootById.get(row.parent_stage_id);
      const group = siblings.get(row.parent_stage_id) || [];
      const index = Math.max(1, group.findIndex(item => item.stage_id === row.stage_id) + 1);
      const hasOwnPath = Boolean(row.audio_path);
      const directOwnAudio = hasOwnPath ? '' : (row.audio_url || '');
      const hasOwnAudio = hasOwnPath || Boolean(directOwnAudio);
      return {
        stageId:row.stage_id,
        legacyNumber:Number(row.number),
        parentStageId:row.parent_stage_id,
        parentPosition:parent.position,
        parentUnitName:parent.stage.unitName || '',
        childPosition:Number(row.child_position || index),
        childIndex:index,
        displayCode:`${parent.position}.${index}`,
        releaseDay:Math.max(1, Number(row.release_day || 1)),
        isActive:true,
        stageName:row.stage_name || 'Aula de apoio',
        unitName:row.unit_name || 'Nova aula',
        objective:row.objective || '',
        videoUrl:row.video_url || '',
        ownAudioPath:row.audio_path || '',
        ownAudioName:row.audio_name || '',
        ownAudioUrl:directOwnAudio,
        audioUrl:hasOwnAudio ? directOwnAudio : (parent.stage.audioUrl || ''),
        audioNeedsResolve:hasOwnPath,
        inheritsAudio:!hasOwnAudio && Boolean(parent.stage.audioUrl),
        parentDeadlineDays:Math.max(1, Number(parent.stage.deadlineDays || row.deadline_days || 1)),
        unlocked:Boolean(unlocks[row.stage_id]),
        unlockedAt:Number(unlocks[row.stage_id] || 0)
      };
    });
  }

  function updateUnlocks(raw, rows, activeRoots, states) {
    const unlocks = raw?.childUnlocks && typeof raw.childUnlocks === 'object'
      ? clone(raw.childUnlocks)
      : {};
    const activeRootIds = new Set(activeRoots.map(row => row.stage_id));
    const today = dayOrdinal(Date.now());
    let changed = false;

    const current = currentPosition(activeRoots, states);
    const currentRoot = activeRoots[current - 1];
    if (currentRoot) {
      const state = states[currentRoot.stage_id] || (states[currentRoot.stage_id] = defaultState());
      if (!Number(state.activatedAt || 0)) {
        state.activatedAt = Date.now();
        changed = true;
      }
    }

    for (const row of rows) {
      if (!row.parent_stage_id || !row.is_active || !activeRootIds.has(row.parent_stage_id) || unlocks[row.stage_id]) continue;
      const parentState = states[row.parent_stage_id] || {};
      let unlock = Boolean(parentState.completedAt);
      const activatedAt = Number(parentState.activatedAt || 0);
      if (!unlock && activatedAt) {
        const activatedDay = dayOrdinal(activatedAt);
        const practiceDay = activatedDay == null || today == null ? 1 : (today - activatedDay + 1);
        unlock = practiceDay >= Math.max(1, Number(row.release_day || 1));
      }
      if (unlock) {
        unlocks[row.stage_id] = Date.now();
        changed = true;
      }
    }

    return { unlocks, changed };
  }

  async function loadFreshAppData() {
    const sessionResult = await sb.auth.getSession();
    const authUser = sessionResult.data?.session?.user;
    if (!authUser) fail('Sessão encerrada.', 401);

    const profileQuery = sb.from('profiles')
      .select('id,email,role,access_granted,access_status,is_owner,created_at')
      .eq('id', authUser.id)
      .maybeSingle();
    const stagesQuery = sb.from('stages')
      .select('number,stage_id,position,parent_stage_id,child_position,release_day,is_active,stage_name,unit_name,objective,sessions_required,deadline_days,min_session_seconds,video_url,audio_url,audio_path,audio_name,updated_at')
      .order('number', { ascending:true });
    const settingsQuery = sb.from('settings')
      .select('whatsapp_phone,live_class_url')
      .eq('id', 1)
      .maybeSingle();
    const progressQuery = sb.from('progress')
      .select('data')
      .eq('user_id', authUser.id)
      .maybeSingle();

    const [profileResult, stagesResult, settingsResult, progressResult] = await Promise.all([
      profileQuery, stagesQuery, settingsQuery, progressQuery
    ]);

    if (profileResult.error) fail(profileResult.error.message || 'Falha ao carregar o perfil.');
    if (!profileResult.data) fail('Perfil da conta não encontrado.', 409);
    const profile = profileResult.data;
    const status = profile.access_status || (profile.access_granted ? 'approved' : 'pending');
    if (profile.role !== 'editor' && status !== 'approved') fail('Seu acesso ao conteúdo aguarda a liberação do editor.', 403);
    if (stagesResult.error) fail(stagesResult.error.message || 'Falha ao carregar as etapas.');
    if (settingsResult.error) fail(settingsResult.error.message || 'Falha ao carregar as configurações.');
    if (progressResult.error && profile.role !== 'editor') fail(progressResult.error.message || 'Falha ao carregar o progresso.');

    const rows = stagesResult.data || [];
    const rootRows = rows.filter(row => !row.parent_stage_id);
    const activeRoots = rootRows
      .filter(row => row.is_active)
      .slice()
      .sort((a,b) => Number(a.position ?? a.number) - Number(b.position ?? b.number));
    if (!activeRoots.length) fail('O caminho precisa ter pelo menos uma etapa ativa.');

    const raw = profile.role === 'editor' ? {} : (progressResult.data?.data && typeof progressResult.data.data === 'object' ? clone(progressResult.data.data) : {});
    const states = stageStateMap(raw, rootRows);
    const unlockState = updateUnlocks(raw, rows, activeRoots, states);
    const needsMigration = profile.role !== 'editor' && (
      !progressResult.data ||
      Number(raw.schemaVersion || 0) !== 2 ||
      Boolean(raw.stages) ||
      raw.currentStage != null ||
      unlockState.changed
    );

    if (needsMigration) {
      const persistent = persistentProgress(raw, activeRoots, states, unlockState.unlocks);
      const saved = await sb.from('progress').upsert({
        user_id:authUser.id,
        data:persistent,
        updated_at:new Date().toISOString()
      }, { onConflict:'user_id' });
      if (saved.error) fail(saved.error.message || 'Falha ao preparar o progresso.');
    }

    const signed = await signedRootAudio(activeRoots);
    const stages = activeRoots.map((row, index) =>
      rootStage(row, index + 1, signed.get(String(row.audio_path || '')) || row.audio_url || '')
    );
    const progress = profile.role === 'editor'
      ? {
          currentStage:1,
          stages:Object.fromEntries(stages.map((_, index) => [index + 1, defaultState()])),
          childUnlocks:{},
          updatedAt:Date.now()
        }
      : runtimeProgress(raw, activeRoots, states, unlockState.unlocks);

    return {
      user:publicUser(profile),
      stages,
      settings:{
        liveClassUrl:'',
        whatsappPhone:settingsResult.data?.whatsapp_phone || ''
      },
      progress,
      childStages:decorateChildren(rows, activeRoots, stages, unlockState.unlocks),
      nextLiveClass:null,
      push:{ publicKey:'' }
    };
  }

  async function appData() {
    if (cachedData && Date.now() - cachedAt < CACHE_MS) return cachedData;
    if (appDataPromise) return appDataPromise;

    appDataPromise = loadFreshAppData()
      .then(data => {
        cachedData = data;
        cachedAt = Date.now();
        return data;
      })
      .finally(() => { appDataPromise = null; });
    return appDataPromise;
  }

  async function childAudio(stageId) {
    const cached = childAudioCache.get(stageId);
    if (cached && cached.expiresAt > Date.now()) return { audioUrl:cached.audioUrl };

    const result = await sb.from('stages')
      .select('stage_id,parent_stage_id,audio_path,audio_url')
      .eq('stage_id', stageId)
      .not('parent_stage_id', 'is', null)
      .maybeSingle();
    if (result.error) fail(result.error.message || 'Falha ao carregar o áudio desta aula.');
    if (!result.data) fail('Etapa filha não encontrada.', 404);

    let audioUrl = result.data.audio_url || '';
    if (result.data.audio_path) {
      const signed = await sb.storage.from(AUDIO_BUCKET).createSignedUrl(result.data.audio_path, SIGNED_SECONDS);
      if (signed.error) fail(signed.error.message || 'Falha ao liberar o áudio desta aula.');
      audioUrl = signed.data?.signedUrl || '';
    }

    childAudioCache.set(stageId, {
      audioUrl,
      expiresAt:Date.now() + (SIGNED_SECONDS - 300) * 1000
    });
    return { audioUrl };
  }

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();

    if (path === '/api/app-data' && method === 'GET') return appData();

    const childAudioMatch = path.match(/^\/api\/child-stage-audio\/([0-9a-f-]{36})$/i);
    if (childAudioMatch && method === 'GET') return childAudio(childAudioMatch[1]);

    const result = await originalRequest(path, options);

    if (path === '/api/progress' && method === 'PUT' && cachedData && options.body) {
      try {
        const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
        if (body?.progress) cachedData.progress = body.progress;
        cachedAt = Date.now();
      } catch (_) {}
    }

    return result;
  }

  window.ShamathaBackend = Object.freeze({ ...base, request });
})();
