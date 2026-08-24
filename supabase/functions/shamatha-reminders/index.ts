import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITE_ORIGIN = 'https://ttamosauskas.github.io';
const APP_URL = 'https://ttamosauskas.github.io/shamatha/app.html';
const DEFAULT_TIME = '20:00';
const DEFAULT_TZ = 'America/Sao_Paulo';
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession:false, autoRefreshToken:false } });

const cors = {
  'Access-Control-Allow-Origin': SITE_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers:cors });
}

function cleanTime(value: unknown) {
  const text = String(value || '').trim();
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  return match ? `${match[1]}:${match[2]}` : '';
}

function cleanTimezone(value: unknown) {
  const timezone = String(value || '').trim().slice(0, 100);
  if (!timezone) return '';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone:timezone }).format(new Date());
    return timezone;
  } catch {
    return '';
  }
}

async function config() {
  const { data, error } = await admin.rpc('shamatha_edge_config');
  if (error) throw error;
  return data as { vapid_public:string; vapid_private:string; cron_secret:string; base_url:string };
}

async function authProfile(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw Object.assign(new Error('Sessão ausente.'), { status:401 });
  const { data:userData, error:userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw Object.assign(new Error('Sessão inválida.'), { status:401 });
  const { data:profile, error } = await admin.from('profiles')
    .select('id,access_status')
    .eq('id', userData.user.id)
    .single();
  if (error || !profile) throw Object.assign(new Error('Perfil não encontrado.'), { status:401 });
  if (profile.access_status !== 'approved') throw Object.assign(new Error('Seu acesso ainda não está aprovado.'), { status:403 });
  return { user:userData.user, profile };
}

function publicReminder(row: any) {
  const local = cleanTime(row?.local_time) || DEFAULT_TIME;
  return {
    enabled:Boolean(row?.enabled),
    localTime:local,
    timezone:String(row?.timezone || DEFAULT_TZ),
    updatedAt:row?.updated_at || null
  };
}

async function getReminder(req: Request) {
  const current = await authProfile(req);
  const { data, error } = await admin.from('meditation_reminders')
    .select('enabled,local_time,timezone,updated_at')
    .eq('user_id', current.user.id)
    .maybeSingle();
  if (error) throw error;
  return { reminder:publicReminder(data) };
}

async function saveReminder(req: Request, body: any) {
  const current = await authProfile(req);
  const localTime = cleanTime(body.localTime);
  const timezone = cleanTimezone(body.timezone);
  if (!localTime) throw Object.assign(new Error('Escolha um horário válido.'), { status:400 });
  if (!timezone) throw Object.assign(new Error('Fuso horário inválido.'), { status:400 });

  const row = {
    user_id:current.user.id,
    enabled:Boolean(body.enabled),
    local_time:`${localTime}:00`,
    timezone,
    updated_at:new Date().toISOString()
  };
  const { data, error } = await admin.from('meditation_reminders')
    .upsert(row, { onConflict:'user_id' })
    .select('enabled,local_time,timezone,updated_at')
    .single();
  if (error) throw error;
  return { reminder:publicReminder(data) };
}

function localClock(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:timezone,
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(now);
  const read = (type:string) => parts.find(part => part.type === type)?.value || '';
  const hour = Number(read('hour'));
  const minute = Number(read('minute'));
  return {
    date:`${read('year')}-${read('month')}-${read('day')}`,
    minuteOfDay:hour * 60 + minute
  };
}

function reminderMinute(value: string) {
  const [hour, minute] = cleanTime(value).split(':').map(Number);
  return hour * 60 + minute;
}

async function approvedUserIds() {
  const { data, error } = await admin.from('profiles').select('id').eq('access_status', 'approved');
  if (error) throw error;
  return new Set((data || []).map(row => row.id));
}

async function pushToUser(userId: string, localDate: string) {
  const cfg = await config();
  if (!cfg.vapid_public || !cfg.vapid_private) return { subscriptions:0, sent:0, removed:0, failed:0 };
  webpush.setVapidDetails(APP_URL, cfg.vapid_public, cfg.vapid_private);

  const { data:rows, error } = await admin.from('push_subscriptions')
    .select('id,endpoint,p256dh,auth_key')
    .eq('user_id', userId)
    .eq('enabled', true);
  if (error) throw error;

  let sent = 0, removed = 0, failed = 0;
  const payload = JSON.stringify({
    title:'Hora de voltar à prática',
    body:'Reserve alguns minutos para sua meditação de hoje.',
    url:APP_URL,
    tag:`daily-meditation-${localDate}`
  });

  for (const row of rows || []) {
    try {
      await webpush.sendNotification({
        endpoint:row.endpoint,
        keys:{ p256dh:row.p256dh, auth:row.auth_key }
      }, payload, { TTL:3600 });
      sent += 1;
    } catch (error:any) {
      const code = Number(error?.statusCode || 0);
      if (code === 404 || code === 410) {
        await admin.from('push_subscriptions').delete().eq('id', row.id);
        removed += 1;
      } else {
        console.error('daily push failure', code, String(error?.message || error));
        failed += 1;
      }
    }
  }
  return { subscriptions:(rows || []).length, sent, removed, failed };
}

async function runCron(req: Request) {
  const cfg = await config();
  const given = req.headers.get('x-cron-secret') || '';
  if (!cfg.cron_secret || given !== cfg.cron_secret) throw Object.assign(new Error('Cron não autorizado.'), { status:401 });

  const now = new Date();
  const allowed = await approvedUserIds();
  const { data:rows, error } = await admin.from('meditation_reminders')
    .select('user_id,enabled,local_time,timezone,last_sent_local_date')
    .eq('enabled', true);
  if (error) throw error;

  const results:any[] = [];
  for (const row of rows || []) {
    if (!allowed.has(row.user_id)) continue;
    const timezone = cleanTimezone(row.timezone) || DEFAULT_TZ;
    const local = localClock(now, timezone);
    if (String(row.last_sent_local_date || '') === local.date) continue;
    const desired = reminderMinute(row.local_time || DEFAULT_TIME);
    const delta = local.minuteOfDay - desired;
    if (delta < 0 || delta >= 5) continue;

    const push = await pushToUser(row.user_id, local.date);
    if (push.sent > 0 || push.subscriptions === 0) {
      const updated = await admin.from('meditation_reminders')
        .update({ last_sent_local_date:local.date, updated_at:new Date().toISOString() })
        .eq('user_id', row.user_id);
      if (updated.error) throw updated.error;
    }
    results.push({ userId:row.user_id, localDate:local.date, push });
  }
  return { checkedAt:now.toISOString(), reminders:results };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers:cors });
  if (req.method !== 'POST') return json({ error:'Método inválido.' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    if (action === 'cron') return json(await runCron(req));
    if (action === 'get') return json(await getReminder(req));
    if (action === 'save') return json(await saveReminder(req, body));
    return json({ error:'Operação desconhecida.' }, 404);
  } catch (error:any) {
    console.error(error);
    return json({ error:String(error?.message || 'Falha na operação.') }, Number(error?.status || 500));
  }
});
