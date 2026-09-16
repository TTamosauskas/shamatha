(() => {
  'use strict';

  const screen = document.getElementById('appLoadingScreen');
  const orbit = document.getElementById('appLoadingOrbit');
  const copy = document.getElementById('appLoadingCopy');
  if (!screen || !orbit || !copy) return;

  let current = 10;
  let finished = false;
  let dataReady = false;
  let expectedStages = 0;
  let expectedChildren = 0;
  let observer = null;
  let layoutFallback = null;

  function setProgress(value, message) {
    if (finished && Number(value) < 100) return;
    const next = Math.max(current, Math.min(100, Number(value) || 0));
    current = next;
    orbit.style.setProperty('--loading-progress', `${next}%`);
    if (message) {
      copy.textContent = message;
      screen.setAttribute('aria-label', message);
    }
  }

  function homeIsMounted() {
    if (!dataReady) return false;
    const status = document.getElementById('homeStatus');
    const title = document.getElementById('currentUnitName');
    const rootCount = document.querySelectorAll('.journey .stage').length;
    const childCount = document.querySelectorAll('.journey .child-stage-marker').length;
    const statusReady = status && !/carregando/i.test(String(status.textContent || ''));
    const titleReady = title && !/carregando/i.test(String(title.textContent || ''));
    return Boolean(
      statusReady &&
      titleReady &&
      rootCount >= expectedStages &&
      childCount >= expectedChildren
    );
  }

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(layoutFallback);
    setProgress(100, 'Tudo pronto.');
    setTimeout(() => {
      screen.classList.add('is-leaving');
      document.body.classList.remove('app-loading-active');
      setTimeout(() => {
        screen.hidden = true;
        observer?.disconnect();
        document.dispatchEvent(new CustomEvent('shamatha:loading-finished'));
      }, 360);
    }, 180);
  }

  function checkLayout() {
    if (finished || !dataReady) return;
    const rootCount = document.querySelectorAll('.journey .stage').length;
    const childCount = document.querySelectorAll('.journey .child-stage-marker').length;

    if (rootCount >= expectedStages) {
      setProgress(expectedChildren ? 91 : 96, expectedChildren ? 'Posicionando suas etapas…' : 'Posicionando seu caminho…');
    }
    if (expectedChildren && childCount >= expectedChildren) {
      setProgress(97, 'Finalizando seu caminho…');
    }
    if (homeIsMounted()) finish();
  }

  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver(checkLayout);
    observer.observe(document.body, {
      childList:true,
      subtree:true,
      characterData:true,
      attributes:true,
      attributeFilter:['class','style']
    });
  }

  document.body?.classList.add('app-loading-active');
  setProgress(12, 'Preparando seu caminho…');

  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('app-loading-active');
    setProgress(24, 'Conectando ao seu progresso…');
    startObserver();
    checkLayout();
  }, { once:true });

  document.addEventListener('shamatha:app-data-ready', event => {
    const data = event.detail?.data || {};
    expectedStages = Math.max(1, Number(data.stages?.length || 1));
    expectedChildren = (data.childStages || []).filter(child => child?.isActive).length;
    dataReady = true;
    setProgress(82, 'Montando suas etapas…');
    startObserver();
    requestAnimationFrame(() => requestAnimationFrame(checkLayout));

    // Evita prender o usuário se algum detalhe visual opcional falhar ao renderizar.
    clearTimeout(layoutFallback);
    layoutFallback = setTimeout(finish, 4500);
  });

  // Em redes muito lentas, a mensagem muda sem falsificar avanço no anel.
  setTimeout(() => {
    if (!dataReady && !finished) setProgress(current, 'Ainda preparando seu caminho…');
  }, 8000);

  window.ShamathaLoading = Object.freeze({
    setProgress,
    finish,
    isFinished:() => finished
  });
})();
