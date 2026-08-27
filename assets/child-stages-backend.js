(() => {
  'use strict';

  const base = window.ShamathaBackend;
  if (!base?.request || !base?.getClient) return;
  const sb = base.getClient();
  const originalRequest = base.request.bind(base);
  const AUDIO_BUCKET = 'shamatha-audio';
  const SIGNED_SECONDS = 6 * 60 * 60;
  const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
  const DAY_MS = 86400000;
  const CURITIBA_TZ = 'America/Sao_Paulo';

  function fail(message, status = 400) {
    const error = new Error(message || 'Falha ao atualizar a etapa filha.');
    error.status = status;
    throw error;
  }

  function parseBody(options = {}) {
    if (!options.body) return {};
    if (typeof options.body === 'object') return options.body;
    try { return JSON.parse(options.body); }
    catch (_) { return fail('Dados enviados em formato inválido.'); }
  }

  function stageRowsQuery() {
    return sb.from('stages').select('number,stage_id,parent_stage_id,child_position,release_day,is_active,stage_name,unit_name,objective,deadline_days,min_session_seconds,video_url,audio_url,audio_path,audio_name,updated_at');
  }

  async function childRows() {
    const { data, error } = await stageRowsQuery().not('parent_stage_id', 'is', null).order('parent_stage_id').order('release_day').order('child_position').order('number');
    if (error) fail(error.message || 'Falha ao carregar etapas filhas.');
    return data || [];
  }

  async function rootIdentities() {
    const { data, error } = await sb.from('stages').select('stage_id,position,deadline_days,is_active,parent_stage_id').is('parent_stage_id', null).eq('is_active', true).order('position');
    if (error) fail(error.message || 'Falha ao carregar etapas principais.');
    return data || [];
  }

  async function rawProgressFor(userId) {
    const { data, error } = await sb.from('progress').select('data').eq('user_id', userId).maybeSingle();
    if (error) fail(error.message || 'Falha ao carregar o progresso.');
    return data?.data && typeof data.data === 'object' ? structuredClone(data.data) : {};
  }

  async function persistRawProgress(userId, data) {
    const { error } = await sb.from('progress').upsert({ user_id:userId, data, updated_at:new Date().toISOString() }, { onConflict:'user_id' });
    if (error) fail(error.message || 'Falha ao salvar o progresso.');
  }

  function dayOrdinal(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone:CURITIBA_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(date);
    const map = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    return Math.floor(Date.UTC(map.year, map.month - 1, map.day) / DAY_MS);
  }

  async function ensureChildUnlocks(data, rows, userId) {
    const raw = await rawProgressFor(userId);
    raw.schemaVersion = Math.max(2, Number(raw.schemaVersion || 0));
    raw.stagesById = raw.stagesById && typeof raw.stagesById === 'object' ? raw.stagesById : {};
    raw.childUnlocks = raw.childUnlocks && typeof raw.childUnlocks === 'object' ? raw.childUnlocks : {};
    let changed = false;

    const currentPosition = Math.max(1, Number(data?.progress?.currentStage || 1));
    const currentRoot = data?.stages?.[currentPosition - 1];
    if (currentRoot?.stageId) {
      const currentState = raw.stagesById[currentRoot.stageId] && typeof raw.stagesById[currentRoot.stageId] === 'object'
        ? raw.stagesById[currentRoot.stageId]
        : (raw.stagesById[currentRoot.stageId] = {});
      if (!Number(currentState.activatedAt || 0)) {
        currentState.activatedAt = Date.now();
        changed = true;
      }
    }

    const activeRootIds = new Set((data?.stages || []).map(stage => stage.stageId));
    const today = dayOrdinal(Date.now());
    for (const row of rows) {
      if (!row.is_active || !activeRootIds.has(row.parent_stage_id) || raw.childUnlocks[row.stage_id]) continue;
      const parentState = raw.stagesById[row.parent_stage_id] || {};
      let unlock = Boolean(parentState.completedAt);
      const activatedAt = Number(parentState.activatedAt || 0);
      if (!unlock && activatedAt) {
        const activatedDay = dayOrdinal(activatedAt);
        const practiceDay = activatedDay == null || today == null ? 1 : (today - activatedDay + 1);
        unlock = practiceDay >= Math.max(1, Number(row.release_day || 1));
      }
      if (unlock) {
        raw.childUnlocks[row.stage_id] = Date.now();
        changed = true;
      }
    }

    if (changed) await persistRawProgress(userId, raw);
    return raw.childUnlocks;
  }

  async function signedOwnAudio(row) {
    if (row.audio_path) {
      const signed = await sb.storage.from(AUDIO_BUCKET).createSignedUrl(row.audio_path, SIGNED_SECONDS);
      if (signed.error) fail(signed.error.message || 'Falha ao liberar o áudio da etapa filha.');
      return signed.data?.signedUrl || '';
    }
    return row.audio_url || '';
  }

  async function decorateChildren(data, rows, unlocks = {}) {
    const parents = new Map();
    for (const stage of [...(data?.stages || []), ...(data?.archivedStages || [])]) {
      if (stage?.stageId) parents.set(stage.stageId, stage);
    }

    const activeByParent = new Map();
    for (const row of rows.filter(item => item.is_active)) {
      if (!activeByParent.has(row.parent_stage_id)) activeByParent.set(row.parent_stage_id, []);
      activeByParent.get(row.parent_stage_id).push(row);
    }
    for (const siblings of activeByParent.values()) siblings.sort((a,b) => Number(a.release_day)-Number(b.release_day) || Number(a.child_position)-Number(b.child_position) || Number(a.number)-Number(b.number));

    const decorated = [];
    for (const row of rows) {
      const parent = parents.get(row.parent_stage_id);
      if (!parent) continue;
      const siblings = activeByParent.get(row.parent_stage_id) || [];
      const index = row.is_active ? Math.max(1, siblings.findIndex(item => item.stage_id === row.stage_id) + 1) : Math.max(1, Number(row.child_position || 1));
      const parentPosition = Number(parent.position || parent.number || 1);
      const ownAudioUrl = await signedOwnAudio(row);
      decorated.push({
        stageId: row.stage_id,
        legacyNumber: Number(row.number),
        parentStageId: row.parent_stage_id,
        parentPosition,
        parentUnitName: parent.unitName || '',
        childPosition: Number(row.child_position || index),
        childIndex: index,
        displayCode: `${parentPosition}.${index}`,
        releaseDay: Math.max(1, Number(row.release_day || 1)),
        isActive: Boolean(row.is_active),
        stageName: row.stage_name || 'Aula de apoio',
        unitName: row.unit_name || 'Nova aula',
        objective: row.objective || '',
        videoUrl: row.video_url || '',
        ownAudioPath: row.audio_path || '',
        ownAudioName: row.audio_name || '',
        ownAudioUrl,
        audioUrl: ownAudioUrl || parent.audioUrl || '',
        inheritsAudio: !ownAudioUrl && Boolean(parent.audioUrl),
        parentDeadlineDays: Math.max(1, Number(parent.deadlineDays || row.deadline_days || 1)),
        unlocked: Boolean(unlocks[row.stage_id]),
        unlockedAt: Number(unlocks[row.stage_id] || 0)
      });
    }
    return decorated;
  }

  async function appData(options) {
    const data = await originalRequest('/api/app-data', options);
    const rows = await childRows();
    const auth = await sb.auth.getUser();
    const userId = auth.data?.user?.id;
    if (!userId) fail('Sessão encerrada.', 401);
    const unlocks = await ensureChildUnlocks(data, rows, userId);
    data.childStages = (await decorateChildren(data, rows.filter(row => row.is_active), unlocks)).filter(child => child.parentPosition <= (data.stages?.length || 0));
    return data;
  }

  async function editorData(options) {
    const data = await originalRequest('/api/editor/data', options);
    const rows = await childRows();
    const children = await decorateChildren(data, rows);
    data.childStages = children.filter(child => child.isActive);
    data.archivedChildStages = children.filter(child => !child.isActive);
    return data;
  }

  async function refreshChild(stageId) {
    const data = await editorData();
    return [...(data.childStages || []), ...(data.archivedChildStages || [])].find(child => child.stageId === stageId) || null;
  }

  async function addChild(options) {
    const body = parseBody(options);
    const parentStageId = String(body.parentStageId || '');
    if (!parentStageId) fail('Escolha uma etapa mãe.');
    const releaseDay = Math.max(1, Number(body.releaseDay || 1));
    const result = await sb.rpc('add_shamatha_child_stage', { p_parent_stage_id:parentStageId, p_release_day:releaseDay });
    if (result.error) fail(result.error.message || 'Falha ao adicionar etapa filha.');
    const stageId = result.data?.stage_id || result.data?.[0]?.stage_id;
    return { childStage:await refreshChild(stageId) };
  }

  async function updateChild(stageId, options) {
    const body = parseBody(options);
    const result = await sb.rpc('update_shamatha_child_stage', {
      p_stage_id:stageId,
      p_unit_name:String(body.unitName || 'Nova aula'),
      p_objective:String(body.objective || ''),
      p_release_day:Math.max(1, Number(body.releaseDay || 1)),
      p_video_url:String(body.videoUrl || '')
    });
    if (result.error) fail(result.error.message || 'Falha ao salvar etapa filha.');
    return { childStage:await refreshChild(stageId) };
  }

  async function archiveChild(options) {
    const stageId = String(parseBody(options).stageId || '');
    if (!stageId) fail('Etapa filha inválida.');
    const result = await sb.rpc('archive_shamatha_child_stage', { p_stage_id:stageId });
    if (result.error) fail(result.error.message || 'Falha ao remover etapa filha.');
    return { ok:true, stageId };
  }

  async function restoreChild(options) {
    const stageId = String(parseBody(options).stageId || '');
    if (!stageId) fail('Etapa filha inválida.');
    const result = await sb.rpc('restore_shamatha_child_stage', { p_stage_id:stageId });
    if (result.error) fail(result.error.message || 'Falha ao restaurar etapa filha.');
    return { ok:true, stageId };
  }

  function audioInfo(file) {
    if (!(file instanceof Blob) || !file.size) fail('Escolha um arquivo de áudio.');
    if (file.size > MAX_AUDIO_BYTES) fail('O arquivo de áudio pode ter até 100 MB.');
    const extByMime = { 'audio/mpeg':'mp3','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/aac':'aac','audio/ogg':'ogg','audio/wav':'wav','audio/x-wav':'wav','audio/webm':'webm' };
    const nameExt = String(file.name || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
    const ext = ['mp3','m4a','aac','ogg','wav','webm'].includes(nameExt) ? nameExt : extByMime[String(file.type || '').toLowerCase()];
    if (!ext) fail('Use um arquivo MP3, M4A, AAC, OGG, WAV ou WEBM.');
    const mime = {mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',ogg:'audio/ogg',wav:'audio/wav',webm:'audio/webm'}[ext];
    return { ext, mime };
  }

  async function uploadChildAudio(stageId, options) {
    const file = parseBody(options).file;
    const info = audioInfo(file);
    const current = await sb.from('stages').select('stage_id,parent_stage_id,audio_path').eq('stage_id', stageId).not('parent_stage_id','is',null).single();
    if (current.error) fail(current.error.message || 'Etapa filha não encontrada.');
    const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const path = `stage-${stageId}/${token}.${info.ext}`;
    const upload = await sb.storage.from(AUDIO_BUCKET).upload(path, file, { cacheControl:'3600', upsert:false, contentType:info.mime });
    if (upload.error) fail(upload.error.message || 'Falha no upload do áudio.');
    const saved = await sb.from('stages').update({ audio_path:path, audio_name:String(file.name || `audio.${info.ext}`).slice(0,240), audio_url:'', updated_at:new Date().toISOString() }).eq('stage_id',stageId);
    if (saved.error) {
      await sb.storage.from(AUDIO_BUCKET).remove([path]).catch(() => null);
      fail(saved.error.message || 'Falha ao associar o áudio.');
    }
    if (current.data?.audio_path && current.data.audio_path !== path) await sb.storage.from(AUDIO_BUCKET).remove([current.data.audio_path]).catch(() => null);
    return { childStage:await refreshChild(stageId) };
  }

  async function removeChildAudio(stageId) {
    const current = await sb.from('stages').select('audio_path,parent_stage_id').eq('stage_id',stageId).not('parent_stage_id','is',null).single();
    if (current.error) fail(current.error.message || 'Etapa filha não encontrada.');
    const saved = await sb.from('stages').update({ audio_path:'',audio_name:'',audio_url:'',updated_at:new Date().toISOString() }).eq('stage_id',stageId);
    if (saved.error) fail(saved.error.message || 'Falha ao remover o áudio.');
    if (current.data?.audio_path) await sb.storage.from(AUDIO_BUCKET).remove([current.data.audio_path]).catch(() => null);
    return { childStage:await refreshChild(stageId) };
  }

  async function validateRootDeadline(path, options) {
    if (String(options.method || 'GET').toUpperCase() !== 'PUT') return;
    const match = path.match(/^\/api\/editor\/stages\/(\d+)$/);
    if (!match) return;
    const deadline = Number(parseBody(options).deadlineDays);
    if (!Number.isFinite(deadline)) return;
    const roots = await rootIdentities();
    const root = roots[Number(match[1]) - 1];
    if (!root) return;
    const { data, error } = await sb.from('stages').select('release_day').eq('parent_stage_id',root.stage_id).eq('is_active',true).order('release_day',{ascending:false}).limit(1);
    if (error) fail(error.message || 'Falha ao validar etapas filhas.');
    const maxRelease = Number(data?.[0]?.release_day || 0);
    if (maxRelease > deadline) fail(`Existe uma etapa filha programada para o dia ${maxRelease}. Ajuste-a antes de reduzir a janela para ${deadline} dias.`);
  }

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    if (path === '/api/app-data' && method === 'GET') return appData(options);
    if (path === '/api/editor/data' && method === 'GET') return editorData(options);
    if (path === '/api/progress' && method === 'PUT') {
      const result = await originalRequest(path, options);
      const data = await originalRequest('/api/app-data');
      const rows = await childRows();
      const auth = await sb.auth.getUser();
      if (auth.data?.user?.id) await ensureChildUnlocks(data, rows, auth.data.user.id);
      return result;
    }
    if (path === '/api/editor/child-stages' && method === 'POST') return addChild(options);
    const childMatch = path.match(/^\/api\/editor\/child-stages\/([0-9a-f-]{36})$/i);
    if (childMatch && method === 'PUT') return updateChild(childMatch[1], options);
    const audioMatch = path.match(/^\/api\/editor\/child-stages\/([0-9a-f-]{36})\/audio$/i);
    if (audioMatch && method === 'POST') return uploadChildAudio(audioMatch[1], options);
    if (audioMatch && method === 'DELETE') return removeChildAudio(audioMatch[1]);
    if (path === '/api/editor/child-stage-archive' && method === 'POST') return archiveChild(options);
    if (path === '/api/editor/child-stage-restore' && method === 'POST') return restoreChild(options);
    await validateRootDeadline(path, options);
    return originalRequest(path, options);
  }

  window.ShamathaBackend = Object.freeze({ ...base, request });
})();
