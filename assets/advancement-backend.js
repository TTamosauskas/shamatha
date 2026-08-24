(() => {
  'use strict';

  const base = window.ShamathaBackend;
  if (!base?.request || !base?.getClient) return;
  const sb = base.getClient();

  function normalizeRequirement(value) {
    return value === 'deadline' ? 'deadline' : 'sessions';
  }

  function parseBody(options = {}) {
    if (!options.body) return {};
    if (typeof options.body === 'object') return options.body;
    try { return JSON.parse(options.body); } catch (_) { return {}; }
  }

  async function attachRequirements(result) {
    if (!Array.isArray(result?.stages) || !result.stages.length) return result;
    const numbers = result.stages.map(stage => Number(stage.number)).filter(Boolean);
    const { data, error } = await sb.from('stages')
      .select('number,advancement_requirement')
      .in('number', numbers);
    if (error) throw new Error(error.message || 'Falha ao carregar as regras de avanço.');
    const byNumber = new Map((data || []).map(row => [Number(row.number), normalizeRequirement(row.advancement_requirement)]));
    result.stages = result.stages.map(stage => ({
      ...stage,
      advancementRequirement: byNumber.get(Number(stage.number)) || 'sessions'
    }));
    return result;
  }

  async function saveRequirement(number, options, result) {
    const body = parseBody(options);
    const requirement = normalizeRequirement(body.advancementRequirement);
    const { data, error } = await sb.from('stages')
      .update({ advancement_requirement: requirement, updated_at: new Date().toISOString() })
      .eq('number', number)
      .select('advancement_requirement')
      .single();
    if (error) throw new Error(error.message || 'Falha ao salvar o requisito de avanço.');
    if (result?.stage) result.stage.advancementRequirement = normalizeRequirement(data?.advancement_requirement);
    return result;
  }

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();

    if ((path === '/api/app-data' || path === '/api/editor/data') && method === 'GET') {
      return attachRequirements(await base.request(path, options));
    }

    const stageMatch = path.match(/^\/api\/editor\/stages\/(\d+)$/);
    if (stageMatch && method === 'PUT') {
      const result = await base.request(path, options);
      return saveRequirement(Number(stageMatch[1]), options, result);
    }

    return base.request(path, options);
  }

  window.ShamathaBackend = Object.freeze({ ...base, request });
})();
