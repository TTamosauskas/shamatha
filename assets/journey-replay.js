(() => {
  'use strict';

  const elephant = document.getElementById('journeyElephant');
  const path = document.querySelector('.path-line');
  const svg = document.querySelector('.journey-svg');
  const shell = document.getElementById('appShell');
  if (!elephant || !path || !svg || typeof path.getTotalLength !== 'function') return;

  let replayDone = false;
  let replayStarted = false;
  let observer = null;

  function viewBox() {
    const box = svg.viewBox?.baseVal;
    return { width:Number(box?.width || 1000), height:Number(box?.height || 1400) };
  }

  function follow(top, behavior = 'auto') {
    if (!shell?.classList.contains('dynamic-journey')) return;
    const y = Math.max(0, (top / 100) * shell.offsetHeight - window.innerHeight * .48);
    window.scrollTo({ top:y, behavior });
  }

  function setStartPosition() {
    const view = viewBox();
    const point = path.getPointAtLength(0);
    const left = (point.x / view.width) * 100;
    const top = (point.y / view.height) * 100;
    elephant.style.transition = 'none';
    elephant.style.left = `${left}%`;
    elephant.style.top = `${top}%`;
    follow(top);
  }

  function buildSamples() {
    const rect = svg.getBoundingClientRect();
    const view = viewBox();
    const pathLength = path.getTotalLength();
    const scaleX = Math.max(1, rect.width) / view.width;
    const scaleY = Math.max(1, rect.height) / view.height;
    const sampleCount = 1400;
    const samples = [];
    let distance = 0;
    let previous = null;

    for (let i = 0; i <= sampleCount; i += 1) {
      const length = pathLength * (i / sampleCount);
      const point = path.getPointAtLength(length);
      if (previous) distance += Math.hypot((point.x - previous.x) * scaleX, (point.y - previous.y) * scaleY);
      samples.push({ x:point.x, y:point.y, left:(point.x/view.width)*100, top:(point.y/view.height)*100, distance });
      previous = point;
    }
    return samples;
  }

  function nearestTargetIndex(samples, targetLeft, targetTop) {
    let bestIndex = 0, bestDistance = Infinity;
    for (let i = 0; i < samples.length; i += 1) {
      const dx = samples[i].left - targetLeft, dy = samples[i].top - targetTop;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) { bestDistance = distance; bestIndex = i; }
    }
    return bestIndex;
  }

  function sampleAtDistance(samples, maxIndex, targetDistance) {
    let low = 0, high = maxIndex;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (samples[mid].distance < targetDistance) low = mid + 1;
      else high = mid;
    }
    return samples[low];
  }

  function easeInOutCubic(t) {
    return t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;
  }

  function finishAt(targetLeft, targetTop) {
    elephant.style.left = `${targetLeft}%`;
    elephant.style.top = `${targetTop}%`;
    elephant.classList.remove('walking','journey-elephant-replay');
    elephant.style.transition = '';
    follow(targetTop, 'smooth');
    replayDone = true;
  }

  function replayTo(targetLeft, targetTop) {
    if (replayDone || replayStarted) return;
    replayStarted = true;
    observer?.disconnect();
    const samples = buildSamples();
    const targetIndex = nearestTargetIndex(samples,targetLeft,targetTop);
    const targetDistance = samples[targetIndex]?.distance || 0;
    setStartPosition();
    elephant.classList.add('walking','journey-elephant-replay');
    void elephant.offsetWidth;

    if (targetIndex <= 2 || targetDistance <= 1 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      finishAt(targetLeft,targetTop);
      return;
    }

    const fullDistance = samples[samples.length-1].distance || targetDistance;
    const ratio = Math.max(0,Math.min(1,targetDistance/fullDistance));
    const duration = 1300 + 3200 * ratio;
    const startTime = performance.now();
    let previousX = samples[0].x;

    const frame = now => {
      const elapsed = Math.min(1,(now-startTime)/duration);
      const point = sampleAtDistance(samples,targetIndex,targetDistance*easeInOutCubic(elapsed));
      elephant.style.left = `${point.left}%`;
      elephant.style.top = `${point.top}%`;
      follow(point.top);
      if (Math.abs(point.x-previousX) > .25) elephant.style.setProperty('--face',point.x>previousX?'-1':'1');
      previousX = point.x;
      if (elapsed < 1) return requestAnimationFrame(frame);
      finishAt(targetLeft,targetTop);
    };
    requestAnimationFrame(frame);
  }

  setStartPosition();
  observer = new MutationObserver(() => {
    if (replayDone || replayStarted) return;
    queueMicrotask(() => {
      const targetLeft = Number.parseFloat(elephant.style.left);
      const targetTop = Number.parseFloat(elephant.style.top);
      if (Number.isFinite(targetLeft) && Number.isFinite(targetTop)) replayTo(targetLeft,targetTop);
    });
  });
  observer.observe(elephant,{attributes:true,attributeFilter:['style','class']});
})();
