(() => {
  'use strict';

  const stagesRoot = document.getElementById('stages');
  const liveGrid = document.querySelector('#liveClassForm .live-schedule-grid');
  const liveUrl = document.getElementById('liveClassUrl');
  const liveStatus = document.getElementById('liveClassStatus');

  function setLiveStatus(message, kind = 'good') {
    if (!liveStatus) return;
    liveStatus.textContent = message;
    liveStatus.className = `status ${kind}`;
  }

  function errorMessage(error, fallback) {
    let message = error?.message || fallback;
    return Promise.resolve(error?.context?.json?.())
      .then(payload => payload?.error || message)
      .catch(() => message);
  }

  function enhanceLiveNow() {
    if (!liveGrid || !liveUrl || liveGrid.querySelector('#liveClassNow')) return;

    const style = document.createElement('style');
    style.textContent = `
      #liveClassForm .live-schedule-grid{grid-template-columns:minmax(220px,1fr) auto auto!important;}
      #liveClassForm .live-now-button{margin:0;}
      #liveClassForm .live-now-button .btn{min-width:82px;}
      @media(max-width:760px){
        #liveClassForm .live-schedule-grid{grid-template-columns:1fr 1fr!important;}
        #liveClassForm .live-schedule-grid>.field:first-child{grid-column:1/-1;}
        #liveClassForm .live-schedule-button .btn,#liveClassForm .live-now-button .btn{width:100%;}
      }
    `;
    document.head.appendChild(style);

    const field = document.createElement('div');
    field.className = 'field live-now-button';
    field.innerHTML = '<label>&nbsp;</label><button class="btn secondary small" id="liveClassNow" type="button">Agora</button>';
    liveGrid.appendChild(field);

    const button = field.querySelector('#liveClassNow');
    button.addEventListener('click', async () => {
      const url = String(liveUrl.value || '').trim();
      if (!url) {
        setLiveStatus('Informe o link da aula ao vivo antes de iniciar.', 'bad');
        liveUrl.focus();
        return;
      }

      const scheduleButton = liveGrid.querySelector('.live-schedule-button button');
      button.disabled = true;
      if (scheduleButton) scheduleButton.disabled = true;
      setLiveStatus('Ativando a aula ao vivo...');

      try {
        const backend = window.ShamathaBackend;
        if (!backend?.getClient) throw new Error('Serviço indisponível.');
        const sb = backend.getClient();
        const { data, error } = await sb.functions.invoke('shamatha-live-now', { body:{ url } });
        if (error) throw new Error(await errorMessage(error, 'Falha ao iniciar a aula ao vivo.'));
        if (data?.error) throw new Error(data.error);

        const sent = Number(data?.push?.sent || 0);
        const failed = Number(data?.push?.failed || 0);
        let message = 'Aula ao vivo disponível agora.';
        if (sent) message += ` ${sent} notificação(ões) enviada(s) aos alunos.`;
        else message += ' Nenhuma assinatura Push ativa recebeu o aviso.';
        if (failed) message += ` ${failed} envio(s) falharam.`;
        setLiveStatus(message, failed ? 'bad' : 'good');
      } catch (error) {
        setLiveStatus(error?.message || 'Falha ao iniciar a aula ao vivo.', 'bad');
      } finally {
        button.disabled = false;
        if (scheduleButton) scheduleButton.disabled = false;
      }
    });
  }

  enhanceLiveNow();

  if (!stagesRoot) return;

  function fieldByLabel(form, labelText) {
    return [...form.querySelectorAll('.field')].find(field =>
      field.querySelector('label')?.textContent.trim() === labelText
    ) || null;
  }

  function removeEmptyGroups(form) {
    form.querySelectorAll('.three,.editor-rule-grid').forEach(group => {
      if (!group.querySelector('.field')) group.remove();
    });
  }

  function enhanceForm(form) {
    if (form.dataset.cleanupEnhanced === '1') return;
    form.dataset.cleanupEnhanced = '1';

    fieldByLabel(form, 'Nome da etapa')?.remove();
    fieldByLabel(form, 'Tempo mínimo válido (segundos)')?.remove();

    const unitField = fieldByLabel(form, 'Nome da unidade');
    const sessionsField = fieldByLabel(form, 'Sessões necessárias');
    const deadlineField = fieldByLabel(form, 'Prazo do ciclo (dias)');
    const submit = form.querySelector('button[type="submit"]');
    const submitField = submit?.closest('.field');

    if (unitField && sessionsField && deadlineField) {
      const row = document.createElement('div');
      row.className = 'editor-stage-rule-row';
      form.insertBefore(row, unitField);
      sessionsField.classList.add('compact-number-field');
      deadlineField.classList.add('compact-number-field');
      row.append(unitField, sessionsField, deadlineField);
    }

    if (submit) {
      const row = document.createElement('div');
      row.className = 'editor-stage-save-row';
      form.insertBefore(row, form.querySelector('.stage-status'));
      row.append(submit);
      submitField?.remove();
    }

    removeEmptyGroups(form);
  }

  function enhanceAccordion(details) {
    if (details.dataset.accordionEnhanced === '1') return;
    details.dataset.accordionEnhanced = '1';
    details.addEventListener('toggle', () => {
      if (!details.open) return;
      stagesRoot.querySelectorAll('details[data-stage-details]').forEach(other => {
        if (other !== details) other.open = false;
      });
    });
  }

  function enhanceAll() {
    stagesRoot.querySelectorAll('.stage-form').forEach(enhanceForm);
    stagesRoot.querySelectorAll('details[data-stage-details]').forEach(enhanceAccordion);
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      enhanceAll();
    });
  });
  observer.observe(stagesRoot, { childList:true, subtree:true });
  enhanceAll();
})();
