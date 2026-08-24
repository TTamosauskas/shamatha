import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITE_ORIGIN = 'https://ttamosauskas.github.io';
const SITE_URL = 'https://ttamosauskas.github.io/shamatha/';
const TZ = 'America/Sao_Paulo';
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = {
  'Access-Control-Allow-Origin': SITE_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
function cleanEmail(value: unknown) { return String(value || '').trim().toLowerCase(); }
function validEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validUrl(value: unknown) {
  try {
    const u = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
  } catch { return ''; }
}
function formatCuritiba(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(iso));
}

async function config() {
  const { data, error } = await admin.rpc('shamatha_edge_config');
  if (error) throw error;
  return data as { vapid_public: string; vapid_private: string; cron_secret: string; base_url: string };
}

async function bootstrapPush() {
  const { data: settings, error } = await admin.from('settings').select('push_public_key').eq('id', 1).single();
  if (error) throw error;
  if (settings?.push_public_key) return { configured: true, publicKey: settings.push_public_key };
  const keys = webpush.generateVAPIDKeys();
  const { data, error: storeError } = await admin.rpc('shamatha_store_push_bootstrap', {
    p_public: keys.publicKey, p_private: keys.privateKey
  });
  if (storeError) throw storeError;
  const { data: refreshed } = await admin.from('settings').select('push_public_key').eq('id', 1).single();
  return { configured: Boolean(data), publicKey: refreshed?.push_public_key || keys.publicKey };
}

async function authProfile(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw Object.assign(new Error('Sessão ausente.'), { status: 401 });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw Object.assign(new Error('Sessão inválida.'), { status: 401 });
  const { data: profile, error } = await admin.from('profiles')
    .select('id,email,role,access_status,is_owner')
    .eq('id', userData.user.id)
    .single();
  if (error || !profile) throw Object.assign(new Error('Perfil não encontrado.'), { status: 401 });
  return { user: userData.user, profile };
}
async function requireApproved(req: Request) {
  const auth = await authProfile(req);
  if (auth.profile.access_status !== 'approved') {
    throw Object.assign(new Error('Seu acesso ainda não está aprovado.'), { status: 403 });
  }
  return auth;
}
async function requireEditor(req: Request) {
  const auth = await requireApproved(req);
  if (auth.profile.role !== 'editor') throw Object.assign(new Error('Acesso restrito ao editor.'), { status: 403 });
  return auth;
}

async function approvedUserIds() {
  const { data, error } = await admin.from('profiles').select('id').eq('access_status', 'approved');
  if (error) throw error;
  return new Set((data || []).map(row => row.id));
}

async function sendPush(payload: { title: string; body: string; url?: string; tag?: string }) {
  const cfg = await config();
  if (!cfg.vapid_public || !cfg.vapid_private) return { sent: 0, removed: 0, failed: 0 };
  webpush.setVapidDetails(SITE_URL, cfg.vapid_public, cfg.vapid_private);
  const allowed = await approvedUserIds();
  const { data: rows, error } = await admin.from('push_subscriptions')
    .select('id,user_id,endpoint,p256dh,auth_key')
    .eq('enabled', true);
  if (error) throw error;
  let sent = 0, removed = 0, failed = 0;
  const data = JSON.stringify({ ...payload, url: payload.url || SITE_URL });
  for (const row of rows || []) {
    if (!allowed.has(row.user_id)) continue;
    try {
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth_key } }, data, { TTL: 86400 });
      sent += 1;
    } catch (error: any) {
      const code = Number(error?.statusCode || 0);
      if (code === 404 || code === 410) {
        await admin.from('push_subscriptions').delete().eq('id', row.id);
        removed += 1;
      } else {
        console.error('push failure', code, String(error?.message || error));
        failed += 1;
      }
    }
  }
  return { sent, removed, failed };
}

async function savePushSubscription(req: Request, body: any) {
  const current = await requireApproved(req);
  const sub = body.subscription || {};
  const endpoint = String(sub.endpoint || '').trim();
  const p256dh = String(sub.keys?.p256dh || '').trim();
  const authKey = String(sub.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !authKey) throw Object.assign(new Error('Assinatura push inválida.'), { status: 400 });
  const { data, error } = await admin.from('push_subscriptions').upsert({
    user_id: current.user.id,
    endpoint,
    p256dh,
    auth_key: authKey,
    user_agent: String(body.userAgent || '').slice(0, 500),
    enabled: true,
    updated_at: new Date().toISOString()
  }, { onConflict: 'endpoint' }).select('id').single();
  if (error) throw error;
  return { ok: true, id: data.id };
}

async function removePushSubscription(req: Request, body: any) {
  const current = await authProfile(req);
  const endpoint = String(body.endpoint || '').trim();
  if (!endpoint) return { ok: true };
  const { error } = await admin.from('push_subscriptions')
    .delete().eq('user_id', current.user.id).eq('endpoint', endpoint);
  if (error) throw error;
  return { ok: true };
}

const PROFILE_FIELDS = 'id,email,role,access_status,access_granted,is_owner,created_at';

async function findProfileByEmail(email: string) {
  const { data, error } = await admin.from('profiles').select(PROFILE_FIELDS).eq('email', email).maybeSingle();
  if (error) throw error;
  return data;
}

async function waitForProfile(userId: string) {
  for (let i = 0; i < 7; i += 1) {
    const result = await admin.from('profiles').select(PROFILE_FIELDS).eq('id', userId).maybeSingle();
    if (result.error) throw result.error;
    if (result.data) return result.data;
    await new Promise(resolve => setTimeout(resolve, 150 * (i + 1)));
  }
  return null;
}

async function createManualInvite(email: string) {
  const generated = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: SITE_URL, data: { shamatha_invited: true } }
  });
  if (generated.error || !generated.data.user) throw generated.error || new Error('Falha ao criar usuário.');
  return generated.data;
}

async function inviteUser(body: any) {
  const email = cleanEmail(body.email);
  if (!validEmail(email)) throw Object.assign(new Error('Informe um e-mail válido.'), { status: 400 });

  const existing = await findProfileByEmail(email);
  if (existing) return { user: existing, invited: false, created: false, existing: true };

  const generated = await createManualInvite(email);
  const profile = await waitForProfile(generated.user.id);
  if (!profile) throw new Error('Usuário criado, mas o perfil ainda está sendo preparado.');

  const { data, error } = await admin.from('profiles')
    .update({ role: 'student', access_status: 'pending' })
    .eq('id', profile.id)
    .select(PROFILE_FIELDS)
    .single();
  if (error) throw error;

  return { user: data, invited: true, created: true, existing: false };
}

async function generateInviteLink(body: any) {
  const email = cleanEmail(body.email);
  if (!validEmail(email)) throw Object.assign(new Error('Informe um e-mail válido.'), { status: 400 });

  const profile = await findProfileByEmail(email);
  if (!profile) throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 });

  const authResult = await admin.auth.admin.getUserById(profile.id);
  if (authResult.error || !authResult.data.user) throw authResult.error || new Error('Conta de autenticação não encontrada.');
  if (authResult.data.user.email_confirmed_at) {
    throw Object.assign(new Error('Esta conta já foi confirmada.'), { status: 400 });
  }

  const metadata = { ...(authResult.data.user.user_metadata || {}), shamatha_invited: true };
  const updated = await admin.auth.admin.updateUserById(profile.id, { user_metadata: metadata });
  if (updated.error) throw updated.error;

  const generated = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: SITE_URL }
  });
  if (generated.error) throw generated.error;
  const link = generated.data.properties?.action_link || '';
  if (!link) throw new Error('Não foi possível gerar o link do convite.');
  return { email, link };
}

async function deleteUser(body: any, editorId: string) {
  const email = cleanEmail(body.email);
  if (!validEmail(email)) throw Object.assign(new Error('Informe um e-mail válido.'), { status: 400 });
  const { data: target, error } = await admin.from('profiles').select('id,email,is_owner').eq('email', email).maybeSingle();
  if (error) throw error;
  if (!target) throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 });
  if (target.is_owner) throw Object.assign(new Error('A conta principal não pode ser deletada.'), { status: 400 });
  if (target.id === editorId) throw Object.assign(new Error('Você não pode deletar a própria conta enquanto está usando o painel.'), { status: 400 });
  const removed = await admin.auth.admin.deleteUser(target.id);
  if (removed.error) throw removed.error;
  return { ok: true, id: target.id, email: target.email };
}

async function scheduleClass(body: any, editorId: string) {
  const url = validUrl(body.url);
  if (!url) throw Object.assign(new Error('Informe uma URL válida para a aula.'), { status: 400 });
  const date = new Date(String(body.startsAt || ''));
  if (!Number.isFinite(date.getTime())) throw Object.assign(new Error('Informe data e hora válidas.'), { status: 400 });
  if (date.getTime() <= Date.now() + 60000) throw Object.assign(new Error('Agende a aula para um horário futuro.'), { status: 400 });
  const { data: klass, error } = await admin.from('live_classes').insert({
    url, starts_at: date.toISOString(), status: 'scheduled', created_by: editorId
  }).select('*').single();
  if (error) throw error;
  const when = formatCuritiba(klass.starts_at);
  const push = await sendPush({
    title: 'Nova aula ao vivo agendada',
    body: `A próxima aula será em ${when} (horário de Curitiba).`,
    url: SITE_URL,
    tag: `live-class-${klass.id}`
  });
  await admin.from('live_classes').update({ announced_at: new Date().toISOString() }).eq('id', klass.id);
  return { liveClass: klass, push };
}

async function cancelClass(body: any) {
  const id = String(body.id || '');
  const { data: klass, error } = await admin.from('live_classes').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!klass) return { deleted: true, id, push: { sent: 0 } };
  const push = await sendPush({
    title: 'Aula ao vivo cancelada',
    body: `A aula prevista para ${formatCuritiba(klass.starts_at)} foi cancelada.`,
    url: SITE_URL,
    tag: `live-class-${id}`
  });
  const removed = await admin.from('live_classes').delete().eq('id', id);
  if (removed.error) throw removed.error;
  return { deleted: true, id, push };
}

async function runCron(req: Request) {
  const cfg = await config();
  const given = req.headers.get('x-cron-secret') || '';
  if (!cfg.cron_secret || given !== cfg.cron_secret) throw Object.assign(new Error('Cron não autorizado.'), { status: 401 });
  const now = new Date();
  const cleanupBefore = new Date(now.getTime() - 60 * 60000).toISOString();
  const cleanup = await admin.from('live_classes').delete().lte('starts_at', cleanupBefore);
  if (cleanup.error) throw cleanup.error;
  const limit = new Date(now.getTime() + 30 * 60000);
  const { data: classes, error } = await admin.from('live_classes')
    .select('*')
    .eq('status', 'scheduled')
    .is('reminder_sent_at', null)
    .gt('starts_at', now.toISOString())
    .lte('starts_at', limit.toISOString())
    .order('starts_at', { ascending: true });
  if (error) throw error;
  const results = [];
  for (const klass of classes || []) {
    const push = await sendPush({
      title: 'Aula ao vivo em 30 minutos',
      body: `A aula começa às ${new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(klass.starts_at))}.`,
      url: SITE_URL,
      tag: `live-class-${klass.id}`
    });
    await admin.from('live_classes').update({ reminder_sent_at: new Date().toISOString() }).eq('id', klass.id);
    results.push({ id: klass.id, push });
  }
  return { checkedAt: now.toISOString(), reminders: results, cleanupBefore };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método inválido.' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    if (action === 'bootstrap') return json(await bootstrapPush());
    if (action === 'cron') return json(await runCron(req));
    if (action === 'push_subscribe') return json(await savePushSubscription(req, body));
    if (action === 'push_unsubscribe') return json(await removePushSubscription(req, body));

    const editor = await requireEditor(req);
    if (action === 'invite_user') return json(await inviteUser(body));
    if (action === 'generate_invite_link') return json(await generateInviteLink(body));
    if (action === 'delete_user') return json(await deleteUser(body, editor.profile.id));
    if (action === 'schedule_class') return json(await scheduleClass(body, editor.profile.id));
    if (action === 'cancel_class') return json(await cancelClass(body));
    return json({ error: 'Operação desconhecida.' }, 404);
  } catch (error: any) {
    console.error(error);
    return json({ error: String(error?.message || 'Falha na operação.') }, Number(error?.status || 500));
  }
});
