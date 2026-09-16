(() => {
  'use strict';

  const shell = document.querySelector('main.shell');
  const topbar = shell?.querySelector('.topbar');
  const grid = shell?.querySelector(':scope > .grid');
  const cards = [...(shell?.querySelectorAll(':scope > .card') || [])];
  const usersCard = cards.find(card => card.querySelector('#usersBody'));
  const stagesCard = cards.find(card => card.querySelector('#stages'));
  const accessCard = grid?.querySelector('.card:first-child');
  const liveCard = grid?.querySelector('.card:nth-child(2)');
  if (!shell || !topbar || !grid || !usersCard || !stagesCard || !accessCard || !liveCard) return;

  const tabs = document.createElement('nav');
  tabs.className = 'editor-tabs';
  tabs.setAttribute('aria-label', 'Seções do editor');
  tabs.innerHTML = `
    <button class="editor-tab is-active" type="button" role="tab" aria-selected="true" data-editor-tab="settings">Configurações gerais</button>
    <button class="editor-tab" type="button" role="tab" aria-selected="false" data-editor-tab="users">Usuários cadastrados</button>`;

  const settingsPanel = document.createElement('section');
  settingsPanel.className = 'editor-tab-panel';
  settingsPanel.dataset.editorPanel = 'settings';
  settingsPanel.setAttribute('role', 'tabpanel');

  const usersPanel = document.createElement('section');
  usersPanel.className = 'editor-tab-panel';
  usersPanel.dataset.editorPanel = 'users';
  usersPanel.setAttribute('role', 'tabpanel');
  usersPanel.hidden = true;

  const settingsForm = accessCard.querySelector('#settingsForm');
  const settingsStatus = accessCard.querySelector('#settingsStatus');
  const softRule = accessCard.querySelector('.soft-rule');
  const settingsCard = document.createElement('div');
  settingsCard.className = 'card';
  settingsCard.innerHTML = '<div class="section-head"><div><h2>Configurações gerais</h2></div></div>';
  if (settingsForm) settingsCard.appendChild(settingsForm);
  if (settingsStatus) settingsCard.appendChild(settingsStatus);
  softRule?.remove();

  const settingsGrid = document.createElement('div');
  settingsGrid.className = 'editor-tab-settings-grid';
  settingsGrid.append(settingsCard, liveCard);
  settingsPanel.append(settingsGrid, stagesCard);
  stagesCard.style.marginTop = '20px';

  usersPanel.append(accessCard, usersCard);
  accessCard.style.marginTop = '0';
  usersCard.style.marginTop = '20px';

  grid.remove();
  topbar.insertAdjacentElement('afterend', tabs);
  tabs.insertAdjacentElement('afterend', settingsPanel);
  settingsPanel.insertAdjacentElement('afterend', usersPanel);

  function activate(name) {
    const selected = name === 'users' ? 'users' : 'settings';
    tabs.querySelectorAll('[data-editor-tab]').forEach(button => {
      const active = button.dataset.editorTab === selected;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    settingsPanel.hidden = selected !== 'settings';
    usersPanel.hidden = selected !== 'users';
    try { sessionStorage.setItem('shamathaEditorTab', selected); } catch (_) {}
  }

  tabs.addEventListener('click', event => {
    const button = event.target.closest('[data-editor-tab]');
    if (button) activate(button.dataset.editorTab);
  });

  let initial = 'settings';
  try { initial = sessionStorage.getItem('shamathaEditorTab') || initial; } catch (_) {}
  activate(initial);
})();
