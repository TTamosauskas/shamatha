(() => {
  'use strict';

  const base = window.ShamathaBackend;
  if (!base?.request || !base?.getClient) return;

  const sb = base.getClient();
  const originalRequest = base.request.bind(base);
  const AUDIO_BUCKET = 'shamatha-audio';

  function fail(message, status = 400) {
    const error = new Error(message || 'Falha ao excluir definitivamente a etapa.');
    error.status = status;
    throw error;
  }

  function parseBody(options = {}) {
    if (!options.body) return {};
    if (typeof options.body === 'object') return options.body;
    try { return JSON.parse(options.body); }
    catch (_) { return fail('Dados enviados em formato inválido.'); }
  }

  async function purgeStage(options) {
    const stageId = String(parseBody(options).stageId || '');
    if (!stageId) fail('Etapa inválida.');

    const result = await sb.rpc('purge_shamatha_stage', { p_stage_id:stageId });
    if (result.error) fail(result.error.message || 'Falha ao excluir definitivamente a etapa.');

    const deleted = Array.isArray(result.data) ? result.data : [];
    const audioPaths = [...new Set(deleted.map(row => String(row.deleted_audio_path || '').trim()).filter(Boolean))];

    if (audioPaths.length) {
      const removed = await sb.storage.from(AUDIO_BUCKET).remove(audioPaths);
      if (removed.error) {
        fail('A etapa foi excluída, porém alguns arquivos de áudio ficaram pendentes de limpeza.', 500);
      }
    }

    return {
      ok:true,
      stageId,
      deletedStageIds:deleted.map(row => row.deleted_stage_id).filter(Boolean),
      deletedAudioPaths:audioPaths
    };
  }

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    if (path === '/api/editor/stage-purge' && method === 'POST') return purgeStage(options);
    if (path === '/api/editor/child-stage-purge' && method === 'POST') return purgeStage(options);
    return originalRequest(path, options);
  }

  window.ShamathaBackend = Object.freeze({ ...base, request });
})();
