import test from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceMetrics, assessPerformance, performanceReport } from './performance-metrics.js';

const live = { target: 50, connected: true, synchronized: true, hidden: false, mode: 'dedicated', behindFrames: 0 };

test('game speed uses advancing timeline frames and browser intervals are measured separately', () => {
  const tracker = new PerformanceMetrics(50);
  tracker.sample({ now: 0, frame: 100, confirmedFrame: 100 });
  for (let time = 0; time <= 2000; time += 20) tracker.recordAnimation(time);
  const metrics = tracker.sample({ now: 2000, frame: 200, confirmedFrame: 200 });
  assert.equal(metrics.stepsPerSecond, 50);
  assert.equal(metrics.speedPercent, 100);
  assert.equal(metrics.browserP95Ms, 20);
  assert.equal(metrics.confirmationAgeMs, 0);
  assert.equal(assessPerformance(metrics, live).tone, 'good');
  assert.equal(tracker.sample({ now: 3500, frame: 275, confirmedFrame: 200 }).confirmationAgeMs, 1500);
});

test('backgrounding, reconnecting, loading a snapshot and timer suspension restart measurement', () => {
  const tracker = new PerformanceMetrics();
  tracker.sample({ now: 0, frame: 0 });
  tracker.sample({ now: 2000, frame: 100 });
  assert.equal(tracker.sample({ now: 3000, frame: 100, hidden: true }).stepsPerSecond, null);
  assert.equal(tracker.sample({ now: 30000, frame: 1500 }).stepsPerSecond, null);
  assert.equal(tracker.sample({ now: 32000, frame: 1600 }).speedPercent, 100);
  assert.equal(tracker.sample({ now: 32500, frame: 99999 }).stepsPerSecond, null);
  assert.equal(tracker.sample({ now: 33000, frame: 10 }).stepsPerSecond, null);
  assert.equal(tracker.sample({ now: 34000, frame: 60, connected: false }).stepsPerSecond, null);
  assert.equal(tracker.sample({ now: 35000, frame: 70, synchronized: false }).stepsPerSecond, null);
  assert.equal(tracker.sample({ now: 50000, frame: 1000 }).stepsPerSecond, null);
  assert.equal(tracker.sample({ now: 51000, frame: 1100, catchingUp: true }).stepsPerSecond, null);
  assert.equal(tracker.sample({ now: 52000, frame: 1200 }).stepsPerSecond, null);
  assert.equal(tracker.sample({ now: 53000, frame: 1250, waiting: true }).stepsPerSecond, null);
  assert.equal(tracker.sample({ now: 54000, frame: 1300 }).stepsPerSecond, null);
});

test('recent hitches expire and high refresh rate browser callbacks never inflate game speed', () => {
  const tracker = new PerformanceMetrics();
  tracker.sample({ now: 0, frame: 0 });
  for (let time = 0; time <= 1000; time += 8) tracker.recordAnimation(time);
  tracker.recordAnimation(1200);
  let metrics = tracker.sample({ now: 2000, frame: 100 });
  assert.equal(metrics.speedPercent, 100);
  assert.equal(metrics.browserHitches, 1);
  assert.equal(assessPerformance(metrics, live).title, 'Browser hitches detected');
  for (let time = 1208; time <= 9000; time += 8) tracker.recordAnimation(time);
  metrics = tracker.sample({ now: 9000, frame: 450 });
  assert.equal(metrics.browserHitches, 0);
  assert.equal(metrics.browserP95Ms, 8);
});

test('network and room states take precedence over suggesting lighter graphics', () => {
  const metrics = { stepsPerSecond: 20, speedPercent: 40, confirmationAgeMs: 1500 };
  assert.equal(assessPerformance(metrics, live).title, 'Room updates paused');
  assert.equal(assessPerformance(metrics, { ...live, hidden: true }).title, 'Tab in background');
  assert.equal(assessPerformance(metrics, { ...live, connected: false }).title, 'Disconnected');
  assert.equal(assessPerformance(metrics, { ...live, synchronized: false }).title, 'Synchronizing');
  assert.equal(assessPerformance(metrics, { ...live, waiting: true }).title, 'Room is waiting');
  metrics.confirmationAgeMs = 0;
  assert.equal(assessPerformance(metrics, { ...live, behindFrames: 20 }).title, 'Catching up');
  assert.equal(assessPerformance(metrics, live).title, 'Game is running slowly');
});

test('downloaded reports contain only settings and bounded measurements, without invitations or game data', () => {
  const metrics = { stepsPerSecond: 49.9876, speedPercent: 99.9752, token: 'SECRET_TOKEN' };
  const report = performanceReport({ ...live, preset: 'quality', widescreen: true, enhanced: true,
    drawDistance: 100, filter: 'clean', hardware: true, memoryBytes: 512 * 1048576,
    invitation: 'SECRET_INVITATION', url: 'SECRET_URL', state: new Uint8Array([1, 2, 3]) }, metrics,
  Array.from({ length: 100 }, () => metrics));
  assert.equal(report.measurements.stepsPerSecond, 50);
  assert.equal(report.recentSamples.length, 60);
  assert.equal(report.session.wasmMemoryMiB, 512);
  assert.equal(report.graphics.renderer, 'WebGL2');
  assert.doesNotMatch(JSON.stringify(report), /SECRET|Uint8Array/);
});
