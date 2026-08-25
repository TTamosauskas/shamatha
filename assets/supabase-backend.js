(() => {
  'use strict';

  const CONFIG = window.SHAMATHA_CONFIG || {};
  let client = null;

  class BackendError extends Error {
    constructor(message, status = 400, cause = null) {
      super(message);
      this.name = 'BackendError';
      this.status = status;
      this.cause = cause;
    }
  }

  function isConfigured() {
    return /^https:\/\/[^/]+\.supabase\.co\/?$/i.test(String(CONFIG.supabaseUrl || '').trim()) &&
      String(CONFIG.supabasePublishableKey || '').trim().length > 20;
  }

  function getClient() {
    if (!isConfigured()) {
      throw new BackendError('A conexão com o Supabase ainda precisa ser configurada em assets/config.js.', 503);
    }
    if (!window.supabase?.createClient) {
      throw new BackendError('A biblioteca do Supabase não foi carregada. Verifique sua conexão com a internet.', 503);
    }
    if (!client) {
      client = window.supabase.createClient(
        String(CONFIG.supabaseUrl).trim().replace(/\/$/, ''),
        String(CONFIG.supabasePublishableKey).trim(),
        {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true
          }
        }
      );
    }
    return client;
  }

  function parseBody(options = {}) {
    if (!options.body) return {};
    if (typeof options.body === 'object') return options.body;
    try { return JSON.parse(options.body); }
    catch (_) { throw new BackendError('Dados enviados em formato inválido.', 400); }
  }

  function publicUser(profile) {
    if (!profile) return null;
    return {
      id: profile.id,
      email: profile.email,
      role: profile.role === 'editor' ? 'editor' : 'user',
      accessGranted: Boolean(profile.access_granted),
      createdAt: profile.created_at ? new Date(profile.created_at).getTime() : Date.now()
    };
  }

  function stageFromRow(row) {
    return {
      number: Number(row.number),
      stageName: row.stage_name || '',
      unitName: row.unit_name || '',
      objective: row.objective || '',
      sessionsRequired: Number(row.sessions_required || 3),
      deadlineDays: Number(row.deadline_days || 7),
      minSessionSeconds: Number(row.min_session_seconds || 0),
      videoUrl: row.video_url || '',
      audioUrl: row.audio_url || ''
    };
  }

  function stageToRow(number, body) {
    return {
      number,
      stage_name: String(body.stageName || '').trim().slice(0, 120),
      unit_name: String(body.unitName || '').trim().slice(0, 160),
      objective: String(body.objective || '').trim().slice(0, 1200),
      sessions_required: clampInt(body.sessionsRequired, 1, 30, 3),
      deadline_days: clampInt(body.deadlineDays, 1, 365, 7),
      min_session_seconds: clampInt(body.minSessionSeconds, 0, 86400, 300),
      video_url: safeUrl(body.videoUrl),
      audio_url: safeUrl(body.audioUrl),
      updated_at: new Date().toISOString()
    };
  }

  function settingsFromRow(row) {
    return {
      liveClassUrl: row?.live_class_url || '',
      whatsappPhone: row?.whatsapp_phone || ''
    };
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
      throw new BackendError('Use uma URL completa começando com http:// ou https://.', 400);
    }
  }

  function normalizePhone(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 20);
  }

  function defaultStageProgress() {
    return {
      introStarted: false,
      introDone: false,
      videoPosition: 0,
      cycleStartedAt: null,
      sessions: [],
      completedAt: null
    };
  }

  function defaultProgress(totalStages = 9) {
    const count = clampInt(totalStages, 1, 30, 9);
    const stages = {};
    for (let i = 1; i <= count; i += 1) stages[i] = defaultStageProgress();
    return { currentStage: 1, stages, updatedAt: Date.now() };
  }

  function normalizeProgress(input, totalStages = null) {
    const hasInput = input && typeof input === 'object';
    const progress = hasInput ? structuredClone(input) : { currentStage:1, stages:{}, updatedAt:Date.now() };
    progress.stages = progress.stages && typeof progress.stages === 'object' ? progress.stages : {};
    const existingNumbers = Object.keys(progress.stages)
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value >= 1 && value <= 30);
    const previousTotal = existingNumbers.length ? Math.max(...existingNumbers) : 1;
    const inferred = Math.max(previousTotal, Number(progress.currentStage || 1));
    const count = clampInt(totalStages == null ? inferred : totalStages, 1, 30, 9);

    for (let i = 1; i <= count; i += 1) {
      const existing = progress.stages[i] || progress.stages[String(i)] || {};
      progress.stages[i] = { ...defaultStageProgress(), ...existing };
      progress.stages[i].sessions = Array.isArray(progress.stages[i].sessions) ? progress.stages[i].sessions.slice(-500) : [];
    }

    let current = Math.max(1, Math.min(count, Number(progress.currentStage || 1)));
    if (
      hasInput && count > previousTotal && current === previousTotal &&
      Boolean(progress.stages[previousTotal]?.completedAt)
    ) {
      current = Math.min(count, previousTotal + 1);
    }
    progress.currentStage = current;
    progress.updatedAt = Date.now();
    return progress;
  }

  function readableError(error, fallback = 'Falha ao acessar o serviço.') {
    const message = String(error?.message || '').trim();
    if (/invalid login credentials/i.test(message)) return 'E-mail ou senha inválidos.';
    if (/email not confirmed/i.test(message)) return 'Confirme seu e-mail antes de entrar.';
    if (/user already registered/i.test(message)) return 'Este e-mail já está cadastrado.';
    if (/password.*at least/i.test(message)) return 'A senha precisa ter pelo menos 8 caracteres.';
    if (/row-level security|permission denied|42501/i.test(message)) return 'Sua conta ainda não possui permissão para esta operação.';
    return message || fallback;
  }

  async function profileForUser(user, { retries = 4 } = {}) {
    if (!user) return null;
    const sb = getClient();
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const { data, error } = await sb.from('profiles')
        .select('id,email,role,access_granted,created_at')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw new BackendError(readableError(error), 400, error);
      if (data) return data;
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 180 * (attempt + 1)));
    }
    throw new BackendError('O perfil da conta ainda está sendo criado. Tente entrar novamente.', 409);
  }

  async function currentAuth() {
    const sb = getClient();
    const { data, error } = await sb.auth.getUser();
    if (error && !/auth session missing/i.test(String(error.message || ''))) {
      throw new BackendError(readableError(error), 401, error);
    }
    if (!data?.user) return { authUser: null, profile: null };
    const profile = await profileForUser(data.user);
    return { authUser: data.user, profile };
  }

  async function requireProfile({ editor = false, content = false } = {}) {
    const { authUser, profile } = await currentAuth();
    if (!authUser || !profile) throw new BackendError('Sessão encerrada.', 401);
    if (editor && profile.role !== 'editor') throw new BackendError('Acesso restrito ao editor.', 403);
    if (content && profile.role !== 'editor' && !profile.access_granted) {
      throw new BackendError('Seu acesso ao conteúdo aguarda a liberação do editor.', 403);
    }
    return { authUser, profile };
  }

  async function appData() {
    const sb = getClient();
    const { authUser, profile } = await requireProfile({ content: true });

    const [stagesResult, settingsResult] = await Promise.all([
      sb.from('stages').select('*').order('number', { ascending: true }),
      sb.from('settings').select('*').eq('id', 1).maybeSingle()
    ]);
    if (stagesResult.error) throw new BackendError(readableError(stagesResult.error), 400, stagesResult.error);
    if (settingsResult.error) throw new BackendError(readableError(settingsResult.error), 400, settingsResult.error);

    const totalStages = clampInt((stagesResult.data || []).length, 1, 30, 1);
    let progress = defaultProgress(totalStages);
    if (profile.role !== 'editor') {
      const result = await sb.from('progress').select('data').eq('user_id', authUser.id).maybeSingle();
      if (result.error) throw new BackendError(readableError(result.error), 400, result.error);
      progress = normalizeProgress(result.data?.data, totalStages);
      if (!result.data) {
        const inserted = await sb.from('progress').insert({ user_id: authUser.id, data: progress });
        if (inserted.error) throw new BackendError(readableError(inserted.error), 400, inserted.error);
      }
    }

    return {
      user: publicUser(profile),
      stages: (stagesResult.data || []).map(stageFromRow),
      settings: settingsFromRow(settingsResult.data),
      progress
    };
  }

  async function saveProgress(body) {
    const sb = getClient();
    const { authUser, profile } = await requireProfile({ content: true });
    if (profile.role === 'editor') throw new BackendError('O editor visualiza o conteúdo sem gravar progresso.', 403);
    const progress = normalizeProgress(body.progress);
    const { error } = await sb.from('progress').upsert({
      user_id: authUser.id,
      data: progress,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) throw new BackendError(readableError(error), 400, error);
    return { ok: true, updatedAt: progress.updatedAt };
  }

  async function editorData() {
    const sb = getClient();
    await requireProfile({ editor: true });
    const [usersResult, stagesResult, settingsResult] = await Promise.all([
      sb.from('profiles').select('id,email,role,access_granted,created_at').eq('role', 'student').order('created_at', { ascending: false }),
      sb.from('stages').select('*').order('number', { ascending: true }),
      sb.from('settings').select('*').eq('id', 1).maybeSingle()
    ]);
    for (const result of [usersResult, stagesResult, settingsResult]) {
      if (result.error) throw new BackendError(readableError(result.error), 400, result.error);
    }
    return {
      users: (usersResult.data || []).map(publicUser),
      stages: (stagesResult.data || []).map(stageFromRow),
      settings: settingsFromRow(settingsResult.data)
    };
  }

  async function setAccess(body) {
    const sb = getClient();
    await requireProfile({ editor: true });
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BackendError('Informe um e-mail válido.', 400);
    const found = await sb.from('profiles').select('id,email,role,access_granted,created_at').eq('role', 'student').eq('email', email).maybeSingle();
    if (found.error) throw new BackendError(readableError(found.error), 400, found.error);
    if (!found.data) throw new BackendError('Usuário cadastrado com esse e-mail não encontrado.', 404);
    const updated = await sb.from('profiles')
      .update({ access_granted: Boolean(body.accessGranted) })
      .eq('id', found.data.id)
      .select('id,email,role,access_granted,created_at')
      .single();
    if (updated.error) throw new BackendError(readableError(updated.error), 400, updated.error);
    return { user: publicUser(updated.data) };
  }

  async function saveStage(number, body) {
    const sb = getClient();
    await requireProfile({ editor: true });
    if (number < 1 || number > 30) throw new BackendError('Etapa inválida.', 400);
    const row = stageToRow(number, body);
    const result = await sb.from('stages').update(row).eq('number', number).select('*').single();
    if (result.error) throw new BackendError(readableError(result.error), 400, result.error);
    return { stage: stageFromRow(result.data) };
  }

  async function addStage() {
    const sb = getClient();
    await requireProfile({ editor: true });
    const result = await sb.rpc('add_shamatha_stage');
    if (result.error) throw new BackendError(readableError(result.error), 400, result.error);
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row) throw new BackendError('A nova etapa não pôde ser criada.', 400);
    return { stage: stageFromRow(row) };
  }

  async function saveSettings(body) {
    const sb = getClient();
    await requireProfile({ editor: true });
    const row = {
      live_class_url: safeUrl(body.liveClassUrl),
      whatsapp_phone: normalizePhone(body.whatsappPhone),
      updated_at: new Date().toISOString()
    };
    const result = await sb.from('settings').update(row).eq('id', 1).select('*').single();
    if (result.error) throw new BackendError(readableError(result.error), 400, result.error);
    return { settings: settingsFromRow(result.data) };
  }

  async function request(path, options = {}) {
    const sb = getClient();
    const method = String(options.method || 'GET').toUpperCase();
    const body = parseBody(options);

    if (path === '/api/register' && method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BackendError('Informe um e-mail válido.', 400);
      if (password.length < 8) throw new BackendError('A senha precisa ter pelo menos 8 caracteres.', 400);
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: String(CONFIG.baseUrl || location.href) }
      });
      if (error) throw new BackendError(readableError(error), 400, error);
      if (!data?.user) throw new BackendError('A conta não pôde ser criada.', 400);
      if (!data.session) {
        return {
          user: { id: data.user.id, email, role: 'user', accessGranted: false, createdAt: Date.now() },
          confirmationRequired: true
        };
      }
      return { user: publicUser(await profileForUser(data.user)) };
    }

    if (path === '/api/login' && method === 'POST') {
      const { data, error } = await sb.auth.signInWithPassword({
        email: String(body.email || '').trim().toLowerCase(),
        password: String(body.password || '')
      });
      if (error) throw new BackendError(readableError(error), 401, error);
      return { user: publicUser(await profileForUser(data.user)) };
    }

    if (path === '/api/logout' && method === 'POST') {
      const { error } = await sb.auth.signOut();
      if (error) throw new BackendError(readableError(error), 400, error);
      return { ok: true };
    }

    if (path === '/api/me' && method === 'GET') {
      const { authUser, profile } = await currentAuth();
      return { user: authUser ? publicUser(profile) : null, setupRequired: false };
    }

    if (path === '/api/app-data' && method === 'GET') return appData();
    if (path === '/api/progress' && method === 'PUT') return saveProgress(body);
    if (path === '/api/editor/data' && method === 'GET') return editorData();
    if (path === '/api/editor/access' && method === 'PUT') return setAccess(body);
    if (path === '/api/editor/settings' && method === 'PUT') return saveSettings(body);
    if (path === '/api/editor/stages' && method === 'POST') return addStage();

    const stageMatch = path.match(/^\/api\/editor\/stages\/(\d+)$/);
    if (stageMatch && method === 'PUT') return saveStage(Number(stageMatch[1]), body);

    throw new BackendError('Operação desconhecida.', 404);
  }

  window.ShamathaBackend = Object.freeze({
    request,
    isConfigured,
    getClient,
    baseUrl: String(CONFIG.baseUrl || '')
  });
})();
