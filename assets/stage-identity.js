(() => {
  'use strict';

  const base = window.ShamathaBackend;
  if (!base?.request || !base?.getClient) return;

  const sb = base.getClient();
  const originalRequest = base.request.bind(base);
  const AUDIO_BUCKET = 'shamatha-audio';
  const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
  const SIGNED_SECONDS = 6 * 60 * 60;

  function fail(message, status = 400) {
    const error = new Error(message || 'Falha ao atualizar as etapas.');
    error.status = status;
    throw error;
  }

  function clone(value) {
    if (!value || typeof value !== 'object') return {};
    try { return structuredClone(value); }
    catch (_) { return JSON.parse(JSON.stringify(value)); }
  }

  function parseBody(options = {}) {
    if (!options.body) return {};
    if (typeof options.body === 'object') return options.body;
    try { return JSON.parse(options.body); }
    catch (_) { return fail('Dados enviados em formato inválido.'); }
  }

  function defaultStageState() {
    return {
      introStarted: false,
      introDone: false,
      videoPosition: 0,
      cycleStartedAt: null,
      sessions: [],
      completedAt: null
    };
  }

  function normalizeStageState(input) {
    const state = { ...defaultStageState(), ...(input && typeof input === 'object' ? clone(input) : {}) };
    state.sessions = Array.isArray(state.sessions) ? state.sessions.slice(-500) : [];
    return state;
  }

  async function identityRows() {
    const { data, error } = await sb.from('stages')
      .select('number,stage_id,position,is_active')
      .order('position', { ascending:true, nullsFirst:false })
      .order('number', { ascending:true });
    if (error) fail(error.message || 'Falha ao carregar a estrutura das etapas.');
    return data || [];
  }

  function decorateStage(stage, identity, runtimeNumber = null) {
    if (!stage || !identity) return stage;
    return {
      ...stage,
      number: runtimeNumber == null ? Number(identity.number) : Number(runtimeNumber),
      stageId: identity.stage_id,
      legacyNumber: Number(identity.number),
      position: identity.position == null ? null : Number(identity.position),
      isActive: Boolean(identity.is_active)
    };
  }

  function mergeStages(rawStages, identities) {
    const byLegacy = new Map((rawStages || []).map(stage => [Number(stage.number), stage]));
    const activeRows = identities
      .filter(row => row.is_active)
      .slice()
      .sort((a,b) => Number(a.position) - Number(b.position));
    const archivedRows = identities
      .filter(row => !row.is_active)
      .slice()
      .sort((a,b) => Number(b.number) - Number(a.number));

    const active = activeRows.map((row, index) => decorateStage(byLegacy.get(Number(row.number)) || {}, row, index + 1));
    const archived = archivedRows.map(row => decorateStage(byLegacy.get(Number(row.number)) || {}, row, null));
    return { active, archived, activeRows };
  }

  function statesByIdFromPersistent(raw, identities) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const states = source.stagesById && typeof source.stagesById === 'object'
      ? clone(source.stagesById)
      : {};

    const legacyStates = source.stages && typeof source.stages === 'object' ? source.stages : {};
    const byLegacy = new Map(identities.map(row => [Number(row.number), row.stage_id]));
    for (const [key, value] of Object.entries(legacyStates)) {
      const stageId = byLegacy.get(Number(key));
      if (stageId && !states[stageId]) states[stageId] = normalizeStageState(value);
    }
    return states;
  }

  function currentRuntimePosition(activeStages, statesById) {
    if (!activeStages.length) return 1;
    const firstIncomplete = activeStages.findIndex(stage => !statesById[stage.stageId]?.completedAt);
    return firstIncomplete >= 0 ? firstIncomplete + 1 : activeStages.length;
  }

  function persistentToRuntime(raw, activeStages, identities) {
    const source = raw && typeof raw === 'object' ? clone(raw) : {};
    const statesById = statesByIdFromPersistent(source, identities);
    const runtimeStages = {};

    activeStages.forEach((stage, index) => {
      runtimeStages[index + 1] = normalizeStageState(statesById[stage.stageId]);
    });

    delete source.schemaVersion;
    delete source.currentStageId;
    delete source.stagesById;
    delete source.currentStage;
    delete source.stages;

    return {
      ...source,
      currentStage: currentRuntimePosition(activeStages, statesById),
      stages: runtimeStages,
      updatedAt: Date.now()
    };
  }

  function runtimeToPersistent(runtime, existing, activeStages, identities) {
    const runtimeSource = runtime && typeof runtime === 'object' ? clone(runtime) : {};
    const existingSource = existing && typeof existing === 'object' ? clone(existing) : {};
    const statesById = statesByIdFromPersistent(existingSource, identities);

    activeStages.forEach((stage, index) => {
      const runtimeState = runtimeSource.stages?.[index + 1] ?? runtimeSource.stages?.[String(index + 1)];
      if (runtimeState) statesById[stage.stageId] = normalizeStageState(runtimeState);
      else if (!statesById[stage.stageId]) statesById[stage.stageId] = defaultStageState();
    });

    const meta = { ...existingSource, ...runtimeSource };
    delete meta.currentStage;
    delete meta.stages;
    delete meta.schemaVersion;
    delete meta.currentStageId;
    delete meta.stagesById;

    const requested = Math.max(1, Math.min(activeStages.length || 1, Number(runtimeSource.currentStage || 1)));
    return {
      ...meta,
      schemaVersion: 2,
      currentStageId: activeStages[requested - 1]?.stageId || null,
      stagesById,
      updatedAt: Number(runtimeSource.updatedAt || Date.now())
    };
  }

  async function rawProgressFor(userId) {
    const { data, error } = await sb.from('progress').select('data').eq('user_id', userId).maybeSingle();
    if (error) fail(error.message || 'Falha ao carregar o progresso.');
    return data?.data && typeof data.data === 'object' ? data.data : {};
  }

  async function persistProgress(userId, data) {
    const { error } = await sb.from('progress').upsert({
      user_id: userId,
      data,
      updated_at: new Date().toISOString()
    }, { onConflict:'user_id' });
    if (error) fail(error.message || 'Falha ao salvar o progresso.');
  }

  async function appData(options) {
    const data = await originalRequest('/api/app-data', options);
    const identities = await identityRows();
    const merged = mergeStages(data.stages, identities);
    if (!merged.active.length) fail('O caminho precisa ter pelo menos uma etapa ativa.');
    data.stages = merged.active;

    if (data.user?.role === 'editor') {
      data.progress = persistentToRuntime({}, merged.active, identities);
      return data;
    }

    const auth = await sb.auth.getUser();
    const userId = auth.data?.user?.id;
    if (!userId) fail('Sessão encerrada.', 401);
    const raw = await rawProgressFor(userId);
    const runtime = persistentToRuntime(raw, merged.active, identities);
    data.progress = runtime;

    if (Number(raw?.schemaVersion || 0) !== 2 || raw?.stages || raw?.currentStage != null) {
      await persistProgress(userId, runtimeToPersistent(runtime, raw, merged.active, identities));
    }
    return data;
  }

  async function editorData(options) {
    const data = await originalRequest('/api/editor/data', options);
    const identities = await identityRows();
    const merged = mergeStages(data.stages, identities);
    return {
      ...data,
      stages: merged.active,
      archivedStages: merged.archived
    };
  }

  async function saveProgress(options) {
    const body = parseBody(options);
    const auth = await sb.auth.getUser();
    const userId = auth.data?.user?.id;
    if (!userId) fail('Sessão encerrada.', 401);

    const identities = await identityRows();
    const currentData = await originalRequest('/api/app-data');
    const merged = mergeStages(currentData.stages, identities);
    const existing = await rawProgressFor(userId);
    const persistent = runtimeToPersistent(body.progress, existing, merged.active, identities);
    await persistProgress(userId, persistent);
    return { ok:true, updatedAt:persistent.updatedAt };
  }

  async function identityAtPosition(position) {
    const identities = await identityRows();
    const activeRows = identities.filter(row => row.is_active).sort((a,b) => Number(a.position) - Number(b.position));
    const identity = activeRows[Number(position) - 1];
    if (!identity) fail('Etapa ativa não encontrada.', 404);
    return identity;
  }

  async function decorateStageResponse(result, identity, position) {
    if (!result?.stage) return result;
    return { ...result, stage:decorateStage(result.stage, identity, position) };
  }

  function audioInfo(file) {
    if (!(file instanceof Blob) || !file.size) fail('Escolha um arquivo de áudio.');
    if (file.size > MAX_AUDIO_BYTES) fail('O arquivo de áudio pode ter até 100 MB.');
    const nameExt = String(file.name || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
    const mimeToExt = {
      'audio/mpeg':'mp3', 'audio/mp4':'m4a', 'audio/x-m4a':'m4a', 'audio/aac':'aac',
      'audio/ogg':'ogg', 'audio/wav':'wav', 'audio/x-wav':'wav', 'audio/webm':'webm'
    };
    const ext = ['mp3','m4a','aac','ogg','wav','webm'].includes(nameExt) ? nameExt : mimeToExt[String(file.type || '').toLowerCase()];
    if (!ext) fail('Use um arquivo MP3, M4A, AAC, OGG, WAV ou WEBM.');
    const extToMime = { mp3:'audio/mpeg', m4a:'audio/mp4', aac:'audio/aac', ogg:'audio/ogg', wav:'audio/wav', webm:'audio/webm' };
    return { ext, contentType:extToMime[ext] };
  }

  function rowToStage(row, audioUrl = '') {
    return {
      number: Number(row.number),
      stageName: row.stage_name || '',
      unitName: row.unit_name || '',
      objective: row.objective || '',
      sessionsRequired: Number(row.sessions_required || 3),
      deadlineDays: Number(row.deadline_days || 7),
      minSessionSeconds: Number(row.min_session_seconds || 300),
      videoUrl: row.video_url || '',
      audioUrl: audioUrl || row.audio_url || '',
      audioPath: row.audio_path || '',
      audioName: row.audio_name || ''
    };
  }

  async function signedStage(row) {
    let audioUrl = row.audio_url || '';
    if (row.audio_path) {
      const signed = await sb.storage.from(AUDIO_BUCKET).createSignedUrl(row.audio_path, SIGNED_SECONDS);
      if (signed.error) fail(signed.error.message || 'Falha ao liberar o áudio da prática.');
      audioUrl = signed.data?.signedUrl || '';
    }
    return rowToStage(row, audioUrl);
  }

  async function uploadAudio(position, options) {
    const identity = await identityAtPosition(position);
    const file = parseBody(options).file;
    const info = audioInfo(file);
    const current = await sb.from('stages').select('*').eq('number', identity.number).single();
    if (current.error) fail(current.error.message || 'Etapa não encontrada.');

    const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const path = `stage-${identity.stage_id}/${token}.${info.ext}`;
    const upload = await sb.storage.from(AUDIO_BUCKET).upload(path, file, {
      cacheControl:'3600', upsert:false, contentType:info.contentType
    });
    if (upload.error) fail(upload.error.message || 'Falha no upload do áudio.');

    const saved = await sb.from('stages').update({
      audio_path:path,
      audio_name:String(file.name || `audio-etapa-${position}.${info.ext}`).slice(0, 240),
      audio_url:'',
      updated_at:new Date().toISOString()
    }).eq('number', identity.number).select('*').single();

    if (saved.error) {
      await sb.storage.from(AUDIO_BUCKET).remove([path]).catch(() => null);
      fail(saved.error.message || 'Falha ao associar o áudio à etapa.');
    }
    if (current.data?.audio_path && current.data.audio_path !== path) {
      await sb.storage.from(AUDIO_BUCKET).remove([current.data.audio_path]).catch(() => null);
    }

    const stage = await signedStage(saved.data);
    return { stage:decorateStage(stage, identity, position) };
  }

  async function addStage() {
    const result = await sb.rpc('add_shamatha_stage');
    if (result.error) fail(result.error.message || 'Falha ao adicionar a etapa.');
    const fresh = await editorData();
    const stageId = Array.isArray(result.data) ? result.data[0]?.stage_id : result.data?.stage_id;
    const stage = fresh.stages.find(item => item.stageId === stageId) || fresh.stages[fresh.stages.length - 1];
    if (!stage) fail('A nova etapa não pôde ser carregada.');
    return { stage };
  }

  async function reorderStages(options) {
    const ids = parseBody(options).stageIds;
    if (!Array.isArray(ids) || !ids.length) fail('Informe a nova ordem das etapas.');
    const result = await sb.rpc('reorder_shamatha_stages', { p_stage_ids:ids });
    if (result.error) fail(result.error.message || 'Falha ao reordenar as etapas.');
    return { ok:true };
  }

  async function archiveStage(options) {
    const stageId = String(parseBody(options).stageId || '');
    if (!stageId) fail('Etapa inválida.');
    const result = await sb.rpc('archive_shamatha_stage', { p_stage_id:stageId });
    if (result.error) fail(result.error.message || 'Falha ao remover a etapa do caminho.');
    return { ok:true, stageId };
  }

  async function restoreStage(options) {
    const stageId = String(parseBody(options).stageId || '');
    if (!stageId) fail('Etapa inválida.');
    const result = await sb.rpc('restore_shamatha_stage', { p_stage_id:stageId });
    if (result.error) fail(result.error.message || 'Falha ao restaurar a etapa.');
    return { ok:true, stageId };
  }

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();

    if (path === '/api/app-data' && method === 'GET') return appData(options);
    if (path === '/api/editor/data' && method === 'GET') return editorData(options);
    if (path === '/api/progress' && method === 'PUT') return saveProgress(options);
    if (path === '/api/editor/stages' && method === 'POST') return addStage();
    if (path === '/api/editor/stage-order' && method === 'PUT') return reorderStages(options);
    if (path === '/api/editor/stage-archive' && method === 'POST') return archiveStage(options);
    if (path === '/api/editor/stage-restore' && method === 'POST') return restoreStage(options);

    const audioMatch = path.match(/^\/api\/editor\/stages\/(\d+)\/audio$/);
    if (audioMatch && method === 'POST') return uploadAudio(Number(audioMatch[1]), options);
    if (audioMatch && method === 'DELETE') {
      const position = Number(audioMatch[1]);
      const identity = await identityAtPosition(position);
      return decorateStageResponse(
        await originalRequest(`/api/editor/stages/${identity.number}/audio`, options),
        identity,
        position
      );
    }

    const stageMatch = path.match(/^\/api\/editor\/stages\/(\d+)$/);
    if (stageMatch && method === 'PUT') {
      const position = Number(stageMatch[1]);
      const identity = await identityAtPosition(position);
      return decorateStageResponse(
        await originalRequest(`/api/editor/stages/${identity.number}`, options),
        identity,
        position
      );
    }

    return originalRequest(path, options);
  }

  window.ShamathaBackend = Object.freeze({ ...base, request });
})();
