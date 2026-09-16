(() => {
  'use strict';

  const base = window.ShamathaBackend;
  if (!base?.request || !base?.getClient) return;

  const originalRequest = base.request.bind(base);
  const sb = base.getClient();
  const CACHE_MS = 5000;
  let cachedUserId = '';
  let cachedRaw = null;
  let cachedAt = 0;

  function clone(value) {
    if (!value || typeof value !== 'object') return {};
    try { return structuredClone(value); }
    catch (_) { return JSON.parse(JSON.stringify(value)); }
  }

  function defaultState() {
    return {
      introStarted:false,
      introDone:false,
      videoPosition:0,
      cycleStartedAt:null,
      sessions:[],
      completedAt:null
    };
  }

  function normalizeState(value) {
    const state = { ...defaultState(), ...(value && typeof value === 'object' ? clone(value) : {}) };
    state.sessions = Array.isArray(state.sessions) ? state.sessions.slice(-500) : [];
    return state;
  }

  async function rawProgress(userId) {
    if (cachedUserId === userId && Date.now() - cachedAt < CACHE_MS) return cachedRaw;
    const result = await sb.from('progress').select('data').eq('user_id', userId).maybeSingle();
    if (result.error) return null;
    cachedUserId = userId;
    cachedRaw = result.data?.data && typeof result.data.data === 'object' ? clone(result.data.data) : null;
    cachedAt = Date.now();
    return cachedRaw;
  }

  function runtimeProgress(data, raw) {
    if (!raw || !Array.isArray(data?.stages) || !data.stages.length) return null;
    const statesById = raw.stagesById && typeof raw.stagesById === 'object' ? raw.stagesById : {};
    const legacy = raw.stages && typeof raw.stages === 'object' ? raw.stages : {};
    const stages = {};

    data.stages.forEach((stage, index) => {
      stages[index + 1] = normalizeState(statesById[stage.stageId] || legacy[index + 1]);
    });

    let currentStage = data.stages.findIndex(stage => stage.stageId === raw.currentStageId) + 1;
    if (!currentStage) {
      const firstIncomplete = data.stages.findIndex((_, index) => !stages[index + 1]?.completedAt);
      currentStage = firstIncomplete >= 0 ? firstIncomplete + 1 : data.stages.length;
    }

    const meta = clone(raw);
    delete meta.schemaVersion;
    delete meta.currentStageId;
    delete meta.stagesById;
    delete meta.currentStage;
    delete meta.stages;

    return {
      ...meta,
      currentStage,
      stages,
      childUnlocks:raw.childUnlocks && typeof raw.childUnlocks === 'object' ? clone(raw.childUnlocks) : {},
      updatedAt:Number(raw.updatedAt || Date.now())
    };
  }

  async function request(path, options = {}) {
    const result = await originalRequest(path, options);
    const method = String(options.method || 'GET').toUpperCase();
    if (path !== '/api/app-data' || method !== 'GET' || result?.user?.role !== 'editor') return result;

    const raw = await rawProgress(result.user.id);
    const progress = runtimeProgress(result, raw);
    if (progress) result.progress = progress;
    return result;
  }

  window.ShamathaBackend = Object.freeze({ ...base, request });
})();
