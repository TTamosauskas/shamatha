(() => {
  'use strict';
  let apiPromise;

  function loadAPI() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const prior = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prior === 'function') prior();
        resolve(window.YT);
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => reject(new Error('Não foi possível carregar o player do YouTube.'));
      document.head.appendChild(script);
    });
    return apiPromise;
  }

  function attach(container, limitValue) {
    const limit = Number(limitValue);
    if (!Number.isFinite(limit) || limit <= 0) return;
    const iframe = container.querySelector('.video-frame iframe[src*="youtube-nocookie.com"]');
    if (!iframe) return;
    const info = document.createElement('div');
    info.className = 'video-limit-info';
    info.textContent = 'Este vídeo será pausado e reiniciado em ' +
      Math.floor(limit / 60) + ':' + String(limit % 60).padStart(2, '0') + '.';
    iframe.parentElement.after(info);
    loadAPI().then(YT => {
      if (!iframe.isConnected) return;
      let timer = null;
      let resetting = false;
      const stopChecking = () => { if (timer !== null) clearInterval(timer); timer = null; };
      const player = new YT.Player(iframe, {
        events: {
          onStateChange(event) {
            if (event.data === YT.PlayerState.PLAYING) {
              if (resetting) { event.target.pauseVideo(); return; }
              stopChecking();
              timer = setInterval(() => {
                if (!iframe.isConnected) {
                  stopChecking();
                  try { player.destroy(); } catch (_) {}
                  return;
                }
                if (resetting || typeof player.getCurrentTime !== 'function') return;
                if (player.getCurrentTime() >= limit) {
                  resetting = true;
                  stopChecking();
                  player.pauseVideo();
                  player.seekTo(0, true);
                  player.pauseVideo();
                  setTimeout(() => { resetting = false; }, 350);
                }
              }, 100);
            } else {
              stopChecking();
            }
          }
        }
      });
    }).catch(() => {
      info.textContent = 'Não foi possível ativar o limite de reprodução neste navegador.';
    });
  }

  window.ShamathaYouTubeLimit = Object.freeze({ attach });
})();
