const $ = id => document.getElementById(id);
let editorData = null;
const GLOBAL_MIN_SESSION_SECONDS = 300;
const CURITIBA_TZ = 'America/Sao_Paulo';

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

function formatCuritiba(ts) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: CURITIBA_TZ,
    weekday:'short', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
  }).format(new Date(ts));
}

function zonedParts(date, timeZone = CURITIBA_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit',
    hourCycle:'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}

function curitibaInputValue(date) {
  const p = zonedParts(date);
  return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}T${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}`;
}

function curitibaLocalToIso(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) throw new Error('Informe data e hora válidas.');
  const wanted = Date.UTC(Number(m[1]), Number(m[2])-1, Number(m[3]), Number(m[4]), Number(m[5]), 0);
  let guess = wanted;
  for (let i = 0; i < 3; i += 1) {
    const p = zonedParts(new Date(guess));
    const seen = Date.UTC(p.year, p.month-1, p.day, p.hour, p.minute, p.second || 0);
    guess += wanted - seen;
  }
  return new Date(guess).toISOString();
}

function updateUser(user) {
  const idx = editorData.users.findIndex(item => item.id === user.id);
  if (idx >= 0) editorData.users[idx] = user;
  else editorData.users.push(user);
}

function statusLabel(status) {
  return status === 'approved' ? 'Aprovado' : status === 'suspended' ? 'Suspenso' : 'Pendente';
}

function renderUsers() {
  const users = editorData.users || [];
  $('userCount').textContent = `${users.length} ${users.length === 1 ? 'usuário' : 'usuários'}`;
  $('usersBody').innerHTML = users.length ? users.map(user => {
    const isEditor = user.role === 'editor';
    const isSelf = editorData.currentUser?.id === user.id;
    const roleControl = user.isOwner
      ? '<span class="badge owner">Editor principal</span>'
      : `<select class="user-role role-select" data-email="${esc(user.email)}" aria-label="Função de ${esc(user.email)}">
          <option value="student" ${isEditor ? '' : 'selected'}>Aluno</option>
          <option value="editor" ${isEditor ? 'selected' : ''}>Editor</option>
        </select>`;

    const stateControl = isEditor || user.isOwner
      ? '<span class="badge good">Aprovado</span>'
      : `<select class="user-status role-select status-select" data-email="${esc(user.email)}" aria-label="Estado de ${esc(user.email)}">
          <option value="pending" ${user.accessStatus === 'pending' ? 'selected' : ''}>Pendente</option>
          <option value="approved" ${user.accessStatus === 'approved' ? 'selected' : ''}>Aprovado</option>
          <option value="suspended" ${user.accessStatus === 'suspended' ? 'selected' : ''}>Suspenso</option>
        </select>`;

    const deleteControl = user.isOwner
      ? '<span class="muted">Protegido</span>'
      : `<button class="btn danger small delete-user" type="button" data-email="${esc(user.email)}" ${isSelf ? 'disabled title="Você não pode deletar a própria conta ativa"' : ''}>Deletar</button>`;

    return `<tr>
      <td class="user-email-cell">${esc(user.email)}</td>
      <td>${roleControl}</td>
      <td>${stateControl}</td>
      <td class="user-actions-cell">${deleteControl}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" class="muted">Ainda não há usuários cadastrados.</td></tr>';

  document.querySelectorAll('.user-role').forEach(select => select.addEventListener('change', async () => {
    select.disabled = true;
    try {
      const data = await api('/api/editor/role', {
        method:'PUT', body:JSON.stringify({ email:select.dataset.email, role:select.value })
      });
      updateUser(data.user);
      renderUsers();
      setStatus('accessStatus', `${data.user.email}: função alterada para ${data.user.role === 'editor' ? 'Editor' : 'Aluno'}.`);
      if (editorData.currentUser?.id === data.user.id && data.user.role !== 'editor') location.href = './app.html';
    } catch (error) {
      renderUsers();
      setStatus('accessStatus', error.message, 'bad');
    }
  }));

  document.querySelectorAll('.user-status').forEach(select => select.addEventListener('change', async () => {
    select.disabled = true;
    try {
      const data = await api('/api/editor/status', {
        method:'PUT', body:JSON.stringify({ email:select.dataset.email, status:select.value })
      });
      updateUser(data.user);
      renderUsers();
      setStatus('accessStatus', `${data.user.email}: estado alterado para ${statusLabel(data.user.accessStatus)}.`);
    } catch (error) {
      renderUsers();
      setStatus('accessStatus', error.message, 'bad');
    }
  }));

  document.querySelectorAll('.delete-user').forEach(button => button.addEventListener('click', async () => {
    const email = button.dataset.email;
    if (!window.confirm(`Deletar ${email}? O usuário e seu histórico de progresso serão removidos permanentemente.`)) return;
    button.disabled = true;
    try {
      const data = await api('/api/editor/user', { method:'DELETE', body:JSON.stringify({ email }) });
      editorData.users = editorData.users.filter(user => user.id !== data.id);
      renderUsers();
      setStatus('accessStatus', `${data.email} foi deletado.`);
    } catch (error) {
      renderUsers();
      setStatus('accessStatus', error.message, 'bad');
    }
  }));
}

function renderLiveClasses() {
  const rows = (editorData.liveClasses || []).filter(item => item.status === 'scheduled' && new Date(item.startsAt).getTime() > Date.now());
  if (!rows.length) {
    $('liveClassList').innerHTML = '<p class="muted live-empty">Nenhuma aula futura agendada.</p>';
    return;
  }
  $('liveClassList').innerHTML = rows.map(item => `
    <div class="live-class-row">
      <div><strong>${esc(formatCuritiba(item.startsAt))}</strong><small>Agendada · horário de Curitiba</small></div>
      <button class="btn danger small cancel-live" type="button" data-id="${esc(item.id)}">Cancelar</button>
    </div>`).join('');

  document.querySelectorAll('.cancel-live').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const data = await api('/api/editor/live-class', { method:'DELETE', body:JSON.stringify({ id:btn.dataset.id }) });
      editorData.liveClasses = editorData.liveClasses.filter(item => item.id !== data.id);
      renderLiveClasses();
      setStatus('liveClassStatus', 'Aula cancelada e removida. Usuários com notificações ativas receberam o aviso.');
    } catch (error) {
      btn.disabled = false;
      setStatus('liveClassStatus', error.message, 'bad');
    }
  }));
}

function audioBlock(stage) {
  const hasAudio = Boolean(stage.audioUrl || stage.audioPath);
  const current = stage.audioName
    ? `<strong>${esc(stage.audioName)}</strong>`
    : hasAudio ? '<strong>Áudio atual configurado</strong>' : '<span class="muted">Nenhum áudio enviado.</span>';
  const player = stage.audioUrl ? `<audio class="audio-preview" controls preload="metadata" src="${esc(stage.audioUrl)}"></audio>` : '';
  return `<div class="field audio-field">
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
        <div class="field"><label>Nome da unidade</label><input name="unitName" value="${esc(stage.unitName)}" maxlength="160" required></div>
        <div class="editor-rule-grid">
          <div class="field"><label>Sessões necessárias</label><input name="sessionsRequired" type="number" min="1" max="30" value="${stage.sessionsRequired}" required></div>
          <div class="field"><label>Prazo do ciclo (dias)</label><input name="deadlineDays" type="number" min="1" max="365" value="${stage.deadlineDays}" required></div>
        </div>
        <div class="field"><label>Objetivo / apresentação</label><textarea name="objective" maxlength="1200">${esc(stage.objective)}</textarea></div>
        <div class="field"><label>URL do vídeo</label><input name="videoUrl" type="url" value="${esc(stage.videoUrl)}" placeholder="https://www.youtube.com/watch?v=... ou URL de MP4"></div>
        ${audioBlock(stage)}
        <div class="stage-save-row"><button class="btn primary" type="submit">Salvar etapa ${stage.number}</button></div>
        <div class="status hidden stage-status"></div>
      </form>
    </details>`).join('');

  document.querySelectorAll('[data-stage-details]').forEach(details => {
    details.addEventListener('toggle', () => {
      if (!details.open) return;
      document.querySelectorAll('[data-stage-details]').forEach(other => { if (other !== details) other.open = false; });
    });
  });

  document.querySelectorAll('.stage-form').forEach(form => {
    const number = Number(form.dataset.stage);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form).entries());
      payload.stageName = editorData.stages[number - 1]?.stageName || '';
      payload.sessionsRequired = Number(payload.sessionsRequired);
      payload.deadlineDays = Number(payload.deadlineDays);
      payload.minSessionSeconds = GLOBAL_MIN_SESSION_SECONDS;
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

$('inviteForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const data = await api('/api/editor/invite', { method:'POST', body:JSON.stringify({ email:$('inviteEmail').value }) });
    updateUser(data.user);
    renderUsers();
    setStatus('accessStatus', data.invited
      ? `Convite enviado para ${data.user.email}. Novo usuário criado como Aluno e Pendente.`
      : `${data.user.email} já está cadastrado; função e estado foram mantidos.`);
    $('inviteEmail').value = '';
  } catch (error) {
    setStatus('accessStatus', error.message, 'bad');
  } finally { button.disabled = false; }
});

$('liveClassForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const startsAt = curitibaLocalToIso($('liveClassAt').value);
    const data = await api('/api/editor/live-class', { method:'POST', body:JSON.stringify({ url:$('liveClassUrl').value, startsAt }) });
    editorData.liveClasses.push(data.liveClass);
    editorData.liveClasses.sort((a,b) => new Date(a.startsAt) - new Date(b.startsAt));
    renderLiveClasses();
    const sent = Number(data.push?.sent || 0);
    setStatus('liveClassStatus', `Aula agendada para ${formatCuritiba(data.liveClass.startsAt)}. ${sent ? `${sent} notificação(ões) enviada(s).` : 'O aviso será entregue aos usuários que ativarem notificações.'}`);
    $('liveClassUrl').value = '';
    const next = new Date(Date.now() + 60 * 60 * 1000);
    next.setMinutes(Math.ceil(next.getMinutes()/15)*15, 0, 0);
    $('liveClassAt').value = curitibaInputValue(next);
  } catch (error) {
    setStatus('liveClassStatus', error.message, 'bad');
  } finally { button.disabled = false; }
});

$('settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const data = await api('/api/editor/settings', {
      method:'PUT',
      body:JSON.stringify({ liveClassUrl:editorData.settings.liveClassUrl || '', whatsappPhone:$('whatsappPhone').value })
    });
    editorData.settings = data.settings;
    $('whatsappPhone').value = data.settings.whatsappPhone || '';
    setStatus('settingsStatus', 'WhatsApp salvo.');
  } catch (error) { setStatus('settingsStatus', error.message, 'bad'); }
});

$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method:'POST', body:'{}' }).catch(() => null);
  location.href = './index.html';
});

(async () => {
  try {
    editorData = await api('/api/editor/data');
    $('whatsappPhone').value = editorData.settings.whatsappPhone || '';
    const next = new Date(Date.now() + 60 * 60 * 1000);
    next.setMinutes(Math.ceil(next.getMinutes()/15)*15, 0, 0);
    $('liveClassAt').value = curitibaInputValue(next);
    renderUsers();
    renderLiveClasses();
    renderStages();
  } catch (error) {
    setStatus('accessStatus', error.message, 'bad');
  }
})();
