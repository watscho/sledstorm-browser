const WINDOW_MS = 6000;
const finite = value => typeof value === 'number' && Number.isFinite(value);

// Sample the live timeline, not replayed core steps. Browser animation intervals
// are a separate measurement and must never be presented as game FPS or ping.
export class PerformanceMetrics {
  constructor(target = 50) {
    this.target = target;
    this.reset();
  }

  reset() {
    this.frames = [];
    this.animations = [];
    this.lastAnimation = undefined;
    this.confirmed = undefined;
    this.confirmedAt = undefined;
  }

  recordAnimation(now) {
    if (this.phase !== 'live' || !finite(now)) return;
    if (this.lastAnimation !== undefined && now > this.lastAnimation) {
      this.animations.push({ at: now, ms: now - this.lastAnimation });
      if (this.animations.length > 1200) this.animations.splice(0, 600);
    }
    this.lastAnimation = now;
  }

  sample({ now, frame, confirmedFrame, hidden = false, connected = true, synchronized = true, catchingUp = false, waiting = false }) {
    const phase = hidden ? 'hidden' : !connected ? 'disconnected' : !synchronized ? 'syncing'
      : waiting ? 'waiting' : catchingUp ? 'recovering' : 'live';
    if (phase !== this.phase) this.reset();
    this.phase = phase;
    if (phase !== 'live' || !finite(now)) return this.snapshot(now);
    const previous = this.frames.at(-1);
    if (finite(frame) && frame >= 0) {
      // Loading a state, wrapping the counter or resuming a suspended timer must
      // not turn into a huge performance spike or a false slowdown.
      if (previous && (frame < previous.frame || now - previous.at > WINDOW_MS * 2 ||
          frame - previous.frame > this.target * (now - previous.at) / 1000 * 8)) this.reset();
      this.frames.push({ at: now, frame });
      while (this.frames.length > 2 && this.frames[1].at <= now - WINDOW_MS) this.frames.shift();
      if (this.frames.length > 60) this.frames.shift();
    }
    if (finite(confirmedFrame)) {
      if (this.confirmed !== confirmedFrame) this.confirmedAt = now;
      this.confirmed = confirmedFrame;
    } else {
      this.confirmed = this.confirmedAt = undefined;
    }
    return this.snapshot(now);
  }

  snapshot(now) {
    this.animations = this.animations.filter(item => item.at > now - WINDOW_MS);
    const first = this.frames[0];
    const last = this.frames.at(-1);
    const elapsed = first && last ? last.at - first.at : 0;
    const stepsPerSecond = elapsed >= 2000 ? (last.frame - first.frame) * 1000 / elapsed : null;
    const intervals = this.animations.map(item => item.ms).sort((a, b) => a - b);
    return {
      stepsPerSecond,
      speedPercent: stepsPerSecond === null ? null : stepsPerSecond / this.target * 100,
      sampleSeconds: elapsed / 1000,
      browserP95Ms: intervals.length >= 10 ? intervals[Math.ceil(intervals.length * 0.95) - 1] : null,
      browserMaxMs: intervals.length >= 10 ? intervals.at(-1) : null,
      browserHitches: intervals.filter(ms => ms >= 100).length,
      confirmationAgeMs: this.confirmedAt === undefined ? null : Math.max(0, now - this.confirmedAt),
    };
  }
}

export function assessPerformance(metrics, state) {
  if (state.hidden) return { tone: 'neutral', title: 'Tab in background', advice: 'Bring the game tab to the foreground. Measurements restart when you return.' };
  if (!state.connected) return { tone: 'bad', title: 'Disconnected', advice: 'Open the same invitation and join again to reconnect to your controller.' };
  if (!state.synchronized) return { tone: 'neutral', title: 'Synchronizing', advice: 'Wait for the game to join the live room before judging performance.' };
  if (state.waiting) return { tone: 'warning', title: 'Room is waiting', advice: 'The room has paused. Check that the host and other players are still connected.' };
  if (metrics.confirmationAgeMs >= 1000) return { tone: 'warning', title: 'Room updates paused', advice: 'Confirmed room updates have stopped advancing. The connection, host or a busy local browser may be delaying them.' };
  if (state.catchingUp || state.behindFrames >= 12) return { tone: 'warning', title: 'Catching up', advice: 'This browser is behind the live room. Connection delays or local load can contribute. If it continues, try Performance before joining again.' };
  if (metrics.stepsPerSecond === null) return { tone: 'neutral', title: 'Measuring…', advice: 'Collecting a few seconds of gameplay. Startup and background time are excluded.' };
  if (metrics.speedPercent < 90) return { tone: 'warning', title: 'Game is running slowly', advice: 'Try the Performance graphics preset before launching again and close other busy apps. Delayed room inputs can also slow the game.' };
  if (metrics.browserHitches > 0 || metrics.browserP95Ms > 50) return { tone: 'warning', title: 'Browser hitches detected', advice: 'The browser had delays between animation frames. Try a lighter graphics preset or close other busy tabs.' };
  return { tone: 'good', title: 'Running smoothly', advice: 'Game speed is near its target and recent browser timing is steady.' };
}

const METRICS = ['stepsPerSecond', 'speedPercent', 'sampleSeconds', 'browserP95Ms', 'browserMaxMs', 'browserHitches', 'confirmationAgeMs'];
const reportMetrics = metrics => Object.fromEntries(METRICS.map(key => [key, finite(metrics[key]) ? Math.round(metrics[key] * 10) / 10 : null]));

// Export only measurements and known settings. Never serialize room objects,
// URLs, invitations, file handles, emulator snapshots or arbitrary error text.
export function performanceReport(state, metrics, history = []) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    targetStepsPerSecond: state.target,
    mode: ['dedicated', 'browser-hosted', 'local'].includes(state.mode) ? state.mode : 'local',
    graphics: {
      preset: ['performance', 'balanced', 'quality', 'custom'].includes(state.preset) ? state.preset : 'custom',
      aspect: state.widescreen ? '16:9' : '4:3',
      enhanced: Boolean(state.enhanced),
      drawDistance: Math.max(0, Math.min(100, Number(state.drawDistance) || 0)),
      filter: ['clean', 'crisp', 'smooth', 'crt'].includes(state.filter) ? state.filter : 'crisp',
      renderer: state.hardware ? 'WebGL2' : 'software',
    },
    session: {
      connected: Boolean(state.connected), synchronized: Boolean(state.synchronized),
      hidden: Boolean(state.hidden), catchingUp: Boolean(state.catchingUp), waiting: Boolean(state.waiting),
      behindFrames: finite(state.behindFrames) ? state.behindFrames : null,
      wasmMemoryMiB: finite(state.memoryBytes) ? Math.round(state.memoryBytes / 1048576) : null,
    },
    assessment: assessPerformance(metrics, state).title,
    measurements: reportMetrics(metrics),
    recentSamples: history.slice(-60).map(reportMetrics),
    notes: 'Browser animation timing is not game FPS. Confirmation age and room backlog are not ping or input latency. Audio quality is not measured.',
  };
}
