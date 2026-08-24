(() => {
  'use strict';
  const base = window.ShamathaBackend;
  if (!base?.request || !base?.getClient) return;
  const sb = base.getClient();
  const originalRequest = base.request.bind(base);

  function fail(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    throw error;
  }

  function liveClassFromRow(row) {
    if (!row) return null;
    return {
      id:row.id,
      url:row.url,
      startsAt:row.starts_at,
      status:row.status,
      announcedAt:row.announced_at,
      reminderSentAt:row.reminder_sent_at,
      createdAt:row.created_at
    };
  }

  async function visibleLiveClass() {
    const floor = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data, error } = await sb.from('live_classes')
      .select('*')
      .eq('status','scheduled')
      .gte('starts_at', floor)
      .order('starts_at',{ascending:true})
      .limit(1)
      .maybeSingle();
    if (error) fail(error.message || 'Falha ao consultar a próxima aula.');
    return liveClassFromRow(data);
  }

  async function futureLiveClasses() {
    const { data, error } = await sb.from('live_classes')
      .select('*')
      .eq('status','scheduled')
      .gt('starts_at', new Date().toISOString())
      .order('starts_at',{ascending:true})
      .limit(20);
    if (error) fail(error.message || 'Falha ao consultar as aulas.');
    return (data || []).map(liveClassFromRow);
  }

  async function invokeOps(body) {
    const result = await sb.functions.invoke('shamatha-ops',{body});
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

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();

    if (path === '/api/app-data' && method === 'GET') {
      const data = await originalRequest(path, options);
      const liveClass = await visibleLiveClass();
      data.nextLiveClass = liveClass;
      data.settings = data.settings || {};
      data.settings.liveClassUrl = '';
      if (liveClass) {
        const diff = new Date(liveClass.startsAt).getTime() - Date.now();
        if (diff <= 0 && diff >= -30 * 60 * 1000) data.settings.liveClassUrl = liveClass.url;
      }
      return data;
    }

    if (path === '/api/live-class' && method === 'GET') return { liveClass:await visibleLiveClass() };

    if (path === '/api/editor/data' && method === 'GET') {
      const data = await originalRequest(path, options);
      data.liveClasses = await futureLiveClasses();
      return data;
    }

    if (path === '/api/editor/user' && method === 'DELETE') {
      let body = {};
      try { body = typeof options.body === 'string' ? JSON.parse(options.body) : (options.body || {}); }
      catch (_) { fail('Dados enviados em formato inválido.'); }
      return invokeOps({ action:'delete_user', email:body.email });
    }

    return originalRequest(path, options);
  }

  window.ShamathaBackend = Object.freeze({ ...base, request });
})();
