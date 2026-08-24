(() => {
  'use strict';

  const audio = document.getElementById('meditationAudio');
  const miniProgress = document.getElementById('miniProgress');
  let cueContext = null;
  let countdownObserver = null;
  let gongTimer = null;

  function getCueContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!cueContext) cueContext = new AudioContextClass();
    if (cueContext.state === 'suspended') cueContext.resume().catch(() => null);
    return cueContext;
  }

  function playCountdownCue() {
    const ctx = getCueContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(660, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.038, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.18);
  }

  function playStartGong() {
    const ctx = getCueContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const partials = [
      { frequency:196, volume:0.055, decay:2.5 },
      { frequency:294, volume:0.032, decay:2.0 },
      { frequency:392, volume:0.018, decay:1.45 }
    ];

    partials.forEach(partial => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(partial.frequency, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(partial.volume, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + partial.decay);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(now);
      oscillator.stop(now + partial.decay + 0.05);
    });
  }

  function cleanMiniProgress() {
    if (!miniProgress) return;
    const next = miniProgress.textContent.replace(/\s*·\s*últimos\s+/i, ' · ');
    if (next !== miniProgress.textContent) miniProgress.textContent = next;
  }

  if (miniProgress) {
    cleanMiniProgress();
    new MutationObserver(cleanMiniProgress).observe(miniProgress, { childList:true, characterData:true, subtree:true });
  }

  const style = document.createElement('style');
  style.textContent = '#unitScroll .reflection > .validation-note{display:none!important;}#countdownEndFooter{position:absolute;left:0;right:0;bottom:0;}';
  document.head.appendChild(style);

  function stopCountdownSignals() {
    clearTimeout(gongTimer);
    countdownObserver?.disconnect();
    countdownObserver = null;
  }

  document.addEventListener('shamatha:practice-ended', stopCountdownSignals);

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const startButton = target?.closest('#startSession');
    if (!startButton) return;

    getCueContext();
    stopCountdownSignals();
    let lastDigit = '';

    countdownObserver = new MutationObserver(() => {
      const digit = String(startButton.textContent || '').trim();
      if (!/^[1-5]$/.test(digit) || digit === lastDigit) return;
      lastDigit = digit;
      playCountdownCue();
      if (digit === '1') {
        clearTimeout(gongTimer);
        gongTimer = setTimeout(() => {
          playStartGong();
          countdownObserver?.disconnect();
          countdownObserver = null;
        }, 1000);
      }
    });
    countdownObserver.observe(startButton, { childList:true, characterData:true, subtree:true });
  });

  // O evento ended não borbulha, mas participa da fase de captura. Interrompê-lo
  // aqui mantém a prática aberta para o usuário decidir quando encerrá-la.
  document.addEventListener('ended', event => {
    if (!audio || event.target !== audio) return;
    event.stopPropagation();
    event.stopImmediatePropagation();

    const ring = document.getElementById('audioProgressRing');
    if (ring) {
      ring.style.setProperty('--audio-progress', '100%');
      ring.classList.add('paused');
      ring.setAttribute('aria-label', 'Áudio concluído');
    }

    const toggle = document.getElementById('audioToggle');
    if (toggle) {
      toggle.disabled = true;
      toggle.setAttribute('aria-label', 'Áudio concluído');
      toggle.innerHTML = '<span class="active-symbol">✓</span>';
    }

    const copy = document.querySelector('#unitScroll .active-started');
    if (copy) copy.innerHTML = '<strong>Áudio concluído</strong>Permaneça na prática e encerre quando desejar.';

    const endButton = document.getElementById('endSession');
    if (endButton) endButton.textContent = 'Encerrar prática';

    document.dispatchEvent(new CustomEvent('shamatha:audio-ended'));
  }, true);
})();
