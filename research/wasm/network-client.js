const KEY_BITS = { ShiftRight: 0, Enter: 3, ArrowUp: 4, ArrowRight: 5, ArrowDown: 6,
  ArrowLeft: 7, KeyE: 8, KeyR: 9, KeyQ: 10, KeyW: 11, KeyA: 12, KeyS: 13, KeyX: 14, KeyZ: 15 };

export class BrowserSession {
  constructor(onStatus, options = {}) {
    this.onStatus = onStatus;
    this.pad = 65535;
    this.pending = new Map();
    this.frames = new Map();
    this.nextFrame = 0;
    this.history = new Map();
    this.digests = new Map();
    this.warmed = false;
    this.tick = -1;
    this.verified = -1;
    this.active = false;
    this.metrics = { buffered: 0, waits: 0, waitMs: 0 };
    this.keyMap = options.keyMap || KEY_BITS;
    this.input = (event) => {
      const bit = this.keyMap[event.code];
      if (bit === undefined) return;
      // Focus can move from the canvas to a toolbar while a key is held.
      // Always release it, even when that toolbar now owns the keyup target.
      if (event.type === 'keyup') { this.pad |= 1 << bit; return; }
      if (event.target.closest?.('input,select,textarea,button,summary,[contenteditable="true"]') || ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
      event.preventDefault();
      this.pad = event.type === 'keydown' ? this.pad & ~(1 << bit) : this.pad | (1 << bit);
    };
    window.addEventListener('keydown', this.input, true);
    window.addEventListener('keyup', this.input, true);
    window.addEventListener('blur', () => { this.pad = 65535; });
  }
  connect(identity, invitation, onInvite) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const endpoint = location.port === '8001' ? `${protocol}//${location.hostname}:8002` : `${protocol}//${location.host}/relay`;
    this.socket = new WebSocket(endpoint);
    return new Promise((resolve, reject) => {
      this.socket.addEventListener('open', () => {
        this.socket.send(JSON.stringify(invitation ? { type: 'join', identity, room: invitation.room, token: invitation.token } : { type: 'create', identity }));
        this.heartbeat = setInterval(() => {
          if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'ping' }));
        }, 10_000);
      });
      this.socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'created') {
          this.slot = 0;
          onInvite(message);
          this.onStatus('Session ready. Share the link to connect another controller.');
        } else if (message.type === 'start') {
          this.slot = message.slot;
          this.delay = message.inputDelay ?? 0;
          this.replayTarget = message.replayTarget ?? 0;
          this.replaying = this.replayTarget > 0;
          if (!Number.isInteger(this.slot) || this.slot < 0 || this.slot > 3 || !Number.isInteger(this.delay) || this.delay < 0 || this.delay > 8 || !Number.isInteger(this.replayTarget) || this.replayTarget < 0) { this.fail('Invalid session parameters'); return; }
          this.active = true;
          resolve(this.slot);
        } else if (message.type === 'presence') {
          this.members = message.slots.filter(Boolean).length;
          this.syncing = message.syncing;
        } else if (message.type === 'history') {
          for (const frame of message.frames) this.history.set(frame.tick,frame);
          this.historyWaiter?.(); this.historyWaiter = null;
        } else if (message.type === 'frame') {
          if (!Number.isInteger(message.tick) || message.tick <= this.tick || message.tick > this.nextFrame + 16 || this.frames.has(message.tick)) {
            this.fail('Unexpected simulation tick'); return;
          }
          const pending = this.pending.get(message.tick);
          if (pending) {
            this.pending.delete(message.tick);
            pending.resolve(this.consume(message));
          } else this.frames.set(message.tick, message);
        } else if (message.type === 'error' || message.type === 'ended') {
          const reason = message.message || message.reason;
          this.fail(reason);
          reject(new Error(reason));
        }
      });
      this.socket.addEventListener('error', () => { this.fail('Network connection failed'); reject(new Error('Network connection failed')); });
      this.socket.addEventListener('close', () => { this.fail(this.error || 'Connection closed'); reject(new Error(this.error)); });
    });
  }
  samplePad() {
    let pad = this.pad;
    const gamepad = Array.from(navigator.getGamepads?.() || []).find((pad) => pad?.mapping === 'standard');
    if (gamepad?.mapping === 'standard') {
      const map = [14, 13, 15, 12, 10, 11, 8, 9, 0, 3, 1, 2, 4, 6, 7, 5];
      for (let i = 0; i < map.length; ++i) if (gamepad.buttons[i]?.pressed) pad &= ~(1 << map[i]);
      if (gamepad.axes[0] < -0.4) pad &= ~(1 << 7);
      if (gamepad.axes[0] > 0.4) pad &= ~(1 << 5);
      if (gamepad.axes[1] < -0.4) pad &= ~(1 << 4);
      if (gamepad.axes[1] > 0.4) pad &= ~(1 << 6);
    }
    return pad;
  }
  async exchange(tick, state) { return this.exchangeFast(tick, state); }
  exchangeFast(tick, state) {
    const result = this.exchangeRow(tick, state);
    if (result?.then) {
      ++this.metrics.waits;
      const began = performance.now();
      return result.then(row => { this.metrics.waitMs += performance.now() - began; return row; });
    }
    ++this.metrics.buffered;
    return result;
  }
  replayRow(tick) {
    const consume = () => {
      const frame = this.history.get(tick); this.history.delete(tick);
      if (!frame) { this.fail('Missing replay frame'); throw new Error(this.error); }
      if (tick % 100 === 0) this.onStatus(`Syncing session: ${tick}/${this.replayTarget}`);
      return this.consume(frame);
    };
    if (this.history.has(tick)) return consume();
    const available = new Promise((resolve,reject)=>{this.historyWaiter=resolve;this.historyReject=reject;});
    this.socket.send(JSON.stringify({type:'history',from:tick}));
    return available.then(() => { this.historyReject=null; return consume(); });
  }
  exchangeRow(tick, state) {
    tick >>>= 0;
    if (state !== null) state >>>= 0;
    if (!this.active || this.socket.readyState !== WebSocket.OPEN) throw new Error(this.error || 'Peer is unavailable');
    if (tick !== this.nextFrame++) { this.fail('Non-sequential guest frame'); throw new Error(this.error); }
    if (state !== null) { this.digests.set(tick,state); if(this.digests.size>16)this.digests.delete(this.digests.keys().next().value); }
    if (tick < this.replayTarget) return this.replayRow(tick);
    this.replaying=false;
    if (!this.warmed) {
      this.warmed=true;
      this.socket.send(JSON.stringify({type:'ready',tick}));
      for(let frame=tick;frame<tick+this.delay;frame++)this.socket.send(JSON.stringify({type:'input',tick:frame,pad:65535,state:this.digests.get(frame-this.delay)??null}));
    }
    this.socket.send(JSON.stringify({type:'input',tick:tick+this.delay,pad:this.samplePad(),state}));
    const ready=this.frames.get(tick);
    if(ready){this.frames.delete(tick);return this.consume(ready);}
    return new Promise((resolve,reject)=>this.pending.set(tick,{resolve,reject}));
  }
  consume(message) {
    if (!Array.isArray(message.pads) || message.pads.length!==4 || message.pads.some(p=>!Number.isInteger(p)||p<0||p>65535)) throw new Error('Invalid controller row');
    if (message.state !== (this.digests.get(message.tick-this.delay)??null)) {
      this.fail(`Replay desync at tick ${message.tick}`); throw new Error(this.error);
    }
    this.tick=message.tick;
    if(message.state!==null)this.verified=message.tick-this.delay;
    return message.pads;
  }
  fail(reason) {
    if (this.error) return;
    this.error = reason;
    this.active = false;
    clearInterval(this.heartbeat);
    for (const pending of this.pending.values()) pending.reject(new Error(reason));
    this.pending.clear();
    this.frames.clear();
    this.historyReject?.(new Error(reason));
    this.history.clear();
    this.onStatus(`Session paused: ${reason}. Reload to reconnect.`);
    this.socket?.close();
  }
}
