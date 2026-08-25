(() => {
  'use strict';

  const editorLink = document.getElementById('editorLink');
  if (editorLink) {
    const syncEditorLink = () => {
      const visible = !editorLink.classList.contains('hidden');
      editorLink.textContent = 'Editar';
      editorLink.setAttribute('aria-label', 'Abrir página de edição');
      if (visible) editorLink.style.setProperty('display', 'inline-flex', 'important');
      else editorLink.style.removeProperty('display');
    };
    new MutationObserver(syncEditorLink).observe(editorLink, { attributes:true, attributeFilter:['class'] });
    syncEditorLink();
  }

  const scroll = document.getElementById('unitScroll');
  if (!scroll) return;

  function cleanPracticeView() {
    document.getElementById('backFromPreparation')?.remove();
    scroll.querySelector('.active-started')?.remove();
  }

  const observer = new MutationObserver(cleanPracticeView);
  observer.observe(scroll, { childList: true, subtree: true });
  cleanPracticeView();
})();
