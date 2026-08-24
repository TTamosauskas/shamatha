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

function latestSession(data: any) {
  let latest = 0;
  const stages = data?.stages;
  if (!stages || typeof stages !== 'object') return null;
  for (const stage of Object.values(stages) as any[]) {
    const sessions = Array.isArray(stage?.sessions) ? stage.sessions : [];
    for (const session of sessions) {
      const time = sessionTime(session?.savedAt);
      if (time > latest) latest = time;
    }
  }
  return latest ? new Date(latest).toISOString() : null;
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
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método inválido.' }, 405);
  try {
    await requireEditor(req);
    const [{ data: profiles, error: profilesError }, { data: rows, error: progressError }] = await Promise.all([
      admin.from('profiles').select('id,email'),
      admin.from('progress').select('user_id,data')
    ]);
    if (profilesError) throw profilesError;
    if (progressError) throw progressError;

    const emailById = new Map((profiles || []).map(row => [row.id, String(row.email || '').toLowerCase()]));
    const lastSessionByEmail: Record<string, string> = {};
    for (const row of rows || []) {
      const email = emailById.get(row.user_id);
      const last = latestSession(row.data);
      if (email && last) lastSessionByEmail[email] = last;
    }
    return json({ lastSessionByEmail });
  } catch (error: any) {
    console.error(error);
    return json({ error: String(error?.message || 'Falha ao consultar atividade.') }, Number(error?.status || 500));
  }
});
