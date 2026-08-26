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
    try {
      return await window.ShamathaBackend.request(path, options);
    } catch (error) {
      if (error?.status === 401) location.href = '../index.html';
      if (error?.status === 403) location.href = '../app.html';
      throw error;
    }
  }

  function stages() {
    return Array.isArray(data?.archivedStages) ? data.archivedStages : [];
  }

  function render() {
    const archived = stages();
    count.textContent = `${archived.length} ${archived.length === 1 ? 'etapa' : 'etapas'}`;
    empty.classList.toggle('hidden', archived.length !== 0);
    list.innerHTML = archived.map(stage => `
      <div class="trash-row" data-stage-id="${esc(stage.stageId)}">
        <div class="trash-row-main">
          <strong>${esc(stage.unitName || 'Etapa sem nome')}</strong>
          <small>Conteúdo e histórico preservados</small>
        </div>
        <button class="btn secondary small restore-stage" type="button" data-stage-id="${esc(stage.stageId)}">Restaurar</button>
      </div>`).join('');

    list.querySelectorAll('.restore-stage').forEach(button => {
      button.addEventListener('click', () => restore(button.dataset.stageId));
    });
  }

  async function refresh() {
    data = await api('/api/editor/data');
    render();
  }

  async function restore(stageId) {
    if (busy || !stageId) return;
    const stage = stages().find(item => item.stageId === stageId);
    if (!stage) return;
    busy = true;
    list.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      await api('/api/editor/stage-restore', {
        method:'POST',
        body:JSON.stringify({ stageId })
      });
      await refresh();
      setStatus(`“${stage.unitName || 'Etapa'}” restaurada no final do caminho.`);
    } catch (error) {
      setStatus(error?.message || 'Falha ao restaurar a etapa.', 'bad');
      render();
    } finally {
      busy = false;
    }
  }

  logout.addEventListener('click', async () => {
    await api('/api/logout', { method:'POST', body:'{}' }).catch(() => null);
    location.href = '../index.html';
  });

  refresh().catch(error => setStatus(error?.message || 'Falha ao carregar a lixeira.', 'bad'));
})();
