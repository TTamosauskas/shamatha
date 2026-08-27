(() => {
  'use strict';

  const list = document.getElementById('trashList');
  const empty = document.getElementById('trashEmpty');
  const count = document.getElementById('trashCount');
  const statusEl = document.getElementById('trashStatus');
  const logout = document.getElementById('logout');
  let data = null;
  let busy = false;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function setStatus(message, kind = 'good') {
    statusEl.textContent = message;
    statusEl.className = `status ${kind}`;
  }

  async function api(path, options = {}) {
    try { return await window.ShamathaBackend.request(path, options); }
    catch (error) {
      if (error?.status === 401) location.href = '../index.html';
      if (error?.status === 403) location.href = '../app.html';
      throw error;
    }
  }

  function items() {
    const roots = (Array.isArray(data?.archivedStages) ? data.archivedStages : []).map(stage => ({ ...stage, trashType:'root' }));
    const children = (Array.isArray(data?.archivedChildStages) ? data.archivedChildStages : []).map(stage => ({ ...stage, trashType:'child' }));
    return [...roots, ...children];
  }

  function render() {
    const archived = items();
    count.textContent = `${archived.length} ${archived.length === 1 ? 'etapa' : 'etapas'}`;
    empty.classList.toggle('hidden', archived.length !== 0);
    list.innerHTML = archived.map(stage => {
      const child = stage.trashType === 'child';
      const label = child ? `Etapa filha ${stage.displayCode || ''}` : 'Etapa principal';
      const detail = child ? `Vinculada à ${stage.parentUnitName || `Etapa ${stage.parentPosition || ''}`}` : 'Conteúdo e histórico preservados';
      return `<div class="trash-row" data-stage-id="${esc(stage.stageId)}" data-trash-type="${stage.trashType}"><div class="trash-row-main"><small>${esc(label)}</small><strong>${esc(stage.unitName || 'Etapa sem nome')}</strong><small>${esc(detail)}</small></div><button class="btn secondary small restore-stage" type="button" data-stage-id="${esc(stage.stageId)}" data-trash-type="${stage.trashType}">Restaurar</button></div>`;
    }).join('');

    list.querySelectorAll('.restore-stage').forEach(button => {
      button.addEventListener('click', () => restore(button.dataset.stageId, button.dataset.trashType));
    });
  }

  async function refresh() {
    data = await api('/api/editor/data');
    render();
  }

  async function restore(stageId, type) {
    if (busy || !stageId) return;
    const stage = items().find(item => item.stageId === stageId && item.trashType === type);
    if (!stage) return;
    busy = true;
    list.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      const endpoint = type === 'child' ? '/api/editor/child-stage-restore' : '/api/editor/stage-restore';
      await api(endpoint, { method:'POST', body:JSON.stringify({ stageId }) });
      await refresh();
      setStatus(type === 'child'
        ? `“${stage.unitName || 'Etapa filha'}” restaurada na etapa mãe.`
        : `“${stage.unitName || 'Etapa'}” restaurada no final do caminho.`);
    } catch (error) {
      setStatus(error?.message || 'Falha ao restaurar a etapa.', 'bad');
      render();
    } finally { busy = false; }
  }

  logout.addEventListener('click', async () => {
    await api('/api/logout', { method:'POST', body:'{}' }).catch(() => null);
    location.href = '../index.html';
  });

  refresh().catch(error => setStatus(error?.message || 'Falha ao carregar a lixeira.', 'bad'));
})();
