(() => {
  'use strict';

  const tbody = document.getElementById('usersBody');
  const stagesRoot = document.getElementById('stages');
  const status = document.getElementById('accessStatus');
  if (!tbody) return;

  let positionsByUserId = {};
  let ready = false;
  let scheduled = false;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function editorState() {
    return typeof editorData !== 'undefined' ? editorData : null;
  }

  function userByEmail(email) {
    const state = editorState();
    return (state?.users || []).find(user => String(user.email || '').trim().toLowerCase() === String(email || '').trim().toLowerCase()) || null;
  }

  function positionOptions() {
    const state = editorState();
    if (!state?.stages?.length) return [];
    const children = Array.isArray(state.childStages) ? state.childStages : [];
    const options = [];
    for (const stage of state.stages) {
      if (!stage?.stageId) continue;
      options.push({ value:stage.stageId, label:`Etapa ${stage.number} — ${stage.unitName || 'Sem título'}` });
      children
        .filter(child => child?.isActive !== false && child.parentStageId === stage.stageId)
        .sort((a,b) => Number(a.childIndex || a.childPosition || 0) - Number(b.childIndex || b.childPosition || 0))
        .forEach(child => options.push({ value:child.stageId, label:`↳ Etapa ${child.displayCode} — ${child.unitName || 'Aula de apoio'}` }));
    }
    return options;
  }

  function setMessage(message, kind = 'good') {
    if (!status) return;
    status.textContent = message;
    status.className = `status ${kind}`;
  }

  async function invoke(body) {
    const backend = window.ShamathaBackend;
    if (!backend?.getClient) throw new Error('Serviço indisponível.');
    const sb = backend.getClient();
    const { data, error } = await sb.functions.invoke('shamatha-editor-activity', { body });
    if (error) {
      let message = error.message || 'Falha ao atualizar o progresso.';
      try {
        const payload = await error.context?.json?.();
        if (payload?.error) message = payload.error;
      } catch (_) {}
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  async function loadPositions() {
    try {
      const data = await invoke({ action:'positions' });
      positionsByUserId = data.positionsByUserId || {};
      ready = true;
      syncRows();
    } catch (error) {
      ready = false;
      setMessage(error?.message || 'Não foi possível carregar a posição dos usuários.', 'bad');
    }
  }

  async function changePosition(select, user) {
    const next = select.value;
    const previous = positionsByUserId[user.id] || '';
    const label = select.selectedOptions?.[0]?.textContent?.trim() || 'a posição escolhida';
    const confirmed = window.confirm(`Posicionar ${user.email} em ${label}?\n\nAs sessões existentes serão preservadas. A etapa corrente será ajustada pelo editor.`);
    if (!confirmed) {
      select.value = previous;
      return;
    }

    const wrap = select.closest('.user-position-wrap');
    wrap?.classList.add('position-saving');
    select.disabled = true;
    try {
      const data = await invoke({ action:'set_position', userId:user.id, stageId:next });
      positionsByUserId[user.id] = data.stageId || next;
      select.value = positionsByUserId[user.id];
      setMessage(`${user.email} foi posicionado em ${data.label || label}.`);
    } catch (error) {
      select.value = previous;
      setMessage(error?.message || 'Falha ao reposicionar o usuário.', 'bad');
    } finally {
      select.disabled = false;
      wrap?.classList.remove('position-saving');
    }
  }

  function ensureSelector(row) {
    const emailCell = row.querySelector('.user-email-cell');
    const activityCell = row.querySelector('.user-last-session-cell');
    if (!emailCell || !activityCell) return;
    const email = String(emailCell.dataset.email || emailCell.querySelector('.user-email-text')?.textContent || emailCell.textContent || '').replace('✏️','').trim().toLowerCase();
    const user = userByEmail(email);
    if (!user || user.role === 'editor' || user.isOwner) {
      activityCell.querySelector('.user-position-wrap')?.remove();
      return;
    }

    const options = positionOptions();
    if (!options.length) return;
    let wrap = activityCell.querySelector('.user-position-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'user-position-wrap';
      wrap.innerHTML = '<select class="user-position-select" aria-label="Posição atual do usuário"></select><small class="user-position-help">Posição manual no caminho</small>';
      activityCell.appendChild(wrap);
    }

    const select = wrap.querySelector('.user-position-select');
    const signature = options.map(option => option.value).join('|');
    if (select.dataset.optionsSignature !== signature) {
      select.innerHTML = options.map(option => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('');
      select.dataset.optionsSignature = signature;
    }
    const current = positionsByUserId[user.id] || options[0].value;
    if ([...select.options].some(option => option.value === current)) select.value = current;
    select.disabled = !ready;
    if (!select.dataset.positionBound) {
      select.dataset.positionBound = '1';
      select.addEventListener('change', () => changePosition(select, user));
    }
  }

  function syncRows() {
    scheduled = false;
    tbody.querySelectorAll('tr').forEach(ensureSelector);
  }

  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(syncRows);
  }

  new MutationObserver(scheduleSync).observe(tbody, { childList:true, subtree:true });
  if (stagesRoot) new MutationObserver(scheduleSync).observe(stagesRoot, { childList:true, subtree:true });

  const timer = setInterval(() => {
    if (!editorState()?.users || !editorState()?.stages) return;
    clearInterval(timer);
    scheduleSync();
    loadPositions();
  }, 80);
})();
