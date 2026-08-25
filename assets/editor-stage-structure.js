(() => {
  'use strict';

  const root = document.getElementById('stages');
  const archivedSection = document.getElementById('archivedStagesSection');
  const archivedList = document.getElementById('archivedStagesList');
  const globalStatus = document.getElementById('addStageStatus');
  if (!root || !archivedSection || !archivedList) return;

  let dragStageId = null;
  let busy = false;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function status(message, kind = 'good') {
    if (!globalStatus) return;
    globalStatus.textContent = message;
    globalStatus.className = `status ${kind}`;
  }

  function activeStages() {
    return typeof editorData !== 'undefined' && Array.isArray(editorData?.stages) ? editorData.stages : [];
  }

  function archivedStages() {
    return typeof editorData !== 'undefined' && Array.isArray(editorData?.archivedStages) ? editorData.archivedStages : [];
  }

  async function refresh(openStage = null) {
    const fresh = await api('/api/editor/data');
    editorData = fresh;
    renderStages(openStage);
    renderArchived();
  }

  async function persistOrder(stageIds, openStage = null) {
    if (busy) return;
    busy = true;
    try {
      await api('/api/editor/stage-order', {
        method:'PUT',
        body:JSON.stringify({ stageIds })
      });
      await refresh(openStage);
      status('Ordem das etapas atualizada.');
    } catch (error) {
      status(error?.message || 'Falha ao reordenar as etapas.', 'bad');
    } finally {
      busy = false;
    }
  }

  async function moveStage(stageId, delta) {
    const stages = activeStages();
    const index = stages.findIndex(stage => stage.stageId === stageId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= stages.length) return;
    const ids = stages.map(stage => stage.stageId);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await persistOrder(ids, target + 1);
  }

  async function moveStageTo(stageId, targetStageId) {
    const stages = activeStages();
    const ids = stages.map(stage => stage.stageId);
    const from = ids.indexOf(stageId);
    const target = ids.indexOf(targetStageId);
    if (from < 0 || target < 0 || from === target) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(target, 0, moved);
    await persistOrder(ids, target + 1);
  }

  async function archiveStage(stage) {
    if (busy || !stage?.stageId) return;
    if (activeStages().length <= 1) return status('O caminho precisa manter pelo menos uma etapa ativa.', 'bad');
    const label = stage.unitName || `Etapa ${stage.number}`;
    if (!window.confirm(`Remover “${label}” do caminho? O progresso histórico será preservado e a etapa poderá ser restaurada.`)) return;

    busy = true;
    try {
      await api('/api/editor/stage-archive', {
        method:'POST',
        body:JSON.stringify({ stageId:stage.stageId })
      });
      const nextOpen = Math.max(1, Math.min(Number(stage.number || 1), activeStages().length - 1));
      await refresh(nextOpen);
      status('Etapa removida do caminho. O histórico foi preservado.');
    } catch (error) {
      status(error?.message || 'Falha ao remover a etapa.', 'bad');
    } finally {
      busy = false;
    }
  }

  async function restoreStage(stage) {
    if (busy || !stage?.stageId) return;
    busy = true;
    try {
      await api('/api/editor/stage-restore', {
        method:'POST',
        body:JSON.stringify({ stageId:stage.stageId })
      });
      await refresh(activeStages().length + 1);
      status('Etapa restaurada no final do caminho. Você pode reordená-la agora.');
    } catch (error) {
      status(error?.message || 'Falha ao restaurar a etapa.', 'bad');
    } finally {
      busy = false;
    }
  }

  function renderArchived() {
    const stages = archivedStages();
    archivedSection.classList.toggle('hidden', !stages.length);
    if (!stages.length) {
      archivedList.innerHTML = '';
      return;
    }

    archivedList.innerHTML = stages.map(stage => `
      <div class="archived-stage-row" data-archived-stage-id="${esc(stage.stageId)}">
        <div>
          <strong>${esc(stage.unitName || 'Etapa sem nome')}</strong>
          <small>Conteúdo e histórico preservados</small>
        </div>
        <button class="btn secondary small restore-stage" type="button" data-stage-id="${esc(stage.stageId)}">Restaurar</button>
      </div>`).join('');

    archivedList.querySelectorAll('.restore-stage').forEach(button => {
      button.addEventListener('click', () => {
        const stage = stages.find(item => item.stageId === button.dataset.stageId);
        restoreStage(stage);
      });
    });
  }

  function decorateDetails() {
    const stages = activeStages();
    root.querySelectorAll('[data-stage-details]').forEach(details => {
      const position = Number(details.dataset.stageDetails);
      const stage = stages[position - 1];
      if (!stage?.stageId) return;

      details.dataset.stageId = stage.stageId;
      details.draggable = true;

      const form = details.querySelector('.stage-form');
      if (form && !form.querySelector('.stage-structure-bar')) {
        const bar = document.createElement('div');
        bar.className = 'stage-structure-bar';
        bar.innerHTML = `
          <span class="stage-drag-handle" title="Arraste para reordenar" aria-hidden="true">↕ Arrastar</span>
          <div class="stage-structure-actions">
            <button class="btn secondary small stage-order-btn move-stage-up" type="button" aria-label="Mover etapa para cima">↑</button>
            <button class="btn secondary small stage-order-btn move-stage-down" type="button" aria-label="Mover etapa para baixo">↓</button>
            <button class="btn danger small stage-remove-btn" type="button">Remover</button>
          </div>`;
        form.insertBefore(bar, form.firstChild);
      }

      const up = form?.querySelector('.move-stage-up');
      const down = form?.querySelector('.move-stage-down');
      const remove = form?.querySelector('.stage-remove-btn');
      if (up) {
        up.disabled = position <= 1;
        up.onclick = () => moveStage(stage.stageId, -1);
      }
      if (down) {
        down.disabled = position >= stages.length;
        down.onclick = () => moveStage(stage.stageId, 1);
      }
      if (remove) {
        remove.disabled = stages.length <= 1;
        remove.onclick = () => archiveStage(stage);
      }

      if (!details.dataset.dragBound) {
        details.dataset.dragBound = '1';
        details.addEventListener('dragstart', event => {
          const handle = event.target.closest?.('.stage-drag-handle');
          if (!handle) {
            event.preventDefault();
            return;
          }
          dragStageId = details.dataset.stageId;
          details.classList.add('stage-dragging');
          event.dataTransfer.effectAllowed = 'move';
          try { event.dataTransfer.setData('text/plain', dragStageId); } catch (_) {}
        });
        details.addEventListener('dragover', event => {
          if (!dragStageId || dragStageId === details.dataset.stageId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          details.classList.add('stage-drop-target');
        });
        details.addEventListener('dragleave', () => details.classList.remove('stage-drop-target'));
        details.addEventListener('drop', event => {
          event.preventDefault();
          details.classList.remove('stage-drop-target');
          const source = dragStageId || event.dataTransfer.getData('text/plain');
          const target = details.dataset.stageId;
          dragStageId = null;
          if (source && target && source !== target) moveStageTo(source, target);
        });
        details.addEventListener('dragend', () => {
          dragStageId = null;
          root.querySelectorAll('.stage-dragging,.stage-drop-target').forEach(item => item.classList.remove('stage-dragging','stage-drop-target'));
        });
      }
    });
  }

  const observer = new MutationObserver(() => {
    decorateDetails();
    renderArchived();
  });
  observer.observe(root, { childList:true, subtree:false });

  const syncTimer = setInterval(() => {
    if (typeof editorData === 'undefined' || !editorData) return;
    clearInterval(syncTimer);
    decorateDetails();
    renderArchived();
  }, 80);
})();
