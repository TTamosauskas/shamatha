(() => {
  'use strict';
  let apiPromise;
  let mountSequence = 0;

  function loadAPI() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previous === 'function') previous();
        resolve(window.YT);
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => reject(new Error('Falha ao carregar a API do YouTube.'));
      document.head.appendChild(script);
    });
    return apiPromise;
  }

  function attach(container, value) {
    const limit = Number(value);
    if (!Number.isFinite(limit) || limit <= 0) return;
    const mount = container.querySelector('.shamatha-youtube-player');
    if (!mount) return;
    const videoId = mount.dataset.youtubeId;
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) return;

    const mountId = 'shamatha-video-player-' + (++mountSequence);
    mount.id = mountId;
    const note = document.createElement('div');
    note.className = 'video-limit-info';
    note.textContent = 'Reprodução limitada a ' + Math.floor(limit / 60) + ':' +
      String(limit % 60).padStart(2, '0') + '.';
    mount.parentElement.after(note);

    loadAPI().then(YT => {
      if (!mount.isConnected) return;
      let player;
      let interval = null;
      let resetting = false;
      const stop = () => {
        if (interval !== null) clearInterval(interval);
        interval = null;
      };
      const enforce = () => {
        if (!document.getElementById(mountId)?.isConnected) {
          stop();
          try { player.destroy(); } catch (_) {}
          return;
        }
        if (resetting || typeof player.getCurrentTime !== 'function') return;
        const current = Number(player.getCurrentTime());
        if (!Number.isFinite(current) || current < limit) return;
        resetting = true;
        stop();
        try {
          player.pauseVideo();
          player.seekTo(0, true);
          player.pauseVideo();
        } finally {
          setTimeout(() => { resetting = false; }, 600);
        }
      };
      player = new YT.Player(mountId, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, origin: location.origin },
        events: {
          onReady() {
            // Playback starts only when the student uses YouTube's play control.
          },
          onStateChange(event) {
            if (event.data !== YT.PlayerState.PLAYING) {
              stop();
              return;
            }
            if (resetting) {
              event.target.pauseVideo();
              return;
            }
            stop();
            interval = setInterval(enforce, 100);
            enforce();
          },
          onError(event) {
            stop();
            note.textContent = 'O YouTube não conseguiu reproduzir este vídeo (erro ' + event.data + '). Verifique se ele permite incorporação.';
          }
        }
      });
    }).catch(error => {
      note.textContent = error.message || 'Não foi possível iniciar o player do YouTube.';
    });
  }

  window.ShamathaYouTubeLimit = Object.freeze({ attach });
})();
