(() => {
  'use strict';

  const audio = document.getElementById('meditationAudio');
  const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
  const SpeechRecognitionPhraseClass = window.SpeechRecognitionPhrase;

  const CUT_COOLDOWN_MS = 1300;
  const RESTART_DELAY_MS = 350;

  let micStream = null;
  let micPromise = null;
  let recognition = null;
  let recognitionRunning = false;
  let shouldListen = false;
  let restartTimer = null;
  let lastCutAt = 0;

  function statusNode() {
    return document.getElementById('voiceCutStatus');
  }

  function setStatus(message, state = '') {
    const node = statusNode();
    if (!node) return;
    node.textContent = message;
    node.dataset.state = state;
  }

  function normalizeWords(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function resultHasCut(result) {
    for (let i = 0; i < result.length; i += 1) {
      const transcript = String(result[i]?.transcript || '');
      if (normalizeWords(transcript).includes('cortar')) return transcript;
    }
    return '';
  }

  function releaseMicrophone() {
    if (!micStream) return;
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }

  async function prepareMicrophone() {
    if (!SpeechRecognitionClass) {
      setStatus('Marcador por voz indisponível neste navegador.', 'error');
      return null;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Acesso ao microfone indisponível neste navegador.', 'error');
      return null;
    }

    if (micStream?.active) return micStream;
    if (micPromise) return micPromise;

    micPromise = navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: { ideal:true },
        noiseSuppression: { ideal:true },
        autoGainControl: { ideal:true },
        channelCount: { ideal:1 }
      }
    }).then(stream => {
      micStream = stream;
      const track = stream.getAudioTracks()[0];
      if (track) {
        track.addEventListener('ended', () => {
          if (!shouldListen) return;
          setStatus('Microfone desconectado.', 'error');
          shouldListen = false;
        }, { once:true });
      }
      return stream;
    }).catch(error => {
      const blocked = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      setStatus(blocked ? 'Permissão do microfone bloqueada.' : 'Microfone indisponível.', 'error');
      return null;
    }).finally(() => {
      micPromise = null;
    });

    return micPromise;
  }

  function scheduleRestart() {
    clearTimeout(restartTimer);
    if (!shouldListen) return;
    restartTimer = setTimeout(() => {
      startRecognition().catch(() => null);
    }, RESTART_DELAY_MS);
  }

  function dispatchCut(transcript) {
    if (!audio || audio.paused || audio.ended || !Number.isFinite(audio.currentTime)) return;

    const now = performance.now();
    if (now - lastCutAt < CUT_COOLDOWN_MS) return;
    lastCutAt = now;

    document.dispatchEvent(new CustomEvent('shamatha:cut-detected', {
      detail: {
        time: Math.max(0, Number(audio.currentTime || 0)),
        detectedAt: Date.now(),
        transcript
      }
    }));

    setStatus('Corte marcado.', 'marked');
    setTimeout(() => {
      if (shouldListen && audio && !audio.paused && !audio.ended) {
        setStatus('Microfone ativo · diga “cortar”.', 'active');
      }
    }, 900);
  }

  function buildRecognition() {
    if (recognition || !SpeechRecognitionClass) return recognition;

    const instance = new SpeechRecognitionClass();
    instance.lang = 'pt-BR';
    instance.continuous = true;
    instance.interimResults = false;
    instance.maxAlternatives = 3;

    try {
      if (SpeechRecognitionPhraseClass && 'phrases' in instance) {
        instance.phrases = [new SpeechRecognitionPhraseClass('cortar', 5)];
      }
    } catch (_) {}

    instance.onstart = () => {
      recognitionRunning = true;
      if (audio && !audio.paused && !audio.ended) {
        setStatus('Microfone ativo · diga “cortar”.', 'active');
      }
    };

    instance.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal === false) continue;
        const transcript = resultHasCut(result);
        if (transcript) dispatchCut(transcript);
      }
    };

    instance.onerror = event => {
      const error = String(event.error || '');
      if (error === 'aborted' || error === 'no-speech') return;

      if (error === 'not-allowed' || error === 'service-not-allowed') {
        shouldListen = false;
        setStatus('Permissão do reconhecimento de voz bloqueada.', 'error');
        releaseMicrophone();
        return;
      }

      if (error === 'audio-capture') {
        shouldListen = false;
        setStatus('Microfone indisponível.', 'error');
        releaseMicrophone();
        return;
      }

      if (error === 'network') {
        shouldListen = false;
        setStatus('Reconhecimento de voz temporariamente indisponível.', 'error');
        releaseMicrophone();
        return;
      }

      setStatus('Reconhecimento de voz interrompido.', 'error');
    };

    instance.onend = () => {
      recognitionRunning = false;
      scheduleRestart();
    };

    recognition = instance;
    return recognition;
  }

  async function startRecognition() {
    if (!shouldListen || recognitionRunning) return;

    const stream = await prepareMicrophone();
    if (!shouldListen || recognitionRunning || !stream) return;

    const instance = buildRecognition();
    if (!instance) return;

    const track = stream.getAudioTracks()[0];

    try {
      if (track?.readyState === 'live') {
        try {
          instance.start(track);
        } catch (_) {
          instance.start();
        }
      } else {
        instance.start();
      }
    } catch (error) {
      if (error?.name !== 'InvalidStateError') {
        setStatus('Falha ao iniciar o reconhecimento de voz.', 'error');
      }
    }
  }

  function stopVoiceMarker({ releaseMic = true } = {}) {
    shouldListen = false;
    clearTimeout(restartTimer);
    restartTimer = null;

    if (recognition) {
      try { recognition.abort(); } catch (_) {}
    }
    recognitionRunning = false;

    if (releaseMic) releaseMicrophone();
  }

  document.addEventListener('shamatha:practice-preparing', event => {
    if (event.detail?.hasAudio === false) return;
    prepareMicrophone().catch(() => null);
  });

  document.addEventListener('shamatha:practice-started', event => {
    if (event.detail?.hasAudio === false) return;
    shouldListen = true;
    lastCutAt = 0;
    setStatus('Ativando microfone…', 'pending');
    startRecognition().catch(() => null);
  });

  document.addEventListener('shamatha:practice-ended', () => {
    stopVoiceMarker();
  });

  document.addEventListener('shamatha:audio-ended', () => {
    stopVoiceMarker();
  });

  audio?.addEventListener('pause', () => {
    if (shouldListen && !audio.ended) setStatus('Áudio pausado · marcador aguardando.', 'paused');
  });

  audio?.addEventListener('play', () => {
    if (shouldListen) setStatus('Microfone ativo · diga “cortar”.', 'active');
  });

  window.addEventListener('beforeunload', () => {
    stopVoiceMarker();
  });

  const style = document.createElement('style');
  style.textContent = `
    #unitScroll .voice-cut-panel {
      width: min(100%, 360px);
      margin-top: 18px;
      display: grid;
      gap: 10px;
      justify-items: center;
    }
    #unitScroll .voice-cut-status {
      min-height: 18px;
      color: #64748b;
      font-size: 12px;
      line-height: 1.45;
    }
    #unitScroll .voice-cut-status[data-state="active"] { color: #0f766e; }
    #unitScroll .voice-cut-status[data-state="marked"] { color: #92400e; font-weight: 700; }
    #unitScroll .voice-cut-status[data-state="error"] { color: #b45309; }
    #unitScroll .cut-markers {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
      min-height: 30px;
    }
    #unitScroll .cut-marker {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 6px 9px;
      border: 1px solid rgba(15,23,42,.10);
      border-radius: 999px;
      background: rgba(255,255,255,.72);
      color: #334155;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      box-shadow: 0 5px 14px rgba(15,23,42,.05);
      animation: shamathaCutIn .22s ease both;
    }
    @keyframes shamathaCutIn {
      from { opacity: 0; transform: translateY(4px) scale(.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
  `;
  document.head.appendChild(style);
})();