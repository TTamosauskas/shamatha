(() => {
  'use strict';

  const base = window.ShamathaBackend;
  if (!base?.request) return;

  let appSnapshot = null;

  function forceDeadline(stages) {
    if (!Array.isArray(stages)) return stages;
    return stages.map(stage => ({ ...stage, advancementRequirement:'deadline' }));
  }

  function deadlineCopy() {
    const progress = appSnapshot?.progress;
    if (!progress) return;
    const stageNumber = Number(progress.currentStage || 1);
    const cfg = appSnapshot.stages?.[stageNumber - 1];
    const st = progress.stages?.[stageNumber] || progress.stages?.[String(stageNumber)];
    if (!cfg || !st || st.completedAt || !st.cycleStartedAt) return;

    const required = Math.max(1, Number(cfg.sessionsRequired || 1));
    const count = Math.min(required, (st.sessions || []).filter(session => session?.countedForProgress).length);
    if (count < required) return;

    const end = new Date(st.cycleStartedAt).getTime() + Number(cfg.deadlineDays || 1) * 86400000;
    const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / 86400000));
    const dayLabel = daysLeft === 1 ? 'dia' : 'dias';

    const mini = document.getElementById('miniProgress');
    const miniText = `${count}/${required} · ainda ${daysLeft} ${dayLabel} para praticar`;
    if (mini && mini.textContent !== miniText) mini.textContent = miniText;

    document.querySelectorAll('.progress-facts span:last-child').forEach(node => {
      const text = String(node.textContent || '');
      if (!/Meta de sessões cumprida|Meta cumprida|avança ao fim do prazo/i.test(text)) return;
      const desired = `Meta cumprida. Você ainda tem ${daysLeft} ${dayLabel} para praticar.`;
      if (node.textContent !== desired) node.textContent = desired;
    });
  }

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();

    if ((path === '/api/app-data' || path === '/api/editor/data') && method === 'GET') {
      const result = await base.request(path, options);
      result.stages = forceDeadline(result.stages);
      if (path === '/api/app-data') appSnapshot = result;
      queueMicrotask(deadlineCopy);
      return result;
    }

    const stageMatch = path.match(/^\/api\/editor\/stages\/(\d+)$/);
    if (stageMatch && method === 'PUT') {
      const result = await base.request(path, options);
      if (result?.stage) result.stage.advancementRequirement = 'deadline';
      return result;
    }

    return base.request(path, options);
  }

  window.ShamathaBackend = Object.freeze({ ...base, request });

  if (document.body) {
    new MutationObserver(deadlineCopy).observe(document.body, { childList:true, subtree:true, characterData:true });
    setInterval(deadlineCopy, 30000);
  }
})();
