(() => {
  'use strict';

  const elephant = document.getElementById('journeyElephant');
  const path = document.querySelector('.path-line');
  const svg = document.querySelector('.journey-svg');
  if (!elephant || !path || !svg || typeof path.getTotalLength !== 'function') return;

  let replayDone = false;
  let replayStarted = false;
  let observer = null;

  function setStartPosition() {
    elephant.style.transition = 'none';
    elephant.style.left = '26%';
    elephant.style.top = '87.5%';
    elephant.style.setProperty('--face', '-1');
  }

  function buildSamples() {
    const rect = svg.getBoundingClientRect();
    const pathLength = path.getTotalLength();
    const scaleX = Math.max(1, rect.width) / 1000;
    const scaleY = Math.max(1, rect.height) / 1400;
    const sampleCount = 1100;
    const samples = [];
    let distance = 0;
    let previous = null;

    for (let i = 0; i <= sampleCount; i += 1) {
      const length = pathLength * (i / sampleCount);
      const point = path.getPointAtLength(length);
      if (previous) {
        distance += Math.hypot(
          (point.x - previous.x) * scaleX,
          (point.y - previous.y) * scaleY
        );
      }
      samples.push({
        x: point.x,
        y: point.y,
        left: (point.x / 1000) * 100,
        top: (point.y / 1400) * 100,
        distance
      });
      previous = point;
    }
    return samples;
  }

  function nearestTargetIndex(samples, targetLeft, targetTop) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < samples.length; i += 1) {
      const dx = samples[i].left - targetLeft;
      const dy = samples[i].top - targetTop;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  function sampleAtDistance(samples, maxIndex, targetDistance) {
    let low = 0;
    let high = maxIndex;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (samples[mid].distance < targetDistance) low = mid + 1;
      else high = mid;
    }
    return samples[low];
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function replayTo(targetLeft, targetTop) {
    if (replayDone || replayStarted) return;
    replayStarted = true;
    observer?.disconnect();

    const samples = buildSamples();
    const targetIndex = nearestTargetIndex(samples, targetLeft, targetTop);
    const targetDistance = samples[targetIndex]?.distance || 0;

    setStartPosition();
    elephant.classList.add('walking', 'journey-elephant-replay');
    void elephant.offsetWidth;

    if (targetIndex <= 2 || targetDistance <= 1) {
      elephant.style.left = `${targetLeft}%`;
      elephant.style.top = `${targetTop}%`;
      elephant.classList.remove('walking', 'journey-elephant-replay');
      elephant.style.transition = '';
      replayDone = true;
      return;
    }

    const fullDistance = samples[samples.length - 1].distance || targetDistance;
    const ratio = Math.max(0, Math.min(1, targetDistance / fullDistance));
    const duration = 1300 + 3200 * ratio;
    const startTime = performance.now();
    let previousX = samples[0].x;

    const frame = now => {
      const elapsed = Math.min(1, (now - startTime) / duration);
      const eased = easeInOutCubic(elapsed);
      const point = sampleAtDistance(samples, targetIndex, targetDistance * eased);

      elephant.style.left = `${point.left}%`;
      elephant.style.top = `${point.top}%`;
      if (Math.abs(point.x - previousX) > 0.25) {
        elephant.style.setProperty('--face', point.x > previousX ? '-1' : '1');
      }
      previousX = point.x;

      if (elapsed < 1) {
        requestAnimationFrame(frame);
        return;
      }

      elephant.style.left = `${targetLeft}%`;
      elephant.style.top = `${targetTop}%`;
      elephant.classList.remove('walking', 'journey-elephant-replay');
      elephant.style.transition = '';
      replayDone = true;
    };

    requestAnimationFrame(frame);
  }

  setStartPosition();

  observer = new MutationObserver(() => {
    if (replayDone || replayStarted) return;
    const left = Number.parseFloat(elephant.style.left);
    const top = Number.parseFloat(elephant.style.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;
    if (Math.abs(left - 26) < 0.01 && Math.abs(top - 87.5) < 0.01) return;
    queueMicrotask(() => {
      const targetLeft = Number.parseFloat(elephant.style.left);
      const targetTop = Number.parseFloat(elephant.style.top);
      if (Number.isFinite(targetLeft) && Number.isFinite(targetTop)) replayTo(targetLeft, targetTop);
    });
  });

  observer.observe(elephant, { attributes:true, attributeFilter:['style'] });
})();
