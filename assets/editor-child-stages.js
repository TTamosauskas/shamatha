(() => {
  'use strict';

  const root = document.getElementById('stages');
  if (!root) return;
  let busy = false;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function childData() {
    return typeof editorData !== 'undefined' && Array.isArray(editorData?.childStages) ? editorData.childStages : [];
  }

  async function refreshChildren() {
    const fresh = await api('/api/editor/data');
    editorData = fresh;
    renderAll();
  }

  function status(section, message, kind = 'good') {
    const el = section.querySelector('.child-editor-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status ${kind} child-editor-status`;
  }

  async function addChild(parent, section) {
    if (busy || !parent?.stageId) return;
    busy = true;
    const button = section.querySelector('.add-child-stage');
    if (button) button.disabled = true;
    try {
      await api('/api/editor/child-stages', { method:'POST', body:JSON.stringify({ parentStageId:parent.stageId, releaseDay:1 }) });
      await refreshChildren();
      const refreshed = root.querySelector(`[data-stage-details="${parent.number}"] .child-editor`);
      if (refreshed) status(refreshed, `Etapa ${parent.number}.${(editorData.childStages || []).filter(child => child.parentStageId === parent.stageId).length} adicionada. Configure o dia e o conteúdo.`);
    } catch (error) {
      status(section, error?.message || 'Falha ao adicionar etapa filha.', 'bad');
    } finally { busy = false; }
  }

  async function saveChild(child, form, section) {
    if (busy) return;
    busy = true;
    const button = form.querySelector('.save-child-stage');
    button.disabled = true;
    try {
      await api(`/api/editor/child-stages/${child.stageId}`, {
        method:'PUT',
        body:JSON.stringify({
          unitName:form.querySelector('[name="childUnitName"]').value,
          releaseDay:Number(form.querySelector('[name="childReleaseDay"]').value),
          objective:form.querySelector('[name="childObjective"]').value,
          videoUrl:form.querySelector('[name="childVideoUrl"]').value
        })
      });
      await refreshChildren();
      const refreshed = root.querySelector(`[data-child-id="${child.stageId}"]`)?.closest('.child-editor');
      if (refreshed) status(refreshed, `${child.displayCode} salva.`);
    } catch (error) {
      status(section, error?.message || 'Falha ao salvar etapa filha.', 'bad');
    } finally { busy = false; button.disabled = false; }
  }

  async function archiveChild(child, section) {
    if (busy) return;
    if (!window.confirm(`Remover “${child.displayCode} — ${child.unitName || 'Aula de apoio'}”? O conteúdo será preservado na Lixeira.`)) return;
    busy = true;
    try {
      await api('/api/editor/child-stage-archive', { method:'POST', body:JSON.stringify({ stageId:child.stageId }) });
      await refreshChildren();
      const parentSection = root.querySelector(`[data-stage-id="${child.parentStageId}"] .child-editor`);
      if (parentSection) status(parentSection, 'Etapa filha movida para a Lixeira.');
    } catch (error) {
      status(section, error?.message || 'Falha ao remover etapa filha.', 'bad');
    } finally { busy = false; }
  }

  async function uploadAudio(child, form, section) {
    if (busy) return;
    const input = form.querySelector('[name="childAudioFile"]');
    const file = input.files?.[0];
    if (!file) return status(section, 'Escolha um arquivo de áudio.', 'bad');
    busy = true;
    try {
      await api(`/api/editor/child-stages/${child.stageId}/audio`, { method:'POST', body:{ file } });
      await refreshChildren();
      const refreshed = root.querySelector(`[data-child-id="${child.stageId}"]`)?.closest('.child-editor');
      if (refreshed) status(refreshed, 'Áudio próprio enviado.');
    } catch (error) {
      status(section, error?.message || 'Falha no upload do áudio.', 'bad');
    } finally { busy = false; }
  }

  async function removeAudio(child, section) {
    if (busy || (!child.ownAudioPath && !child.ownAudioUrl)) return;
    busy = true;
    try {
      await api(`/api/editor/child-stages/${child.stageId}/audio`, { method:'DELETE' });
      await refreshChildren();
      const refreshed = root.querySelector(`[data-child-id="${child.stageId}"]`)?.closest('.child-editor');
      if (refreshed) status(refreshed, `Áudio próprio removido. ${child.parentPosition ? `A aula passa a usar o áudio da Etapa ${child.parentPosition}, quando disponível.` : ''}`);
    } catch (error) {
      status(section, error?.message || 'Falha ao remover áudio.', 'bad');
    } finally { busy = false; }
  }

  function childMarkup(child) {
    const ownAudio = Boolean(child.ownAudioPath || child.ownAudioUrl);
    const audioNote = ownAudio
      ? `Áudio próprio: ${esc(child.ownAudioName || 'configurado')}`
      : child.inheritsAudio
        ? `Sem áudio próprio — usando o áudio da Etapa ${child.parentPosition}.`
        : `Sem áudio próprio — a Etapa ${child.parentPosition} também não possui áudio.`;
    return `<details class="child-editor-item" data-child-id="${esc(child.stageId)}">
      <summary><span class="child-code-badge">${esc(child.displayCode)}</span><span class="child-summary-title">${esc(child.unitName || 'Nova aula')}</span><span>Dia ${child.releaseDay}</span></summary>
      <form class="child-editor-form">
        <div class="child-editor-grid">
          <div class="field"><label>Nome da aula</label><input name="childUnitName" value="${esc(child.unitName || '')}" maxlength="180" required></div>
          <div class="field"><label>Dia</label><input name="childReleaseDay" type="number" min="1" max="${child.parentDeadlineDays}" value="${child.releaseDay}" required></div>
        </div>
        <div class="field"><label>Objetivo / apresentação</label><textarea name="childObjective" rows="4">${esc(child.objective || '')}</textarea></div>
        <div class="field"><label>URL do vídeo</label><input name="childVideoUrl" type="url" value="${esc(child.videoUrl || '')}" placeholder="https://..."></div>
        <div class="field"><label>Áudio próprio (opcional)</label><input name="childAudioFile" type="file" accept="audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav,audio/webm,.mp3,.m4a,.aac,.ogg,.wav,.webm"></div>
        <div class="child-audio-row"><span class="child-audio-note">${audioNote}</span><button class="btn secondary small upload-child-audio" type="button">Enviar áudio</button>${ownAudio ? '<button class="btn secondary small remove-child-audio" type="button">Usar áudio da mãe</button>' : ''}</div>
        <div class="child-editor-actions"><button class="btn primary small save-child-stage" type="submit">Salvar aula</button><button class="btn danger small archive-child-stage" type="button">Remover</button></div>
      </form>
    </details>`;
  }

  function buildSection(details, parent) {
    const existing = details.querySelector(':scope > .child-editor');
    if (existing) existing.remove();
    const children = childData().filter(child => child.parentStageId === parent.stageId).sort((a,b) => Number(a.childIndex)-Number(b.childIndex));
    const section = document.createElement('section');
    section.className = 'child-editor';
    section.innerHTML = `<div class="child-editor-head"><h4>Etapas filhas</h4><button class="btn secondary small add-child-stage" type="button">+ Adicionar etapa filha</button></div><div class="child-editor-status status hidden"></div>${children.length ? `<div class="child-editor-list">${children.map(childMarkup).join('')}</div>` : '<div class="child-empty">Nenhuma etapa filha nesta etapa.</div>'}`;
    details.appendChild(section);

    section.querySelector('.add-child-stage').addEventListener('click', () => addChild(parent, section));
    section.querySelectorAll('.child-editor-item').forEach(item => {
      const child = children.find(entry => entry.stageId === item.dataset.childId);
      const form = item.querySelector('.child-editor-form');
      item.addEventListener('toggle', () => {
        if (!item.open) return;
        section.querySelectorAll('.child-editor-item[open]').forEach(other => {
          if (other !== item) other.open = false;
        });
      });
      form.addEventListener('submit', event => { event.preventDefault(); saveChild(child, form, section); });
      item.querySelector('.archive-child-stage').addEventListener('click', () => archiveChild(child, section));
      item.querySelector('.upload-child-audio').addEventListener('click', () => uploadAudio(child, form, section));
      item.querySelector('.remove-child-audio')?.addEventListener('click', () => removeAudio(child, section));
    });
  }

  function renderAll() {
    if (typeof editorData === 'undefined' || !editorData?.stages) return;
    root.querySelectorAll('[data-stage-details]').forEach(details => {
      const position = Number(details.dataset.stageDetails);
      const parent = editorData.stages[position - 1];
      if (parent?.stageId) buildSection(details, parent);
    });
  }

  const observer = new MutationObserver(() => setTimeout(renderAll, 0));
  observer.observe(root, { childList:true, subtree:false });
  const timer = setInterval(() => {
    if (typeof editorData === 'undefined' || !editorData?.stages) return;
    clearInterval(timer);
    renderAll();
  }, 80);
})();