(() => {
  'use strict';

  function showPresenceError(range) {
    const field = range?.closest('.field');
    if (!field) return;
    field.classList.add('presence-invalid');
    const value = field.querySelector('.lucidity-value');
    if (value) value.textContent = 'Escolha um valor';
    let error = field.querySelector('.presence-error');
    if (!error) {
      error = document.createElement('div');
      error.className = 'presence-error';
      error.setAttribute('role', 'alert');
      error.textContent = 'Escolha um valor em Nível de concentração antes de salvar.';
      field.appendChild(error);
    }
    try { range.focus({ preventScroll:false }); }
    catch (_) { range.focus(); }
  }

  function clearPresenceError(range) {
    const field = range?.closest('.field');
    field?.classList.remove('presence-invalid');
    field?.querySelector('.presence-error')?.remove();
  }

  function syncProgressMarks(required) {
    const line = document.querySelector('#saveArea .progress-line');
    const elephant = line?.querySelector('.progress-elephant');
    if (!line || !elephant || !Number.isFinite(required) || required < 1) return;

    const expected = required + 1;
    const marks = [...line.querySelectorAll('.progress-mark')];
    const alreadyCorrect = marks.length === expected && marks.every((mark, index) => {
      const expectedLeft = `${(index / required) * 100}%`;
      return mark.style.left === expectedLeft;
    });
    if (alreadyCorrect) return;

    marks.forEach(mark => mark.remove());
    for (let index = 0; index <= required; index += 1) {
      const mark = document.createElement('span');
      mark.className = 'progress-mark';
      mark.style.left = `${(index / required) * 100}%`;
      line.insertBefore(mark, elephant);
    }
  }

  function syncProgressFacts() {
    const saveArea = document.getElementById('saveArea');
    const firstFact = saveArea?.querySelector('.progress-facts > span:first-child');
    const secondFact = saveArea?.querySelector('.progress-facts > span:nth-child(2)');
    if (!firstFact) return;

    const text = String(firstFact.textContent || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/(\d+)\s+de\s+(\d+).*?últimos\s+(\d+)\s+dias/i);
    if (!match) return;

    const count = Number(match[1]);
    const required = Math.max(1, Number(match[2]));
    const days = Number(match[3]);
    const remaining = Math.max(0, required - count);

    if (secondFact && remaining > 0) {
      secondFact.textContent = `${remaining === 1 ? 'Falta' : 'Faltam'} ${remaining} ${remaining === 1 ? 'sessão diária' : 'sessões diárias'} para a meta.`;
    }
    if (secondFact && remaining === 0 && !/Etapa concluída/i.test(secondFact.textContent || '')) {
      secondFact.textContent = `Meta cumprida nos últimos ${days} dias. Etapa concluída.`;
    }

    syncProgressMarks(required);
  }

  function applySavedLayout() {
    const reflection = document.querySelector('#unitScroll .reflection');
    const saveArea = document.getElementById('saveArea');
    if (!reflection || !saveArea || !saveArea.children.length) return false;
    reflection.classList.add('session-saved');
    syncProgressFacts();
    const scroll = document.getElementById('unitScroll');
    if (scroll) scroll.scrollTop = 0;
    return true;
  }

  function closePracticeWindow() {
    const modal = document.getElementById('unitModal');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    const scroll = document.getElementById('unitScroll');
    if (scroll) scroll.scrollTop = 0;
  }

  // Validação antes do handler principal de salvamento.
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;

    if (target?.closest('#saveSession')) {
      const range = document.getElementById('lucidity');
      if (range && range.dataset.chosen !== 'true') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        showPresenceError(range);
        return;
      }
      clearPresenceError(range);
    }

    // O link mantém sua navegação externa normal; apenas fechamos a atividade atual.
    if (target?.closest('#shareWhatsapp')) closePracticeWindow();
  }, true);

  // O app principal monta o resultado de forma síncrona no clique; depois disso
  // aplicamos o estado visual pós-salvamento sem MutationObserver.
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('#saveSession')) return;
    queueMicrotask(applySavedLayout);
    requestAnimationFrame(applySavedLayout);
  });

  document.addEventListener('input', event => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.id === 'lucidity') {
      clearPresenceError(target);
    }
  });
})();
