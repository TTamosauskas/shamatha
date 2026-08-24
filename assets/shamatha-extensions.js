(() => {
  'use strict';

  const base = window.ShamathaBackend;
  if (!base?.request || !base?.getClient) return;

  const sb = base.getClient();
  const AUDIO_BUCKET = 'shamatha-audio';
  const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
  const SIGNED_SECONDS = 6 * 60 * 60;
  const GLOBAL_MIN_SESSION_SECONDS = 300;

  function fail(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    throw error;
  }

  function parseBody(options = {}) {
    if (!options.body) return {};
    if (typeof options.body === 'object') return options.body;
    try { return JSON.parse(options.body); }
    catch (_) { return fail('Dados enviados em formato inválido.'); }
  }

  function publicUser(row) {
    const status = row.access_status || (row.access_granted ? 'approved' : 'pending');
    return {
      id: row.id,
      email: row.email,
      role: row.role === 'editor' ? 'editor' : 'user',
      accessGranted: status === 'approved',
      accessStatus: status,
      isOwner: Boolean(row.is_owner),
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
    };
  }

  function rowToStage(row, audioUrl = null) {
    return {
      number: Number(row.number),
      stageName: row.stage_name || '',
      unitName: row.unit_name || '',
      objective: row.objective || '',
      sessionsRequired: Number(row.sessions_required || 3),
      deadlineDays: Number(row.deadline_days || 7),
      minSessionSeconds: Number(row.min_session_seconds || GLOBAL_MIN_SESSION_SECONDS),
      videoUrl: row.video_url || '',
      audioUrl: audioUrl ?? row.audio_url ?? '',
      audioPath: row.audio_path || '',
      audioName: row.audio_name || ''
    };
  }

  function liveClassFromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      url: row.url,
      startsAt: row.starts_at,
      status: row.status,
      announcedAt: row.announced_at,
      reminderSentAt: row.reminder_sent_at,
      createdAt: row.created_at
    };
  }

  async function enhanceStages(stages) {
    const numbers = (stages || []).map(stage => Number(stage.number)).filter(Boolean);
    if (!numbers.length) return stages || [];
    const { data: rows, error } = await sb.from('stages')
      .select('number,audio_url,audio_path,audio_name')
      .in('number', numbers);
    if (error) fail(error.message || 'Falha ao consultar os áudios.');
    const byNumber = new Map((rows || []).map(row => [Number(row.number), row]));
    return Promise.all((stages || []).map(async stage => {
      const row = byNumber.get(Number(stage.number));
      if (!row) return stage;
      let audioUrl = stage.audioUrl || row.audio_url || '';
      if (row.audio_path) {
        const signed = await sb.storage.from(AUDIO_BUCKET).createSignedUrl(row.audio_path, SIGNED_SECONDS);
        if (signed.error) fail(signed.error.message || 'Falha ao liberar o áudio da prática.');
        audioUrl = signed.data?.signedUrl || '';
      }
      return { ...stage, audioUrl, audioPath: row.audio_path || '', audioName: row.audio_name || '' };
    }));
  }

  async function ensureEditor() {
    return base.request('/api/editor/data');
  }

  async function findProfile(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) fail('Informe um e-mail válido.');
    const { data, error } = await sb.from('profiles')
      .select('id,email,role,access_granted,access_status,is_owner,created_at')
      .eq('email', normalized)
      .maybeSingle();
    if (error) fail(error.message || 'Falha ao localizar o usuário.');
    if (!data) fail('Usuário cadastrado com esse e-mail não encontrado.', 404);
    return data;
  }

  async function nextLiveClass() {
    const floor = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const { data, error } = await sb.from('live_classes')
      .select('*')
      .eq('status', 'scheduled')
      .gte('starts_at', floor)
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) fail(error.message || 'Falha ao consultar a próxima aula.');
    return liveClassFromRow(data);
  }

  async function upcomingLiveClasses() {
    const floor = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const { data, error } = await sb.from('live_classes')
      .select('*')
      .gte('starts_at', floor)
      .order('starts_at', { ascending: true })
      .limit(20);
    if (error) fail(error.message || 'Falha ao consultar as aulas.');
    return (data || []).map(liveClassFromRow);
  }

  async function appData(options) {
    const data = await base.request('/api/app-data', options);
    const [stages, liveClass, settings] = await Promise.all([
      enhanceStages(data.stages),
      nextLiveClass(),
      sb.from('settings').select('push_public_key').eq('id', 1).maybeSingle()
    ]);
    if (settings.error) fail(settings.error.message || 'Falha ao consultar notificações.');
    data.stages = stages;
    data.nextLiveClass = liveClass;
    data.push = { publicKey: settings.data?.push_public_key || '' };

    if (liveClass) {
      const starts = new Date(liveClass.startsAt).getTime();
      const diff = starts - Date.now();
      data.settings.liveClassUrl = diff <= 30 * 60 * 1000 && diff >= -4 * 60 * 60 * 1000 ? liveClass.url : '';
    }
    return data;
  }

  async function editorData(options) {
    const original = await base.request('/api/editor/data', options);
    const [{ data: profiles, error }, auth, liveClasses] = await Promise.all([
      sb.from('profiles').select('id,email,role,access_granted,access_status,is_owner,created_at').order('created_at', { ascending:true }),
      sb.auth.getUser(),
      upcomingLiveClasses()
    ]);
    if (error) fail(error.message || 'Falha ao carregar usuários.');
    const users = (profiles || []).map(publicUser);
    return {
      ...original,
      currentUser: users.find(user => user.id === auth.data?.user?.id) || null,
      users,
      liveClasses,
      stages: await enhanceStages(original.stages)
    };
  }

  async function setAccess(options) {
    await ensureEditor();
    const body = parseBody(options);
    const found = await findProfile(body.email);
    if (found.role === 'editor' && !body.accessGranted) fail('Rebaixe este editor para aluno antes de alterar o acesso.');
    const status = body.accessGranted ? 'approved' : 'suspended';
    const { data, error } = await sb.from('profiles')
      .update({ access_status: status })
      .eq('id', found.id)
      .select('id,email,role,access_granted,access_status,is_owner,created_at')
      .single();
    if (error) fail(error.message || 'Falha ao alterar o acesso.');
    return { user: publicUser(data) };
  }

  async function setStatus(options) {
    await ensureEditor();
    const body = parseBody(options);
    const found = await findProfile(body.email);
    const status = ['pending', 'approved', 'suspended'].includes(body.status) ? body.status : '';
    if (!status) fail('Estado de acesso inválido.');
    if (found.role === 'editor' && status !== 'approved') fail('Editores permanecem com estado Aprovado.');
    if (found.is_owner && status !== 'approved') fail('A conta principal deve permanecer aprovada.');
    const { data, error } = await sb.from('profiles')
      .update({ access_status: status })
      .eq('id', found.id)
      .select('id,email,role,access_granted,access_status,is_owner,created_at')
      .single();
    if (error) fail(error.message || 'Falha ao alterar o estado.');
    return { user: publicUser(data) };
  }

  async function setRole(options) {
    await ensureEditor();
    const body = parseBody(options);
    const found = await findProfile(body.email);
    const role = body.role === 'editor' ? 'editor' : 'student';
    if (found.is_owner && role !== 'editor') fail('A conta principal deve permanecer como editor.');
    const changes = role === 'editor'
      ? { role:'editor', access_status:'approved' }
      : { role:'student', access_status: found.access_status === 'approved' ? 'approved' : (found.access_status || 'pending') };
    const { data, error } = await sb.from('profiles')
      .update(changes)
      .eq('id', found.id)
      .select('id,email,role,access_granted,access_status,is_owner,created_at')
      .single();
    if (error) fail(error.message || 'Falha ao alterar a função do usuário.');
    return { user: publicUser(data) };
  }

  async function invokeOps(body) {
    const result = await sb.functions.invoke('shamatha-ops', { body });
    if (result.error) {
      let message = result.error.message || 'Falha no serviço.';
      try {
        const payload = await result.error.context?.json?.();
        if (payload?.error) message = payload.error;
      } catch (_) {}
      fail(message, result.error.context?.status || 400);
    }
    if (result.data?.error) fail(result.data.error);
    return result.data;
  }

  async function inviteUser(options) {
    await ensureEditor();
    const body = parseBody(options);
    const data = await invokeOps({ action:'invite_user', email:body.email, role:body.role, status:body.status });
    return { ...data, user: publicUser(data.user) };
  }

  async function scheduleLiveClass(options) {
    await ensureEditor();
    const body = parseBody(options);
    const data = await invokeOps({ action:'schedule_class', url:body.url, startsAt:body.startsAt });
    return { ...data, liveClass: liveClassFromRow(data.liveClass) };
  }

  async function cancelLiveClass(options) {
    await ensureEditor();
    const body = parseBody(options);
    const data = await invokeOps({ action:'cancel_class', id:body.id });
    return { ...data, liveClass: liveClassFromRow(data.liveClass) };
  }

  async function pushConfig() {
    const { data, error } = await sb.from('settings').select('push_public_key').eq('id', 1).single();
    if (error) fail(error.message || 'Falha ao carregar a configuração de notificações.');
    return { publicKey: data.push_public_key || '' };
  }

  async function pushSubscribe(options) {
    const body = parseBody(options);
    return invokeOps({ action:'push_subscribe', subscription:body.subscription, userAgent:body.userAgent });
  }

  async function pushUnsubscribe(options) {
    const body = parseBody(options);
    return invokeOps({ action:'push_unsubscribe', endpoint:body.endpoint });
  }

  function clampInt(value, min, max, fallback) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function safeUrl(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
      const url = new URL(text);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
      return url.href;
    } catch (_) {
      return fail('Use uma URL completa começando com http:// ou https://.');
    }
  }

  async function saveStage(number, options) {
    await ensureEditor();
    const body = parseBody(options);
    const current = await sb.from('stages').select('stage_name').eq('number', number).single();
    if (current.error) fail(current.error.message || 'Etapa não encontrada.');
    const row = {
      stage_name:String(body.stageName || current.data.stage_name || '').trim().slice(0, 120),
      unit_name:String(body.unitName || '').trim().slice(0, 160),
      objective:String(body.objective || '').trim().slice(0, 1200),
      sessions_required:clampInt(body.sessionsRequired, 1, 30, 3),
      deadline_days:clampInt(body.deadlineDays, 1, 365, 7),
      min_session_seconds:GLOBAL_MIN_SESSION_SECONDS,
      video_url:safeUrl(body.videoUrl),
      updated_at:new Date().toISOString()
    };
    const saved = await sb.from('stages').update(row).eq('number', number).select('*').single();
    if (saved.error) fail(saved.error.message || 'Falha ao salvar a etapa.');
    const [stage] = await enhanceStages([rowToStage(saved.data)]);
    return { stage };
  }

  function audioInfo(file) {
    if (!(file instanceof Blob) || !file.size) fail('Escolha um arquivo de áudio.');
    if (file.size > MAX_AUDIO_BYTES) fail('O arquivo de áudio pode ter até 100 MB.');
    const nameExt = String(file.name || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
    const mimeToExt = {
      'audio/mpeg':'mp3','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/aac':'aac',
      'audio/ogg':'ogg','audio/wav':'wav','audio/x-wav':'wav','audio/webm':'webm'
    };
    const ext = ['mp3','m4a','aac','ogg','wav','webm'].includes(nameExt) ? nameExt : mimeToExt[String(file.type || '').toLowerCase()];
    if (!ext) fail('Use um arquivo MP3, M4A, AAC, OGG, WAV ou WEBM.');
    const extToMime = { mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',ogg:'audio/ogg',wav:'audio/wav',webm:'audio/webm' };
    return { ext, contentType:extToMime[ext] };
  }

  async function uploadAudio(number, options) {
    await ensureEditor();
    const file = parseBody(options).file;
    const info = audioInfo(file);
    const current = await sb.from('stages').select('*').eq('number', number).single();
    if (current.error) fail(current.error.message || 'Etapa não encontrada.');
    const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const path = `stage-${number}/${token}.${info.ext}`;
    const upload = await sb.storage.from(AUDIO_BUCKET).upload(path, file, {
      cacheControl:'3600', upsert:false, contentType:info.contentType
    });
    if (upload.error) fail(upload.error.message || 'Falha no upload do áudio.');

    const saved = await sb.from('stages').update({
      audio_path:path,
      audio_name:String(file.name || `audio-etapa-${number}.${info.ext}`).slice(0, 240),
      audio_url:'',
      updated_at:new Date().toISOString()
    }).eq('number', number).select('*').single();

    if (saved.error) {
      await sb.storage.from(AUDIO_BUCKET).remove([path]).catch(() => null);
      fail(saved.error.message || 'Falha ao associar o áudio à etapa.');
    }
    if (current.data?.audio_path && current.data.audio_path !== path) {
      await sb.storage.from(AUDIO_BUCKET).remove([current.data.audio_path]).catch(() => null);
    }
    const [stage] = await enhanceStages([rowToStage(saved.data)]);
    return { stage };
  }

  async function removeAudio(number) {
    await ensureEditor();
    const current = await sb.from('stages').select('*').eq('number', number).single();
    if (current.error) fail(current.error.message || 'Etapa não encontrada.');
    if (current.data.audio_path) {
      const removed = await sb.storage.from(AUDIO_BUCKET).remove([current.data.audio_path]);
      if (removed.error) fail(removed.error.message || 'Falha ao remover o áudio.');
    }
    const saved = await sb.from('stages').update({ audio_path:'', audio_name:'', audio_url:'', updated_at:new Date().toISOString() })
      .eq('number', number).select('*').single();
    if (saved.error) fail(saved.error.message || 'Falha ao limpar o áudio da etapa.');
    return { stage:rowToStage(saved.data, '') };
  }

  async function enrichAuthResult(path, options) {
    const result = await base.request(path, options);
    if (!result?.user?.id) {
      if (result?.user && !result.user.accessStatus) result.user.accessStatus = result.user.accessGranted ? 'approved' : 'pending';
      return result;
    }
    const { data, error } = await sb.from('profiles')
      .select('id,email,role,access_granted,access_status,is_owner,created_at')
      .eq('id', result.user.id)
      .maybeSingle();
    if (!error && data) result.user = publicUser(data);
    else if (!result.user.accessStatus) result.user.accessStatus = result.user.accessGranted ? 'approved' : 'pending';
    return result;
  }

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();

    if (path === '/api/me' && method === 'GET') return enrichAuthResult(path, options);
    if (path === '/api/login' && method === 'POST') return enrichAuthResult(path, options);
    if (path === '/api/register' && method === 'POST') return enrichAuthResult(path, options);

    if (path === '/api/app-data' && method === 'GET') return appData(options);
    if (path === '/api/live-class' && method === 'GET') return { liveClass: await nextLiveClass() };
    if (path === '/api/push/config' && method === 'GET') return pushConfig();
    if (path === '/api/push/subscribe' && method === 'POST') return pushSubscribe(options);
    if (path === '/api/push/unsubscribe' && method === 'DELETE') return pushUnsubscribe(options);

    if (path === '/api/editor/data' && method === 'GET') return editorData(options);
    if (path === '/api/editor/access' && method === 'PUT') return setAccess(options);
    if (path === '/api/editor/status' && method === 'PUT') return setStatus(options);
    if (path === '/api/editor/role' && method === 'PUT') return setRole(options);
    if (path === '/api/editor/invite' && method === 'POST') return inviteUser(options);
    if (path === '/api/editor/live-class' && method === 'POST') return scheduleLiveClass(options);
    if (path === '/api/editor/live-class' && method === 'DELETE') return cancelLiveClass(options);

    const audioMatch = path.match(/^\/api\/editor\/stages\/(\d+)\/audio$/);
    if (audioMatch && method === 'POST') return uploadAudio(Number(audioMatch[1]), options);
    if (audioMatch && method === 'DELETE') return removeAudio(Number(audioMatch[1]));

    const stageMatch = path.match(/^\/api\/editor\/stages\/(\d+)$/);
    if (stageMatch && method === 'PUT') return saveStage(Number(stageMatch[1]), options);

    return base.request(path, options);
  }

  window.ShamathaBackend = Object.freeze({ ...base, request });
})();
