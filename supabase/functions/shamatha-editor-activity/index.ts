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

function sessionTime(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value || '').trim();
  if (!text) return 0;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
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

async function requireEditor(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw Object.assign(new Error('Sessão ausente.'), { status: 401 });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw Object.assign(new Error('Sessão inválida.'), { status: 401 });
  const { data: profile, error } = await admin.from('profiles')
    .select('role,access_status')
    .eq('id', userData.user.id)
    .single();
  if (error || !profile) throw Object.assign(new Error('Perfil não encontrado.'), { status: 401 });
  if (profile.role !== 'editor' || profile.access_status !== 'approved') {
    throw Object.assign(new Error('Acesso restrito ao editor.'), { status: 403 });
  }
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

async function saveNote(editorId: string, body: any) {
  const userId = String(body?.userId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw Object.assign(new Error('Usuário inválido.'), { status: 400 });
  const { data: target, error: targetError } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 });

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método inválido.' }, 405);
  try {
    const editor = await requireEditor(req);
    const body = await req.json().catch(() => ({}));
    if (body?.action === 'save_note') return json(await saveNote(editor.id, body));

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
    const lastSessionByEmail: Record<string, string> = {};
    for (const row of rows || []) {
      const sessions = extractSessions(row.data);
      if (sessions.length) {
        sessionsByUserId[row.user_id] = sessions;
        const email = emailById.get(row.user_id);
        if (email) lastSessionByEmail[email] = sessions[0].at;
      }
    }
    const notesByUserId = Object.fromEntries((notes || []).map(row => [row.user_id, String(row.note || '')]));
    return json({ sessionsByUserId, notesByUserId, lastSessionByEmail, confirmedByEmail });
  } catch (error: any) {
    console.error(error);
    return json({ error: String(error?.message || 'Falha ao consultar atividade.') }, Number(error?.status || 500));
  }
});
