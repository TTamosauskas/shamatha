(() => {
  'use strict';
  const root = document.getElementById('stages');
  const title = document.getElementById('stageContentTitle');
  const button = document.getElementById('addStageButton');
  const status = document.getElementById('addStageStatus');
  if (!root || !title || !button || !status) return;

  const MAX_ELEPHANT_STAGES = 9;

  function stageCount() {
    return root.querySelectorAll('[data-stage-details]').length;
  }

  function sync() {
    const count = stageCount();
    title.textContent = `Estágios do elefante · ${count}/${MAX_ELEPHANT_STAGES}`;
    button.disabled = count >= MAX_ELEPHANT_STAGES;
    button.title = count >= MAX_ELEPHANT_STAGES
      ? 'Os 9 estágios do elefante já estão definidos. Acrescente conteúdo pelas etapas filhas.'
      : 'Adicionar um estágio principal ao final do caminho';
  }

  function setStatus(message, kind = 'good') {
    status.textContent = message;
    status.className = `status ${kind}`;
  }

  button.addEventListener('click', async () => {
    if (stageCount() >= MAX_ELEPHANT_STAGES) {
      return setStatus('Os 9 estágios do elefante já estão definidos. Use “Adicionar etapa filha” para acrescentar aulas.', 'bad');
    }
    button.disabled = true;
    setStatus('Adicionando estágio…');
    try {
      const data = await window.ShamathaBackend.request('/api/editor/stages', { method:'POST', body:'{}' });
      if (!data?.stage) throw new Error('O novo estágio não foi retornado pelo serviço.');
      if (typeof editorData !== 'undefined' && typeof renderStages === 'function') {
        editorData.stages = [...(editorData.stages || []), data.stage].sort((a,b) => Number(a.position || a.number) - Number(b.position || b.number));
        renderStages(data.stage.number);
        sync();
        setStatus(`Estágio ${data.stage.number} adicionado. Edite os campos e salve.`);
      } else {
        location.reload();
      }
    } catch (error) {
      setStatus(error?.message || 'Falha ao adicionar o estágio.', 'bad');
      sync();
    }
  });

  new MutationObserver(sync).observe(root, { childList:true, subtree:false });
  sync();
})();