(() => {
  'use strict';

  const context = window.ShamathaPracticeContext;
  const continueButton = document.getElementById('continuePath');
  const unitName = document.getElementById('currentUnitName');
  const objective = document.getElementById('currentObjective');
  if (!context?.openChild || !continueButton || !unitName || !objective) return;

  let data = context.getData?.() || null;
  let selectedChild = null;
  let scheduled = false;

  function resolveChild() {
    const stageId = String(data?.progress?.currentChildStageId || '');
    if (!stageId) return null;
    const child = (data?.childStages || []).find(item => String(item.stageId) === stageId && item.isActive !== false) || null;
    if (!child) return null;
    if (Number(child.parentPosition || 0) !== Number(data?.progress?.currentStage || 0)) return null;
    return child;
  }

  function apply() {
    scheduled = false;
    selectedChild = resolveChild();
    document.querySelectorAll('.child-stage-marker[data-editor-position="1"]').forEach(marker => marker.removeAttribute('data-editor-position'));
    if (!selectedChild) return;

    const marker = document.querySelector(`.child-stage-marker[data-child-stage-id="${CSS.escape(String(selectedChild.stageId))}"]`);
    if (marker) marker.dataset.editorPosition = '1';

    const desiredTitle = `Etapa ${selectedChild.displayCode} – ${selectedChild.unitName || 'Aula de apoio'}`;
    if (unitName.textContent !== desiredTitle) unitName.textContent = desiredTitle;
    if (objective.textContent !== (selectedChild.objective || '')) objective.textContent = selectedChild.objective || '';
    const desiredButton = `Abrir etapa ${selectedChild.displayCode}`;
    if (continueButton.textContent !== desiredButton) continueButton.textContent = desiredButton;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(apply, 0);
  }

  document.addEventListener('shamatha:app-data-ready', event => {
    data = event.detail?.data || context.getData?.() || data;
    schedule();
  });
  document.addEventListener('shamatha:child-context-changed', schedule);

  continueButton.addEventListener('click', event => {
    selectedChild = resolveChild();
    if (!selectedChild) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    context.openChild(selectedChild);
  }, true);

  const observer = new MutationObserver(schedule);
  observer.observe(document.querySelector('.current-card') || document.body, { childList:true, subtree:true, characterData:true });
  observer.observe(document.querySelector('.journey') || document.body, { childList:true, subtree:true });

  schedule();
})();
