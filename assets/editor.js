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

function renderUsers() {
  const users = editorData.users || [];
  $('userCount').textContent = `${users.length} ${users.length === 1 ? 'usuário' : 'usuários'}`;
  $('usersBody').innerHTML = users.length ? users.map(user => `
    <tr>
      <td>${esc(user.email)}</td>
      <td>${esc(formatDate(user.createdAt))}</td>
      <td><span class="badge ${user.accessGranted ? 'good' : 'pending'}">${user.accessGranted ? 'Liberado' : 'Aguardando'}</span></td>
      <td><button class="btn ${user.accessGranted ? 'danger' : 'primary'} small user-access" data-email="${esc(user.email)}" data-granted="${user.accessGranted ? '0' : '1'}">${user.accessGranted ? 'Suspender' : 'Liberar'}</button></td>
    </tr>`).join('') : '<tr><td colspan="4" style="color:#64748b">Ainda não há alunos cadastrados.</td></tr>';

  document.querySelectorAll('.user-access').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await setAccess(btn.dataset.email, btn.dataset.granted === '1');
    } finally { btn.disabled = false; }
  }));
}

function renderStages() {
  $('stages').innerHTML = editorData.stages.map(stage => `
    <details ${stage.number === 1 ? 'open' : ''}>
      <summary>Etapa ${stage.number} — ${esc(stage.unitName)}</summary>
      <form class="details-body stage-form" data-stage="${stage.number}">
        <div class="three">
          <div class="field"><label>Nome da etapa</label><input name="stageName" value="${esc(stage.stageName)}" maxlength="120" required></div>
          <div class="field"><label>Nome da unidade</label><input name="unitName" value="${esc(stage.unitName)}" maxlength="160" required></div>
          <div class="field"><label>Sessões necessárias</label><input name="sessionsRequired" type="number" min="1" max="30" value="${stage.sessionsRequired}" required></div>
        </div>
        <div class="field"><label>Objetivo / apresentação</label><textarea name="objective" maxlength="1200">${esc(stage.objective)}</textarea></div>
        <div class="field"><label>URL do vídeo</label><input name="videoUrl" type="url" value="${esc(stage.videoUrl)}" placeholder="https://www.youtube.com/watch?v=... ou URL de MP4"></div>
        <div class="field"><label>URL do áudio da prática</label><input name="audioUrl" type="url" value="${esc(stage.audioUrl)}" placeholder="https://.../meditacao.mp3"></div>
        <div class="three">
          <div class="field"><label>Prazo do ciclo (dias)</label><input name="deadlineDays" type="number" min="1" max="365" value="${stage.deadlineDays}" required></div>
          <div class="field"><label>Tempo mínimo válido (segundos)</label><input name="minSessionSeconds" type="number" min="0" max="86400" value="${stage.minSessionSeconds}" required></div>
          <div class="field"><label>&nbsp;</label><button class="btn primary" type="submit">Salvar etapa ${stage.number}</button></div>
        </div>
        <div class="status hidden stage-status"></div>
      </form>
    </details>`).join('');

  document.querySelectorAll('.stage-form').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    const number = Number(form.dataset.stage);
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
  }));
}

async function setAccess(email, accessGranted) {
  const data = await api('/api/editor/access', { method:'PUT', body:JSON.stringify({ email, accessGranted }) });
  const idx = editorData.users.findIndex(u => u.id === data.user.id);
  if (idx >= 0) editorData.users[idx] = data.user;
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
