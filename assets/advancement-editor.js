(() => {
  'use strict';

  const stagesRoot = document.getElementById('stages');
  if (!stagesRoot) return;

  const requirements = new Map();
  let loading = false;

  function normalize(value) {
    return value === 'deadline' ? 'deadline' : 'sessions';
  }

  function controlMarkup(number, value) {
    const deadline = value === 'deadline';
    return `<div class="field advancement-requirement-field" data-advancement-stage="${number}">
      <label>Requisito</label>
      <div class="advancement-radio-row" role="radiogroup" aria-label="Requisito de avanço da etapa ${number}">
        <label class="advancement-radio"><input type="radio" name="advancementRequirement" value="deadline" ${deadline ? 'checked' : ''}><span>Prazo</span></label>
        <label class="advancement-radio"><input type="radio" name="advancementRequirement" value="sessions" ${deadline ? '' : 'checked'}><span>Sessões</span></label>
      </div>
      <small class="field-help">Prazo: avança ao fim do ciclo se a meta foi cumprida. Sessões: avança assim que atingir a meta.</small>
    </div>`;
  }

  function injectControls() {
    stagesRoot.querySelectorAll('.stage-form').forEach(form => {
      const number = Number(form.dataset.stage);
      if (!number || form.querySelector('[data-advancement-stage]')) return;
      const grid = form.querySelector('.editor-rule-grid');
      if (!grid) return;
      grid.insertAdjacentHTML('beforeend', controlMarkup(number, requirements.get(number) || 'sessions'));
      form.querySelectorAll('input[name="advancementRequirement"]').forEach(input => {
        input.addEventListener('change', () => {
          if (input.checked) requirements.set(number, normalize(input.value));
        });
      });
    });
  }

  async function loadRequirements() {
    if (loading) return;
    loading = true;
    try {
      const backend = window.ShamathaBackend;
      if (!backend?.request) return;
      const data = await backend.request('/api/editor/data');
      (data?.stages || []).forEach(stage => requirements.set(Number(stage.number), normalize(stage.advancementRequirement)));
      injectControls();
    } catch (_) {
      injectControls();
    } finally {
      loading = false;
    }
  }

  new MutationObserver(injectControls).observe(stagesRoot, { childList: true, subtree: true });
  loadRequirements();
})();
