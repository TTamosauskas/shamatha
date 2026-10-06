import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITE_ORIGIN = 'https://ttamosauskas.github.io';
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const cors = {
  'Access-Control-Allow-Origin': SITE_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

function clone<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  return structuredClone(value);
}

function sessionTime(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value || '').trim();
  if (!text) return 0;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function defaultStageState() {
  return {
    introStarted:false,
    introDone:false,
    videoPosition:0,
    cycleStartedAt:null,
    sessions:[],
    completedAt:null
  };
}

function normalizeStageState(value: any) {
  const state = { ...defaultStageState(), ...(value && typeof value === 'object' ? clone(value) : {}) };
  state.sessions = Array.isArray(state.sessions) ? state.sessions.slice(-500) : [];
  return state;
}

function extractSessions(data: any) {
  const modern = data?.stagesById && typeof data.stagesById === 'object' ? data.stagesById : null;
  const legacy = data?.stages && typeof data.stages === 'object' ? data.stages : null;
  const source = modern && Object.keys(modern).length ? modern : legacy;
  if (!source) return [];

  const rows: Array<{ at:string; durationSeconds:number; concentration:number | null }> = [];
  const seen = new Set<string>();
  for (const stage of Object.values(source) as any[]) {
    const sessions = Array.isArray(stage?.sessions) ? stage.sessions : [];
    for (const session of sessions) {
      const time = sessionTime(session?.savedAt) || sessionTime(session?.endedAt) || sessionTime(session?.startedAt);
      if (!time) continue;
      const duration = Math.max(0, Number(session?.elapsedSeconds ?? session?.playbackSeconds ?? 0));
      if (!Number.isFinite(duration) || duration <= 0) continue;
      const key = String(session?.id || `${time}:${duration}:${session?.lucidity ?? ''}`);
      if (seen.has(key)) continue;
      seen.add(key);
      const rawConcentration = Number(session?.lucidity);
      const concentration = Number.isFinite(rawConcentration)
        ? Math.max(0, Math.min(100, Math.round(rawConcentration)))
        : null;
      rows.push({ at:new Date(time).toISOString(), durationSeconds:Math.round(duration), concentration });
    }
  }
  return rows.sort((a,b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 7);
}

function roundedDuration(totalSeconds: number) {
  const total = Math.max(0, Number(totalSeconds || 0));
  if (total >= 60) {
    const minutes = Math.max(1, Math.round(total / 60));
    return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
  }
  const seconds = Math.round(total);
  return `${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`;
}

function logbookText(durationSeconds: number, concentration: number | null, notes: string) {
  const concentrationCopy = concentration == null ? '.' : ` e estimo ${concentration}% de concentração.`;
  return `Hoje meditei por ${roundedDuration(durationSeconds)}${concentrationCopy}${notes ? ` ${notes}` : ''}`;
}

function extractLogbook(data: any) {
  const byId = new Map<string, { id:string; at:string; stage:number | null; unitName:string; text:string }>();

  const add = (raw: any, fallbackStage: number | null = null) => {
    const time = sessionTime(raw?.at) || sessionTime(raw?.savedAt) || sessionTime(raw?.endedAt) || sessionTime(raw?.startedAt);
    if (!time) return;
    const duration = Math.max(0, Math.round(Number(raw?.durationSeconds ?? raw?.elapsedSeconds ?? raw?.playbackSeconds ?? 0)));
    const rawConcentration = Number(raw?.concentration ?? raw?.lucidity);
    const concentration = Number.isFinite(rawConcentration)
      ? Math.max(0, Math.min(100, Math.round(rawConcentration)))
      : null;
    const notes = String(raw?.notes || '').trim().slice(0, 2000);
    const stageValue = Number(raw?.stage ?? fallbackStage);
    const stage = Number.isInteger(stageValue) && stageValue > 0 ? stageValue : null;
    const id = String(raw?.id || `${time}:${stage || ''}:${duration}:${concentration ?? ''}`);
    const text = String(raw?.text || logbookText(duration, concentration, notes)).trim().slice(0, 2600);
    byId.set(id, {
      id,
      at:new Date(time).toISOString(),
      stage,
      unitName:String(raw?.unitName || '').trim().slice(0, 160),
      text
    });
  };

  for (const entry of Array.isArray(data?.logbook) ? data.logbook : []) add(entry);

  const modern = data?.stagesById && typeof data.stagesById === 'object' ? data.stagesById : null;
  const legacy = data?.stages && typeof data.stages === 'object' ? data.stages : null;
  const source = modern && Object.keys(modern).length ? modern : legacy;
  if (source) {
    for (const [stageKey, stageState] of Object.entries(source) as Array<[string, any]>) {
      const fallbackStage = legacy === source && /^\d+$/.test(stageKey) ? Number(stageKey) : null;
      for (const session of Array.isArray(stageState?.sessions) ? stageState.sessions : []) add(session, fallbackStage);
    }
  }

  return [...byId.values()]
    .sort((a,b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 50);
}

async function requireEditor(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) fail('Sessão ausente.', 401);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) fail('Sessão inválida.', 401);
  const { data: profile, error } = await admin.from('profiles')
    .select('role,access_status')
    .eq('id', userData.user.id)
    .single();
  if (error || !profile) fail('Perfil não encontrado.', 401);
  if (profile.role !== 'editor' || profile.access_status !== 'approved') fail('Acesso restrito ao editor.', 403);
  return userData.user;
}

async function authUsersByEmail() {
  const confirmedByEmail: Record<string, boolean> = {};
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    for (const user of users) {
      const email = String(user.email || '').trim().toLowerCase();
      if (email) confirmedByEmail[email] = Boolean(user.email_confirmed_at);
    }
    if (users.length < perPage) break;
    page += 1;
  }
  return confirmedByEmail;
}

async function activeStageRows() {
  const { data, error } = await admin.from('stages')
    .select('number,stage_id,position,parent_stage_id,child_position,release_day,is_active,unit_name')
    .eq('is_active', true);
  if (error) throw error;
  return data || [];
}

function orderedRoots(rows: any[]) {
  return rows
    .filter(row => !row.parent_stage_id && row.is_active)
    .slice()
    .sort((a,b) => Number(a.position ?? a.number) - Number(b.position ?? b.number));
}

function stageStates(data: any, roots: any[]) {
  const states = data?.stagesById && typeof data.stagesById === 'object' ? clone(data.stagesById) : {};
  const legacy = data?.stages && typeof data.stages === 'object' ? data.stages : {};
  const idByLegacy = new Map(roots.map(row => [Number(row.number), row.stage_id]));
  for (const [key, value] of Object.entries(legacy)) {
    const id = idByLegacy.get(Number(key));
    if (id && !states[id]) states[id] = normalizeStageState(value);
  }
  for (const row of roots) states[row.stage_id] = normalizeStageState(states[row.stage_id]);
  return states;
}

function inferredRootId(data: any, roots: any[]) {
  if (!roots.length) return '';
  const states = stageStates(data || {}, roots);
  const firstIncomplete = roots.find(row => !states[row.stage_id]?.completedAt);
  return firstIncomplete?.stage_id || roots[roots.length - 1].stage_id;
}

function positionForProgress(data: any, rows: any[]) {
  const roots = orderedRoots(rows);
  if (!roots.length) return '';
  const rootId = inferredRootId(data || {}, roots);
  const childId = String(data?.currentChildStageId || '');
  if (childId) {
    const child = rows.find(row => row.stage_id === childId && row.parent_stage_id && row.is_active);
    if (child && child.parent_stage_id === rootId) return child.stage_id;
  }
  return rootId;
}

async function saveNote(editorId: string, body: any) {
  const userId = String(body?.userId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(userId)) fail('Usuário inválido.');
  const { data: target, error: targetError } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (targetError) throw targetError;
  if (!target) fail('Usuário não encontrado.', 404);

  const note = String(body?.note || '').slice(0, 5000);
  if (!note.trim()) {
    const { error } = await admin.from('student_editor_notes').delete().eq('user_id', userId);
    if (error) throw error;
    return { ok:true, userId, note:'' };
  }

  const { error } = await admin.from('student_editor_notes').upsert({
    user_id:userId,
    note,
    updated_by:editorId,
    updated_at:new Date().toISOString()
  }, { onConflict:'user_id' });
  if (error) throw error;
  return { ok:true, userId, note };
}

async function positions() {
  const [rows, progressResult] = await Promise.all([
    activeStageRows(),
    admin.from('progress').select('user_id,data')
  ]);
  if (progressResult.error) throw progressResult.error;
  const positionsByUserId: Record<string,string> = {};
  for (const row of progressResult.data || []) {
    const position = positionForProgress(row.data, rows);
    if (position) positionsByUserId[row.user_id] = position;
  }
  return { positionsByUserId };
}

async function setPosition(editorId: string, body: any) {
  const userId = String(body?.userId || '').trim();
  const stageId = String(body?.stageId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(userId)) fail('Usuário inválido.');
  if (!/^[0-9a-f-]{36}$/i.test(stageId)) fail('Etapa inválida.');

  const [profileResult, rows, progressResult] = await Promise.all([
    admin.from('profiles').select('id,email,role').eq('id', userId).maybeSingle(),
    activeStageRows(),
    admin.from('progress').select('data').eq('user_id', userId).maybeSingle()
  ]);
  if (profileResult.error) throw profileResult.error;
  if (!profileResult.data) fail('Usuário não encontrado.', 404);
  if (progressResult.error) throw progressResult.error;

  const target = rows.find(row => row.stage_id === stageId && row.is_active);
  if (!target) fail('Etapa ativa não encontrada.', 404);
  const roots = orderedRoots(rows);
  const root = target.parent_stage_id
    ? roots.find(row => row.stage_id === target.parent_stage_id)
    : roots.find(row => row.stage_id === target.stage_id);
  if (!root) fail('Etapa mãe ativa não encontrada.', 404);
  const rootIndex = roots.findIndex(row => row.stage_id === root.stage_id);
  if (rootIndex < 0) fail('Posição da etapa não encontrada.', 404);

  const raw = progressResult.data?.data && typeof progressResult.data.data === 'object'
    ? clone(progressResult.data.data)
    : {};
  const states = stageStates(raw, roots);
  const now = Date.now();

  roots.forEach((row, index) => {
    const state = states[row.stage_id] = normalizeStageState(states[row.stage_id]);
    if (index < rootIndex) {
      if (!state.completedAt) state.completedAt = now;
      state.introStarted = true;
      state.introDone = true;
    } else {
      state.completedAt = null;
    }
    if (index === rootIndex) {
      state.activatedAt = now;
      state.cycleStartedAt = now;
    }
  });

  const childUnlocks = raw?.childUnlocks && typeof raw.childUnlocks === 'object' ? clone(raw.childUnlocks) : {};
  let currentChildStageId = '';
  let label = `Etapa ${rootIndex + 1} — ${root.unit_name || 'Sem título'}`;

  if (target.parent_stage_id) {
    currentChildStageId = target.stage_id;
    const siblings = rows
      .filter(row => row.parent_stage_id === root.stage_id && row.is_active)
      .slice()
      .sort((a,b) => Number(a.child_position || 0) - Number(b.child_position || 0) || Number(a.number) - Number(b.number));
    const targetChildIndex = Math.max(0, siblings.findIndex(row => row.stage_id === target.stage_id));
    siblings.slice(0, targetChildIndex + 1).forEach(row => {
      if (!childUnlocks[row.stage_id]) childUnlocks[row.stage_id] = now;
    });
    label = `Etapa ${rootIndex + 1}.${targetChildIndex + 1} — ${target.unit_name || 'Aula de apoio'}`;
  }

  const next: any = {
    ...raw,
    schemaVersion:2,
    currentStageId:root.stage_id,
    stagesById:states,
    childUnlocks,
    updatedAt:now,
    manualPosition:{
      stageId:target.stage_id,
      rootStageId:root.stage_id,
      type:target.parent_stage_id ? 'child' : 'root',
      updatedAt:now,
      updatedBy:editorId
    }
  };
  delete next.currentStage;
  delete next.stages;
  if (currentChildStageId) next.currentChildStageId = currentChildStageId;
  else delete next.currentChildStageId;

  const saved = await admin.from('progress').upsert({
    user_id:userId,
    data:next,
    updated_at:new Date(now).toISOString()
  }, { onConflict:'user_id' });
  if (saved.error) throw saved.error;

  return {
    ok:true,
    userId,
    email:profileResult.data.email,
    stageId:target.stage_id,
    currentStageId:root.stage_id,
    currentChildStageId:currentChildStageId || null,
    type:target.parent_stage_id ? 'child' : 'root',
    label
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método inválido.' }, 405);
  try {
    const editor = await requireEditor(req);
    const body = await req.json().catch(() => ({}));
    if (body?.action === 'save_note') return json(await saveNote(editor.id, body));
    if (body?.action === 'positions') return json(await positions());
    if (body?.action === 'set_position') return json(await setPosition(editor.id, body));

    const [
      { data: profiles, error: profilesError },
      { data: rows, error: progressError },
      { data: notes, error: notesError },
      confirmedByEmail
    ] = await Promise.all([
      admin.from('profiles').select('id,email'),
      admin.from('progress').select('user_id,data'),
      admin.from('student_editor_notes').select('user_id,note'),
      authUsersByEmail()
    ]);
    if (profilesError) throw profilesError;
    if (progressError) throw progressError;
    if (notesError) throw notesError;

    const emailById = new Map((profiles || []).map(row => [row.id, String(row.email || '').trim().toLowerCase()]));
    const sessionsByUserId: Record<string, Array<{ at:string; durationSeconds:number; concentration:number | null }>> = {};
    const logbookByUserId: Record<string, Array<{ id:string; at:string; stage:number | null; unitName:string; text:string }>> = {};
    const lastSessionByEmail: Record<string, string> = {};
    for (const row of rows || []) {
      const sessions = extractSessions(row.data);
      const logbook = extractLogbook(row.data);
      if (sessions.length) {
        sessionsByUserId[row.user_id] = sessions;
        const email = emailById.get(row.user_id);
        if (email) lastSessionByEmail[email] = sessions[0].at;
      }
      if (logbook.length) logbookByUserId[row.user_id] = logbook;
    }
    const notesByUserId = Object.fromEntries((notes || []).map(row => [row.user_id, String(row.note || '')]));
    return json({ sessionsByUserId, logbookByUserId, notesByUserId, lastSessionByEmail, confirmedByEmail });
  } catch (error: any) {
    console.error(error);
    return json({ error: String(error?.message || 'Falha ao consultar atividade.') }, Number(error?.status || 500));
  }
});
