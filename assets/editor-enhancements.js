(() => {
  'use strict';

  const DEFAULT_LIVE_URL = 'https://us06web.zoom.us/j/84674720127';
  const CURITIBA_TZ = 'America/Sao_Paulo';
  const tbody = document.getElementById('usersBody');
  const liveUrl = document.getElementById('liveClassUrl');
  const liveForm = document.getElementById('liveClassForm');
  const inviteForm = document.getElementById('inviteForm');
  const accessStatus = document.getElementById('accessStatus');
  const stagesRoot = document.getElementById('stages');
  let confirmedByEmail = {};
  let sessionsByUserId = {};
  let notesByUserId = {};
  let syncing = false;
  let popover = null;
  let popoverAnchor = null;

  function setAccessMessage(message, kind = 'good') {
    if (!accessStatus) return;
    accessStatus.textContent = message;
    accessStatus.className = `status ${kind}`;
  }

  function ensureDefaultLiveUrl() {
    if (liveUrl && !String(liveUrl.value || '').trim()) liveUrl.value = DEFAULT_LIVE_URL;
  }

  function syncRollingWindowLabels() {
    if (!stagesRoot) return;
    stagesRoot.querySelectorAll('.stage-form').forEach(form => {
      const input = form.querySelector('input[name="deadlineDays"]');
      const field = input?.closest('.field');
      const label = field?.querySelector('label');
      if (label && label.textContent !== 'Janela de prática (dias)') label.textContent = 'Janela de prática (dias)';
      field?.querySelectorAll('.rolling-window-help').forEach(help => help.remove());
    });
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('Não foi possível copiar automaticamente.');
  }

  function inviteButton(email) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'invite-link-copy';
    button.dataset.email = email;
    button.textContent = '✉️';
    button.title = 'Copiar link de convite';
    button.setAttribute('aria-label', `Copiar link de convite para ${email}`);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const backend = window.ShamathaBackend;
        if (!backend?.getClient) throw new Error('Serviço indisponível.');
        const sb = backend.getClient();
        const { data, error } = await sb.functions.invoke('shamatha-ops', {
          body: { action: 'generate_invite_link', email }
        });
        if (error) {
          let message = error.message || 'Falha ao gerar o convite.';
          try {
            const payload = await error.context?.json?.();
            if (payload?.error) message = payload.error;
          } catch (_) {}
          throw new Error(message);
        }
        if (data?.error) throw new Error(data.error);
        if (!data?.link) throw new Error('O serviço não retornou o link do convite.');
        await copyText(data.link);
        setAccessMessage(`Link de convite de ${email} copiado para a área de transferência.`);
      } catch (error) {
        setAccessMessage(error?.message || 'Falha ao copiar o link do convite.', 'bad');
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  function userForEmail(email) {
    if (typeof editorData === 'undefined') return null;
    return (editorData?.users || []).find(user => String(user.email || '').trim().toLowerCase() === email) || null;
  }

  function dateLabel(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '--/--';
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: CURITIBA_TZ,
      day:'2-digit', month:'2-digit'
    }).format(date);
  }

  function sessionLabel(session) {
    const minutes = Math.max(1, Math.round(Number(session?.durationSeconds || 0) / 60));
    const concentration = Number(session?.concentration);
    const pct = Number.isFinite(concentration)
      ? String(Math.max(0, Math.min(100, Math.round(concentration)))).padStart(2, '0')
      : '--';
    return `${dateLabel(session?.at)} - ${String(minutes).padStart(2, '0')} min - ${pct}%`;
  }

  function closePopover() {
    if (popover) popover.remove();
    popover = null;
    popoverAnchor = null;
  }

  function positionPopover(anchor) {
    if (!popover || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const gap = 8;
    const width = Math.min(360, window.innerWidth - 24);
    popover.style.width = `${width}px`;
    const measured = popover.getBoundingClientRect();
    let left = rect.left;
    left = Math.max(12, Math.min(left, window.innerWidth - measured.width - 12));
    let top = rect.bottom + gap;
    if (top + measured.height > window.innerHeight - 12 && rect.top - measured.height - gap >= 12) {
      top = rect.top - measured.height - gap;
    }
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.max(12, top)}px`;
  }

  function openPopover(anchor, content, className = '') {
    closePopover();
    popoverAnchor = anchor;
    popover = document.createElement('div');
    popover.className = `user-popover ${className}`.trim();
    popover.innerHTML = content;
    document.body.appendChild(popover);
    positionPopover(anchor);
    return popover;
  }

  function openSessions(anchor, userId) {
    const sessions = sessionsByUserId[userId] || [];
    if (!sessions.length) return;
    openPopover(anchor, `<div class="user-popover-title">Últimas sessões</div><div class="session-history-list">${sessions.map(session => `<div>${sessionLabel(session)}</div>`).join('')}</div>`, 'session-history-popover');
  }

  async function saveNote(userId, note, button, status) {
    button.disabled = true;
    status.textContent = 'Salvando…';
    try {
      const backend = window.ShamathaBackend;
      if (!backend?.getClient) throw new Error('Serviço indisponível.');
      const sb = backend.getClient();
      const { data, error } = await sb.functions.invoke('shamatha-editor-activity', {
        body: { action:'save_note', userId, note }
      });
      if (error) {
        let message = error.message || 'Falha ao salvar anotação.';
        try {
          const payload = await error.context?.json?.();
          if (payload?.error) message = payload.error;
        } catch (_) {}
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      notesByUserId[userId] = String(data?.note || '');
      closePopover();
    } catch (error) {
      button.disabled = false;
      status.textContent = error?.message || 'Falha ao salvar anotação.';
    }
  }

  function openNote(anchor, userId, email) {
    const note = String(notesByUserId[userId] || '');
    const root = openPopover(anchor, `<div class="user-popover-title">Anotação sobre ${email}</div><textarea class="user-note-input" maxlength="5000" rows="6" placeholder="Escreva qualquer anotação sobre este aluno..."></textarea><div class="user-note-actions"><span class="user-note-status"></span><button class="btn primary small user-note-save" type="button">Salvar</button></div>`, 'user-note-popover');
    const input = root.querySelector('.user-note-input');
    const save = root.querySelector('.user-note-save');
    const status = root.querySelector('.user-note-status');
    input.value = note;
    save.addEventListener('click', () => saveNote(userId, input.value, save, status));
    setTimeout(() => input.focus(), 0);
  }

  function ensureEmailControls(emailCell, email, user) {
    emailCell.dataset.email = email;
    emailCell.dataset.userId = user?.id || '';
    let text = emailCell.querySelector('.user-email-text');
    if (!text) {
      emailCell.textContent = '';
      text = document.createElement('span');
      text.className = 'user-email-text';
      text.textContent = user?.email || email;
      emailCell.appendChild(text);
    }
    let edit = emailCell.querySelector('.user-note-edit');
    if (!edit && user?.id) {
      edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'user-note-edit';
      edit.textContent = '✏️';
      edit.title = 'Anotação do editor';
      edit.setAttribute('aria-label', `Editar anotação sobre ${user.email || email}`);
      edit.addEventListener('click', event => {
        event.stopPropagation();
        openNote(edit, user.id, user.email || email);
      });
      emailCell.appendChild(edit);
    }
  }

  function syncActivityCell(row, emailCell, user) {
    let activityCell = row.querySelector('.user-last-session-cell');
    if (!activityCell) {
      activityCell = document.createElement('td');
      activityCell.className = 'user-last-session-cell';
      emailCell.insertAdjacentElement('afterend', activityCell);
    }
    const sessions = user?.id ? (sessionsByUserId[user.id] || []) : [];
    const signature = sessions.length ? `${user.id}:${sessions[0].at}:${sessions.length}` : `${user?.id || emailCell.dataset.email}:none`;
    if (activityCell.dataset.signature === signature) return;
    activityCell.dataset.signature = signature;
    activityCell.textContent = '';
    if (!sessions.length) {
      activityCell.textContent = 'Nenhuma';
      return;
    }
    const label = document.createElement('span');
    label.className = 'last-session-label';
    label.textContent = sessionLabel(sessions[0]);
    const chart = document.createElement('button');
    chart.type = 'button';
    chart.className = 'session-history-trigger';
    chart.textContent = '📈';
    chart.title = 'Ver últimas sessões';
    chart.setAttribute('aria-label', `Ver últimas sessões de ${user.email || emailCell.dataset.email}`);
    chart.addEventListener('click', event => {
      event.stopPropagation();
      openSessions(chart, user.id);
    });
    activityCell.append(label, chart);
  }

  function syncUserRows() {
    if (!tbody || syncing) return;
    syncing = true;
    try {
      tbody.querySelectorAll('tr').forEach(row => {
        const emailCell = row.querySelector('.user-email-cell');
        if (!emailCell) {
          const only = row.querySelector('td[colspan]');
          if (only && only.getAttribute('colspan') !== '5') only.setAttribute('colspan', '5');
          return;
        }

        const original = String(emailCell.dataset.email || emailCell.querySelector('.user-email-text')?.textContent || emailCell.textContent || '').replace('✏️','').trim().toLowerCase();
        const user = userForEmail(original);
        ensureEmailControls(emailCell, original, user);
        syncActivityCell(row, emailCell, user);

        row.querySelectorAll('.badge.owner').forEach(badge => {
          if (badge.textContent !== 'Desenvolvedor') badge.textContent = 'Desenvolvedor';
        });

        const actionsCell = row.querySelector('.user-actions-cell');
        if (actionsCell) {
          const shouldShowInvite = confirmedByEmail[original] === false;
          let button = actionsCell.querySelector('.invite-link-copy');
          if (shouldShowInvite && !button) {
            button = inviteButton(original);
            actionsCell.insertBefore(button, actionsCell.firstChild);
          } else if (!shouldShowInvite && button) {
            button.remove();
          }
        }
      });
    } finally {
      syncing = false;
    }
  }

  async function loadActivity() {
    try {
      const backend = window.ShamathaBackend;
      if (!backend?.getClient) return;
      const sb = backend.getClient();
      const { data, error } = await sb.functions.invoke('shamatha-editor-activity', { body: {} });
      if (error || data?.error) return;
      confirmedByEmail = data?.confirmedByEmail || {};
      sessionsByUserId = data?.sessionsByUserId || {};
      notesByUserId = data?.notesByUserId || {};
      tbody?.querySelectorAll('.user-last-session-cell').forEach(cell => delete cell.dataset.signature);
      syncUserRows();
    } catch (_) {}
  }

  function normalizeInviteSuccessMessage() {
    if (!accessStatus) return;
    const text = String(accessStatus.textContent || '');
    const match = text.match(/^Convite enviado para (.+?)\. Novo usuário criado/);
    if (!match) return;
    setAccessMessage(`Usuário ${match[1]} adicionado como Aluno e Pendente. Use ✉️ para copiar o link de convite.`);
  }

  document.addEventListener('pointerdown', event => {
    if (!popover) return;
    if (popover.contains(event.target) || popoverAnchor?.contains(event.target)) return;
    closePopover();
  }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closePopover(); });
  window.addEventListener('resize', () => { if (popover && popoverAnchor) positionPopover(popoverAnchor); });
  window.addEventListener('scroll', () => { if (popover && popoverAnchor) positionPopover(popoverAnchor); }, true);

  ensureDefaultLiveUrl();
  syncRollingWindowLabels();

  if (liveForm) {
    liveForm.addEventListener('submit', () => {
      const button = liveForm.querySelector('button[type="submit"]');
      const started = Date.now();
      const timer = setInterval(() => {
        if (Date.now() - started > 15000) { clearInterval(timer); return; }
        if (button && !button.disabled) { clearInterval(timer); ensureDefaultLiveUrl(); }
      }, 120);
    });
  }

  if (inviteForm) {
    inviteForm.addEventListener('submit', () => {
      const button = inviteForm.querySelector('button[type="submit"]');
      const started = Date.now();
      const timer = setInterval(() => {
        if (Date.now() - started > 15000) { clearInterval(timer); return; }
        if (button && !button.disabled) {
          clearInterval(timer);
          normalizeInviteSuccessMessage();
          loadActivity();
        }
      }, 120);
    });
  }

  if (accessStatus) new MutationObserver(normalizeInviteSuccessMessage).observe(accessStatus, { childList:true, characterData:true, subtree:true });
  if (tbody) new MutationObserver(() => queueMicrotask(syncUserRows)).observe(tbody, { childList:true, subtree:true });
  if (stagesRoot) new MutationObserver(syncRollingWindowLabels).observe(stagesRoot, { childList:true, subtree:true });

  syncUserRows();
  syncRollingWindowLabels();
  loadActivity();
  setInterval(loadActivity, 60000);
})();
