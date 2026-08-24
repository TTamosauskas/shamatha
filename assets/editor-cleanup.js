(() => {
  'use strict';
  const stagesRoot = document.getElementById('stages');
  if (!stagesRoot) return;

  function fieldByLabel(form, labelText) {
    return [...form.querySelectorAll('.field')].find(field =>
      field.querySelector('label')?.textContent.trim() === labelText
    ) || null;
  }

  function removeEmptyGroups(form) {
    form.querySelectorAll('.three').forEach(group => {
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

    if (unitField) {
      const group = unitField.parentElement;
      if (group?.classList.contains('three')) group.parentElement.insertBefore(unitField, group);
    }

    if (sessionsField && deadlineField) {
      const ruleGrid = document.createElement('div');
      ruleGrid.className = 'editor-rule-grid-cleanup';
      const anchor = unitField?.nextSibling || form.firstChild;
      form.insertBefore(ruleGrid, anchor);
      ruleGrid.append(sessionsField, deadlineField);
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
