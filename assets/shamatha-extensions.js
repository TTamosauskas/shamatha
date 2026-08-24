(() => {
  'use strict';

  const base = window.ShamathaBackend;
  if (!base?.request || !base?.getClient) return;

  const sb = base.getClient();
  const AUDIO_BUCKET = 'shamatha-audio';
  const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
  const SIGNED_SECONDS = 6 * 60 * 60;

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
    return {
      id: row.id,
      email: row.email,
      role: row.role === 'editor' ? 'editor' : 'user',
      accessGranted: Boolean(row.access_granted),
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
      minSessionSeconds: Number(row.min_session_seconds || 0),
      videoUrl: row.video_url || '',
      audioUrl: audioUrl ?? row.audio_url ?? '',
      audioPath: row.audio_path || '',
      audioName: row.audio_name || ''
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
      .select('id,email,role,access_granted,is_owner,created_at')
      .eq('email', normalized)
      .maybeSingle();
    if (error) fail(error.message || 'Falha ao localizar o usuário.');
    if (!data) fail('Usuário cadastrado com esse e-mail não encontrado.', 404);
    return data;
  }

  async function editorData(options) {
    const original = await base.request('/api/editor/data', options);
    const [{ data: profiles, error }, auth] = await Promise.all([
      sb.from('profiles').select('id,email,role,access_granted,is_owner,created_at').order('created_at', { ascending:true }),
      sb.auth.getUser()
    ]);
    if (error) fail(error.message || 'Falha ao carregar usuários.');
    const users = (profiles || []).map(publicUser);
    return {
      ...original,
      currentUser: users.find(user => user.id === auth.data?.user?.id) || null,
      users,
      stages: await enhanceStages(original.stages)
    };
  }

  async function setAccess(options) {
    await ensureEditor();
    const body = parseBody(options);
    const found = await findProfile(body.email);
    if (found.role === 'editor' && !body.accessGranted) fail('Rebaixe este editor para aluno antes de suspender o acesso.');
    const { data, error } = await sb.from('profiles')
      .update({ access_granted:Boolean(body.accessGranted) })
      .eq('id', found.id)
      .select('id,email,role,access_granted,is_owner,created_at')
      .single();
    if (error) fail(error.message || 'Falha ao alterar o acesso.');
    return { user:publicUser(data) };
  }

  async function setRole(options) {
    await ensureEditor();
    const body = parseBody(options);
    const found = await findProfile(body.email);
    const role = body.role === 'editor' ? 'editor' : 'student';
    if (found.is_owner && role !== 'editor') fail('A conta principal deve permanecer como editor.');
    const changes = role === 'editor' ? { role:'editor', access_granted:true } : { role:'student' };
    const { data, error } = await sb.from('profiles')
      .update(changes)
      .eq('id', found.id)
      .select('id,email,role,access_granted,is_owner,created_at')
      .single();
    if (error) fail(error.message || 'Falha ao alterar a função do usuário.');
    return { user:publicUser(data) };
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

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();

    if (path === '/api/app-data' && method === 'GET') {
      const data = await base.request(path, options);
      data.stages = await enhanceStages(data.stages);
      return data;
    }
    if (path === '/api/editor/data' && method === 'GET') return editorData(options);
    if (path === '/api/editor/access' && method === 'PUT') return setAccess(options);
    if (path === '/api/editor/role' && method === 'PUT') return setRole(options);

    const audioMatch = path.match(/^\/api\/editor\/stages\/(\d+)\/audio$/);
    if (audioMatch && method === 'POST') return uploadAudio(Number(audioMatch[1]), options);
    if (audioMatch && method === 'DELETE') return removeAudio(Number(audioMatch[1]));

    const stageMatch = path.match(/^\/api\/editor\/stages\/(\d+)$/);
    if (stageMatch && method === 'PUT') {
      const data = await base.request(path, options);
      const [stage] = await enhanceStages([data.stage]);
      return { ...data, stage };
    }

    return base.request(path, options);
  }

  window.ShamathaBackend = Object.freeze({ ...base, request });
})();
