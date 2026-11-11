import { GRAPHICS_LABELS } from './graphics-presets.js';
import { PerformanceMetrics, assessPerformance, performanceReport } from './performance-metrics.js';

export function enablePerformanceDiagnostics(readState, notify) {
  const $ = id => document.getElementById(id);
  const panel = $('performance-panel');
  const download = $('download-performance');
  const tracker = new PerformanceMetrics(readState().target);
  const history = [];
  let latest;
  let animation;
  let lastPaint = -Infinity;
  panel.hidden = false;
  const put = (id, value) => {
    const element = $(id);
    if (element.textContent !== value) element.textContent = value;
  };
  const milliseconds = value => value === null ? '—' : Math.round(value) + ' ms';

  function update(force = false) {
    try {
      const state = readState();
      const now = performance.now();
      const metrics = tracker.sample({ ...state, now });
      latest = { state, metrics };
      if (!force && now - lastPaint < 1000) return;
      lastPaint = now;
      const assessment = assessPerformance(metrics, state);
      panel.dataset.tone = assessment.tone;
      put('performance-state', assessment.title);
      put('performance-advice', assessment.advice);
      const active = state.connected && state.synchronized && !state.hidden && !state.catchingUp && !state.waiting;
      put('performance-speed', metrics.speedPercent === null ? (active ? 'Measuring…' : '—')
        : Math.round(metrics.speedPercent) + '%');
      put('performance-speed-detail', metrics.stepsPerSecond === null ? 'Target: ' + state.target + ' console steps/s'
        : metrics.stepsPerSecond.toFixed(1) + ' / ' + state.target + ' console steps/s · ' + metrics.sampleSeconds.toFixed(1) + 's sample');
      put('performance-pacing', metrics.browserP95Ms === null ? (active ? 'Measuring…' : '—')
        : metrics.browserHitches ? metrics.browserHitches + (metrics.browserHitches === 1 ? ' hitch' : ' hitches') : 'Steady');
      put('performance-pacing-detail', metrics.browserP95Ms === null ? 'Browser timing restarts after backgrounding'
        : '95% within ' + milliseconds(metrics.browserP95Ms) + ' · longest ' + milliseconds(metrics.browserMaxMs) + ' · last 6s');
      let sync = 'Local session';
      let syncDetail = 'No network room';
      if (state.mode !== 'local') {
        sync = !state.connected ? 'Disconnected' : !state.synchronized ? 'Synchronizing…'
          : state.hidden ? 'Tab in background' : state.waiting ? 'Room is waiting'
          : metrics.confirmationAgeMs >= 1000 ? 'Updates paused'
          : state.behindFrames > 2 ? state.behindFrames + ' steps behind' : 'In sync';
        syncDetail = state.connected && state.synchronized && !state.hidden
          ? (state.behindFrames > 0 ? 'About ' + Math.round(state.behindFrames * 1000 / state.target) + ' ms behind the room. ' : '')
            + (metrics.confirmationAgeMs === null ? 'Room is synchronized.' : 'Last confirmed advance ' + milliseconds(metrics.confirmationAgeMs) + ' ago.')
          : 'Waiting for live room updates';
      }
      put('performance-sync', sync);
      put('performance-sync-detail', syncDetail);
      put('performance-renderer', (state.hardware ? 'WebGL 2' : 'Software') + (state.enhanced ? ' · 2×' : ' · 1×'));
      put('performance-graphics-detail', GRAPHICS_LABELS[state.preset] + ' · ' + (state.widescreen ? '16:9' : '4:3')
        + ' · ' + (state.drawDistance ? '+' + state.drawDistance + '%' : 'Original') + ' distance');
      if (active) history.push(metrics);
      else history.length = 0;
      if (history.length > 60) history.shift();
      download.disabled = false;
    } catch {
      latest = undefined;
      tracker.reset();
      panel.dataset.tone = 'neutral';
      put('performance-state', 'Measurements unavailable');
      put('performance-advice', 'The game can continue. Try opening this panel again after the room is ready.');
      for (const id of ['performance-speed', 'performance-pacing', 'performance-sync', 'performance-renderer']) put(id, '—');
      download.disabled = true;
    }
  }

  function tick(now) {
    tracker.recordAnimation(now);
    animation = requestAnimationFrame(tick);
  }
  function visibilityChanged() {
    tracker.reset();
    history.length = 0;
    update(true);
  }
  download.addEventListener('click', () => {
    update(true);
    if (!latest) return;
    try {
      const report = performanceReport(latest.state, latest.metrics, history);
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'sled-storm-performance-' + report.generatedAt.replace(/[:.]/g, '-') + '.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      notify('Performance report downloaded.');
    } catch { notify('Could not download the performance report.'); }
  });
  panel.addEventListener('toggle', () => { if (panel.open) update(true); });
  document.addEventListener('visibilitychange', visibilityChanged);
  animation = requestAnimationFrame(tick);
  const interval = setInterval(update, 500);
  update(true);
  window.addEventListener('pagehide', () => {
    clearInterval(interval);
    cancelAnimationFrame(animation);
    document.removeEventListener('visibilitychange', visibilityChanged);
  }, { once: true });
}
