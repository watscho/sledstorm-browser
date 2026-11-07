// Frame gate around the pinned Emscripten loop. No timers drive emulation here.
export class FrameSync {
  constructor({ module, manager, session, onStatus, digest, beforeFrame = () => {}, externalInput = false }) {
    this.module = module;
    this.manager = manager;
    this.session = session;
    this.onStatus = onStatus;
    this.digest = digest;
    this.beforeFrame = beforeFrame;
    this.tick = 0;
    this.waiting = false;
    this.row = null;
    this.running = false;
    this.failure = null;
    this.beforeCount = null;
    this.advanced = 0;
    this.snapshots = [];
    const localBits = [14, 15, 0, 3, 4, 6, 7, 5, 13, 12, 10, 11, 8, 9, 1, 2];
    this.session.pad ??= 65535;
    this.manager.simulateInput = (_seat, button, pressed) => {
      if (externalInput) return; // BrowserSession owns keyboard and controller sampling.
      const bit = localBits[button];
      if (bit !== undefined) this.session.pad = pressed ? this.session.pad & ~(1 << bit) : this.session.pad | (1 << bit);
    };
    this.manager.setKeyboardEnabled(false);
    this.manager.toggleFastForward(0);
    this.manager.toggleSlowMotion(0);
    this.manager.functions.toggleRewind?.(0);
    if (this.module._sled_frame_count) {
      this.manager.getFrameNum = () => this.module._sled_frame_count();
      this.module.sledBeforeFrame = () => true;
      this.module.sledAfterFrame = () => { if (this.restoring) this.checkRestore(); };
      this.module.sledCoreBefore = () => this.before();
      this.module.sledCoreAfter = () => this.after();
    } else {
      this.module.sledBeforeFrame = () => this.before();
      this.module.sledAfterFrame = () => this.after();
    }
    this.module.sledFrameBudget = () => this.session.replaying ? 16 : 1;
  }
  start() { this.running = true; }
  stop(reason) {
    this.failure = reason;
    this.running = false;
    if (this.restoring) { this.restoring.reject(new Error(reason)); this.restoring = null; }
    this.session.fail(reason);
    for (const pending of this.snapshots.splice(0)) pending.reject(new Error(reason));
  }
  before() {
    if (this.restoring) { this.checkRestore(); return Boolean(this.restoring); }
    if (!this.running || this.failure) return false;
    if (this.replayMode !== Boolean(this.session.replaying)) {
      this.replayMode = Boolean(this.session.replaying);
      this.manager.setFastForwardRatio?.(32);
      this.manager.toggleFastForward(this.replayMode ? 1 : 0);
      this.onReplayChange?.(this.replayMode);
    }
    if (!this.row) {
      this.request();
      return false;
    }
    // PSX active-low bits -> EmulatorJS/libretro RetroPad button IDs.
    try { this.beforeFrame(); } catch (error) { this.stop(error.message); return false; }
    const buttons = [2, null, null, 3, 4, 7, 5, 6, 12, 13, 10, 11, 9, 8, 0, 1];
    for (let seat = 0; seat < 4; seat++) {
      for (let bit = 0; bit < 16; bit++) {
        if (buttons[bit] !== null) this.manager.functions.simulateInput(seat, buttons[bit], (this.row[seat] & (1 << bit)) ? 0 : 1);
      }
    }
    this.row = null;
    this.beforeCount = Number(this.manager.getFrameNum());
    return true;
  }
  after() {
    if (this.restoring) {
      this.checkRestore();
      return;
    }
    if (this.beforeCount === null) return;
    const delta = Number(this.manager.getFrameNum()) - this.beforeCount;
    this.beforeCount = null;
    if (delta !== 1) {
      this.stop(`Core advanced ${delta} frames; expected exactly one. Session stopped.`);
      return;
    }
    this.tick++;
    this.advanced++;
    for (const pending of this.snapshots.filter(item => item.tick === this.tick)) {
      pending.resolve(this.manager.getState());
    }
    this.snapshots = this.snapshots.filter(item => item.tick !== this.tick);
    if (this.tick % 50 === 0) this.onStatus();
    this.request();
  }
  request() {
    if (this.waiting || this.row || !this.running) return;
    this.waiting = true;
    try {
      const state = this.tick % 250 === 0 ? this.digest() : null;
      const result = this.session.exchangeFast ? this.session.exchangeFast(this.tick, state) : this.session.exchange(this.tick, state);
      const accept = row => {
        this.row = row;
        this.waiting = false;
      };
      if (result?.then) result.then(accept).catch(error => this.stop(error.message));
      else accept(result);
    } catch (error) { this.stop(error.message); }
  }
  snapshot(tick) {
    if (!Number.isInteger(tick) || tick < this.tick || tick > this.tick + 24) return Promise.reject(new Error('Invalid snapshot boundary'));
    if (tick === this.tick) return Promise.resolve(this.manager.getState());
    return new Promise((resolve, reject) => this.snapshots.push({ tick, resolve, reject }));
  }
  restore(bytes, tick, verify) {
    if (this.running || this.restoring) return Promise.reject(new Error('Cannot restore a running console'));
    return new Promise((resolve, reject) => {
      this.restoring = { tick, verify, resolve, reject, deadline: performance.now() + 5000 };
      this.manager.loadState(bytes);
    });
  }
  checkRestore() {
    const pending = this.restoring;
    try {
      if (pending.verify(this.manager.getState())) {
        this.restoring = null; this.tick = pending.tick; pending.resolve();
      } else if (performance.now() > pending.deadline) {
        this.restoring = null; pending.reject(new Error('Snapshot did not restore the exact console state'));
      }
    } catch (error) { this.restoring = null; pending.reject(error); }
  }
}

export function stateDigest(bytes) {
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 16777619);
  return hash >>> 0;
}
