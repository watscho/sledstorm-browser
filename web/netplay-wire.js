export const mirrorPayloadLimit = 512;
export const mirrorBufferLimit = 256 * 1024;
export const sequenceBytes = 4;

const asBytes = data => ArrayBuffer.isView(data)
  ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  : new Uint8Array(data);

export function sequencePacket(sequence, data) {
  const payload = asBytes(data);
  const packet = new Uint8Array(sequenceBytes + payload.byteLength);
  new DataView(packet.buffer).setUint32(0, sequence);
  packet.set(payload, sequenceBytes);
  return packet;
}

export function orderedPackets(deliver) {
  let next = 0;
  let queuedBytes = 0;
  const pending = new Map();
  return (packet, afterDelivery) => {
    if (!(packet instanceof ArrayBuffer || ArrayBuffer.isView(packet)) || packet.byteLength < sequenceBytes) return false;
    const bytes = asBytes(packet);
    const sequence = new DataView(bytes.buffer, bytes.byteOffset, sequenceBytes).getUint32(0);
    const ahead = (sequence - next) >>> 0;
    if (ahead >= 0x80000000) {
      afterDelivery?.();
      return true;
    }
    const existing = pending.get(sequence);
    if (existing) {
      if (afterDelivery) existing.afterDelivery = afterDelivery;
      return true;
    }
    if (ahead > 512 || (ahead && queuedBytes + bytes.length > mirrorBufferLimit)) return false;
    const payload = bytes.subarray(sequenceBytes);
    if (ahead) {
      pending.set(sequence, { payload, afterDelivery });
      queuedBytes += bytes.length;
      return true;
    }
    next = (next + 1) >>> 0;
    deliver(payload);
    afterDelivery?.();
    while (pending.has(next)) {
      const queued = pending.get(next);
      pending.delete(next);
      queuedBytes -= queued.payload.length + sequenceBytes;
      next = (next + 1) >>> 0;
      deliver(queued.payload);
      queued.afterDelivery?.();
    }
    return true;
  };
}
