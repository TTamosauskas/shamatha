(() => {
  'use strict';
  const root = document.getElementById('stages');
  const title = document.getElementById('stageContentTitle');
  const button = document.getElementById('addStageButton');
  const status = document.getElementById('addStageStatus');
  if (!root || !title || !button || !status) return;

  function stageCount() {
    return root.querySelectorAll('[data-stage-details]').length;
  }

  function sync() {
    const count = stageCount();
    title.textContent = `Conteúdo das ${count} ${count === 1 ? 'etapa' : 'etapas'}`;
    button.disabled = false;
    button.title = 'Adicionar uma nova etapa principal ao final do caminho';
  }

  function setStatus(message, kind = 'good') {
    status.textContent = message;
    status.className = `status ${kind}`;
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    setStatus('Adicionando etapa…');
    try {
      const data = await window.ShamathaBackend.request('/api/editor/stages', { method:'POST', body:'{}' });
      if (!data?.stage) throw new Error('A nova etapa não foi retornada pelo serviço.');
      if (typeof editorData !== 'undefined' && typeof renderStages === 'function') {
        editorData.stages = [...(editorData.stages || []), data.stage].sort((a,b) => Number(a.position || a.number) - Number(b.position || b.number));
        renderStages(data.stage.number);
        sync();
        setStatus(`Etapa ${data.stage.number} adicionada. Edite os campos e salve.`);
      } else {
        location.reload();
      }
    } catch (error) {
      setStatus(error?.message || 'Falha ao adicionar a etapa.', 'bad');
      sync();
    }
  });

  new MutationObserver(sync).observe(root, { childList:true, subtree:false });
  sync();
})();