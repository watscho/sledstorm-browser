// Fixed-size controller records: 16 bytes/frame, allocated in 4096-frame chunks.
export class FrameHistory {
  constructor() { this.chunks = []; this.length = 0; }
  push(frame) {
    if (frame.tick !== this.length) throw new Error('History must be sequential');
    const chunk = this.length >>> 12, offset = (this.length & 4095) * 16;
    this.chunks[chunk] ||= new DataView(new ArrayBuffer(65536));
    const view = this.chunks[chunk];
    frame.pads.forEach((pad, seat) => view.setUint16(offset + seat * 2, pad, true));
    view.setUint32(offset + 8, frame.state ?? 0, true);
    view.setUint8(offset + 12, frame.state === null ? 0 : 1);
    return ++this.length;
  }
  slice(from, to) {
    const rows = [];
    for (let tick = from; tick < Math.min(to, this.length); tick++) {
      const view = this.chunks[tick >>> 12], offset = (tick & 4095) * 16;
      rows.push({ type: 'frame', tick, pads: Array.from({ length: 4 }, (_, seat) => view.getUint16(offset + seat * 2, true)),
        state: view.getUint8(offset + 12) ? view.getUint32(offset + 8, true) : null });
    }
    return rows;
  }
  clear() { this.chunks.length = 0; this.length = 0; }
}
