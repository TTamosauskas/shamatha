const $ = id => document.getElementById(id);
let editorData = null;

async function api(path, options = {}) {
  try {
    return await window.ShamathaBackend.request(path, options);
  } catch (error) {
    if (error?.status === 401) location.href = './index.html';
    if (error?.status === 403) location.href = './app.html';
    throw error;
  }
}

function setStatus(id, message, kind = 'good') {
  const el = $(id);
  el.textContent = message;
  el.className = `status ${kind}`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function formatDate(ts) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ts));
}

function updateUser(user) {
  const idx = editorData.users.findIndex(item => item.id === user.id);
  if (idx >= 0) editorData.users[idx] = user;
  else editorData.users.push(user);
}

function renderUsers() {
  const users = editorData.users || [];
  $('userCount').textContent = `${users.length} ${users.length === 1 ? 'usuário' : 'usuários'}`;
  $('usersBody').innerHTML = users.length ? users.map(user => {
    const isEditor = user.role === 'editor';
    const roleLabel = user.isOwner ? '<span class="badge owner">Editor principal</span>' : `
      <select class="user-role role-select" data-email="${esc(user.email)}" aria-label="Função de ${esc(user.email)}">
        <option value="student" ${isEditor ? '' : 'selected'}>Aluno</option>
        <option value="editor" ${isEditor ? 'selected' : ''}>Editor</option>
      </select>`;
    const accessLabel = isEditor ? '<span class="badge good">Editor ativo</span>' : `<span class="badge ${user.accessGranted ? 'good' : 'pending'}">${user.accessGranted ? 'Liberado' : 'Aguardando'}</span>`;
    const accessAction = isEditor
      ? '<span class="muted">Acesso permanente</span>'
      : `<button class="btn ${user.accessGranted ? 'danger' : 'primary'} small user-access" data-email="${esc(user.email)}" data-granted="${user.accessGranted ? '0' : '1'}">${user.accessGranted ? 'Suspender' : 'Liberar'}</button>`;
    return `
      <tr>
        <td>${esc(user.email)}</td>
        <td>${esc(formatDate(user.createdAt))}</td>
        <td>${roleLabel}</td>
        <td>${accessLabel}</td>
        <td>${accessAction}</td>
      </tr>`;
  }).join('') : '<tr><td colspan="5" class="muted">Ainda não há usuários cadastrados.</td></tr>';

  document.querySelectorAll('.user-access').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await setAccess(btn.dataset.email, btn.dataset.granted === '1');
    } catch (error) {
      setStatus('accessStatus', error.message, 'bad');
    } finally { btn.disabled = false; }
  }));

  document.querySelectorAll('.user-role').forEach(select => select.addEventListener('change', async () => {
    select.disabled = true;
    try {
      const data = await api('/api/editor/role', {
        method:'PUT',
        body:JSON.stringify({ email:select.dataset.email, role:select.value })
      });
      updateUser(data.user);
      renderUsers();
      setStatus('accessStatus', `${data.user.email}: função alterada para ${data.user.role === 'editor' ? 'editor' : 'aluno'}.`);
      if (editorData.currentUser?.id === data.user.id && data.user.role !== 'editor') location.href = './app.html';
    } catch (error) {
      renderUsers();
      setStatus('accessStatus', error.message, 'bad');
    }
  }));
}

function audioBlock(stage) {
  const hasAudio = Boolean(stage.audioUrl || stage.audioPath);
  const current = stage.audioName
    ? `<strong>${esc(stage.audioName)}</strong>`
    : hasAudio ? '<strong>Áudio atual configurado</strong>' : '<span class="muted">Nenhum áudio enviado.</span>';
  const player = stage.audioUrl ? `<audio class="audio-preview" controls preload="metadata" src="${esc(stage.audioUrl)}"></audio>` : '';
  return `
    <div class="field audio-field">
      <label>Áudio da prática</label>
      <div class="audio-current">${current}${player}</div>
      <div class="audio-upload-row">
        <input class="audio-file" type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/wav,audio/x-wav,audio/webm,.mp3,.m4a,.aac,.ogg,.wav,.webm">
        <button class="btn secondary small audio-upload" type="button">Enviar arquivo</button>
        <button class="btn danger small audio-remove" type="button" ${hasAudio ? '' : 'disabled'}>Remover áudio</button>
      </div>
      <small class="field-help">MP3, M4A, AAC, OGG, WAV ou WEBM, até 100 MB. O arquivo fica em armazenamento privado.</small>
    </div>`;
}

function renderStages(openStage = null) {
  $('stages').innerHTML = editorData.stages.map(stage => `
    <details ${(openStage === stage.number || (!openStage && stage.number === 1)) ? 'open' : ''} data-stage-details="${stage.number}">
      <summary>Etapa ${stage.number} — ${esc(stage.unitName)}</summary>
      <form class="details-body stage-form" data-stage="${stage.number}">
        <div class="three">
          <div class="field"><label>Nome da etapa</label><input name="stageName" value="${esc(stage.stageName)}" maxlength="120" required></div>
          <div class="field"><label>Nome da unidade</label><input name="unitName" value="${esc(stage.unitName)}" maxlength="160" required></div>
          <div class="field"><label>Sessões necessárias</label><input name="sessionsRequired" type="number" min="1" max="30" value="${stage.sessionsRequired}" required></div>
        </div>
        <div class="field"><label>Objetivo / apresentação</label><textarea name="objective" maxlength="1200">${esc(stage.objective)}</textarea></div>
        <div class="field"><label>URL do vídeo</label><input name="videoUrl" type="url" value="${esc(stage.videoUrl)}" placeholder="https://www.youtube.com/watch?v=... ou URL de MP4"></div>
        ${audioBlock(stage)}
        <div class="three">
          <div class="field"><label>Prazo do ciclo (dias)</label><input name="deadlineDays" type="number" min="1" max="365" value="${stage.deadlineDays}" required></div>
          <div class="field"><label>Tempo mínimo válido (segundos)</label><input name="minSessionSeconds" type="number" min="0" max="86400" value="${stage.minSessionSeconds}" required></div>
          <div class="field"><label>&nbsp;</label><button class="btn primary" type="submit">Salvar etapa ${stage.number}</button></div>
        </div>
        <div class="status hidden stage-status"></div>
      </form>
    </details>`).join('');

  document.querySelectorAll('.stage-form').forEach(form => {
    const number = Number(form.dataset.stage);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const fd = new FormData(form);
      const payload = Object.fromEntries(fd.entries());
      payload.sessionsRequired = Number(payload.sessionsRequired);
      payload.deadlineDays = Number(payload.deadlineDays);
      payload.minSessionSeconds = Number(payload.minSessionSeconds);
      const status = form.querySelector('.stage-status');
      try {
        const data = await api(`/api/editor/stages/${number}`, { method:'PUT', body:JSON.stringify(payload) });
        editorData.stages[number - 1] = data.stage;
        status.textContent = `Etapa ${number} salva.`;
        status.className = 'status good stage-status';
        form.closest('details').querySelector('summary').textContent = `Etapa ${number} — ${data.stage.unitName}`;
      } catch (error) {
        status.textContent = error.message;
        status.className = 'status bad stage-status';
      }
    });

    const fileInput = form.querySelector('.audio-file');
    const uploadButton = form.querySelector('.audio-upload');
    const removeButton = form.querySelector('.audio-remove');
    const status = form.querySelector('.stage-status');

    uploadButton.addEventListener('click', async () => {
      const file = fileInput.files?.[0];
      if (!file) {
        status.textContent = 'Escolha um arquivo de áudio antes de enviar.';
        status.className = 'status bad stage-status';
        return;
      }
      uploadButton.disabled = true;
      removeButton.disabled = true;
      status.textContent = `Enviando ${file.name}...`;
      status.className = 'status stage-status';
      try {
        const data = await api(`/api/editor/stages/${number}/audio`, { method:'POST', body:{ file } });
        editorData.stages[number - 1] = data.stage;
        renderStages(number);
        const refreshed = document.querySelector(`.stage-form[data-stage="${number}"] .stage-status`);
        refreshed.textContent = `Áudio “${data.stage.audioName || file.name}” enviado e protegido.`;
        refreshed.className = 'status good stage-status';
      } catch (error) {
        status.textContent = error.message;
        status.className = 'status bad stage-status';
        uploadButton.disabled = false;
        removeButton.disabled = false;
      }
    });

    removeButton.addEventListener('click', async () => {
      removeButton.disabled = true;
      uploadButton.disabled = true;
      try {
        const data = await api(`/api/editor/stages/${number}/audio`, { method:'DELETE' });
        editorData.stages[number - 1] = data.stage;
        renderStages(number);
        const refreshed = document.querySelector(`.stage-form[data-stage="${number}"] .stage-status`);
        refreshed.textContent = 'Áudio removido da etapa.';
        refreshed.className = 'status good stage-status';
      } catch (error) {
        status.textContent = error.message;
        status.className = 'status bad stage-status';
        removeButton.disabled = false;
        uploadButton.disabled = false;
      }
    });
  });
}

async function setAccess(email, accessGranted) {
  const data = await api('/api/editor/access', { method:'PUT', body:JSON.stringify({ email, accessGranted }) });
  updateUser(data.user);
  renderUsers();
  setStatus('accessStatus', `${data.user.email}: acesso ${data.user.accessGranted ? 'liberado' : 'suspenso'}.`);
}

$('accessForm').addEventListener('submit', async event => {
  event.preventDefault();
  try { await setAccess($('accessEmail').value, true); }
  catch (error) { setStatus('accessStatus', error.message, 'bad'); }
});

$('revokeByEmail').addEventListener('click', async () => {
  try { await setAccess($('accessEmail').value, false); }
  catch (error) { setStatus('accessStatus', error.message, 'bad'); }
});

$('settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const data = await api('/api/editor/settings', { method:'PUT', body:JSON.stringify({ liveClassUrl:$('liveClassUrl').value, whatsappPhone:$('whatsappPhone').value }) });
    editorData.settings = data.settings;
    $('liveClassUrl').value = data.settings.liveClassUrl || '';
    $('whatsappPhone').value = data.settings.whatsappPhone || '';
    setStatus('settingsStatus', 'Configurações salvas. O botão “Ao Vivo” passa a usar esse link exato.');
  } catch (error) { setStatus('settingsStatus', error.message, 'bad'); }
});

$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method:'POST', body:'{}' }).catch(() => null);
  location.href = './index.html';
});

(async () => {
  try {
    editorData = await api('/api/editor/data');
    $('liveClassUrl').value = editorData.settings.liveClassUrl || '';
    $('whatsappPhone').value = editorData.settings.whatsappPhone || '';
    renderUsers();
    renderStages();
  } catch (error) {
    setStatus('accessStatus', error.message, 'bad');
  }
})();
