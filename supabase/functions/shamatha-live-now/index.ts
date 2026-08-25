import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITE_ORIGIN = 'https://ttamosauskas.github.io';
const SITE_URL = 'https://ttamosauskas.github.io/shamatha/';
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession:false, autoRefreshToken:false }
});

const cors = {
  'Access-Control-Allow-Origin': SITE_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers:cors });
}

function validUrl(value: unknown) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

async function requireEditor(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw Object.assign(new Error('Sessão ausente.'), { status:401 });

  const auth = await admin.auth.getUser(token);
  if (auth.error || !auth.data.user) {
    throw Object.assign(new Error('Sessão inválida.'), { status:401 });
  }

  const profile = await admin.from('profiles')
    .select('id,role,access_status')
    .eq('id', auth.data.user.id)
    .single();
  if (profile.error || !profile.data) {
    throw Object.assign(new Error('Perfil não encontrado.'), { status:401 });
  }
  if (profile.data.access_status !== 'approved' || profile.data.role !== 'editor') {
    throw Object.assign(new Error('Acesso restrito ao editor.'), { status:403 });
  }
  return profile.data;
}

async function edgeConfig() {
  const { data, error } = await admin.rpc('shamatha_edge_config');
  if (error) throw error;
  return data as { vapid_public:string; vapid_private:string };
}

async function approvedStudentIds() {
  const { data, error } = await admin.from('profiles')
    .select('id')
    .eq('role', 'student')
    .eq('access_status', 'approved');
  if (error) throw error;
  return new Set((data || []).map(row => row.id));
}

async function sendPush(payload: { title:string; body:string; tag:string }) {
  const cfg = await edgeConfig();
  if (!cfg.vapid_public || !cfg.vapid_private) return { sent:0, removed:0, failed:0 };

  webpush.setVapidDetails(SITE_URL, cfg.vapid_public, cfg.vapid_private);
  const allowed = await approvedStudentIds();
  const { data:subscriptions, error } = await admin.from('push_subscriptions')
    .select('id,user_id,endpoint,p256dh,auth_key')
    .eq('enabled', true);
  if (error) throw error;

  let sent = 0;
  let removed = 0;
  let failed = 0;
  const data = JSON.stringify({ ...payload, url:SITE_URL });

  for (const row of subscriptions || []) {
    if (!allowed.has(row.user_id)) continue;
    try {
      await webpush.sendNotification({
        endpoint:row.endpoint,
        keys:{ p256dh:row.p256dh, auth:row.auth_key }
      }, data, { TTL:3600 });
      sent += 1;
    } catch (error: any) {
      const status = Number(error?.statusCode || 0);
      if (status === 404 || status === 410) {
        await admin.from('push_subscriptions').delete().eq('id', row.id);
        removed += 1;
      } else {
        console.error('push failure', status, String(error?.message || error));
        failed += 1;
      }
    }
  }
  return { sent, removed, failed };
}

async function startNow(req: Request, body: any) {
  const editor = await requireEditor(req);
  const url = validUrl(body.url);
  if (!url) throw Object.assign(new Error('Informe uma URL válida para a aula.'), { status:400 });

  const now = new Date();
  const nowIso = now.toISOString();
  const activeFloor = new Date(now.getTime() - 30 * 60 * 1000).toISOString();

  const existing = await admin.from('live_classes')
    .select('*')
    .eq('status', 'scheduled')
    .gte('starts_at', activeFloor)
    .lte('starts_at', nowIso)
    .order('starts_at', { ascending:false })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;

  let klass;
  if (existing.data) {
    const updated = await admin.from('live_classes')
      .update({
        url,
        starts_at:nowIso,
        created_by:editor.id,
        announced_at:nowIso,
        reminder_sent_at:nowIso
      })
      .eq('id', existing.data.id)
      .select('*')
      .single();
    if (updated.error) throw updated.error;
    klass = updated.data;
  } else {
    const inserted = await admin.from('live_classes')
      .insert({
        url,
        starts_at:nowIso,
        status:'scheduled',
        created_by:editor.id,
        announced_at:nowIso,
        reminder_sent_at:nowIso
      })
      .select('*')
      .single();
    if (inserted.error) throw inserted.error;
    klass = inserted.data;
  }

  const push = await sendPush({
    title:'Aula ao vivo disponível agora',
    body:'A aula ao vivo começou. Toque para abrir o Centro Pineal.',
    tag:`live-class-${klass.id}`
  });

  return { liveClass:klass, push, reused:Boolean(existing.data) };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers:cors });
  if (req.method !== 'POST') return json({ error:'Método inválido.' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    return json(await startNow(req, body));
  } catch (error: any) {
    console.error(error);
    return json({ error:String(error?.message || 'Falha ao iniciar a aula.') }, Number(error?.status || 500));
  }
});
