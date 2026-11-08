/* Copyright (c) 2026 Vacho Aivazov. SPDX-License-Identifier: MIT */
// Word count by four-opcode group, starting at GP0(20h). Zero marks polylines.
const drawLengths = [
  4, 7, 5, 9, 6, 9, 8, 12, 3, 3, 0, 0,
  4, 4, 0, 0, 3, 4, 2, 1, 2, 3, 2, 3,
];

export function packetEnd(words, start, limit) {
  const opcode = words[start] >>> 24;
  if (opcode < 0x20 || opcode >= 0xe0) return start + (opcode === 2 ? 3 : 1);
  if (opcode >= 0x80) return limit + 1;
  const length = drawLengths[(opcode - 0x20) >> 2];
  if (length) return start + length;
  const stride = (opcode & 16) ? 2 : 1;
  let cursor = start + (stride === 2 ? 4 : 3);
  while (cursor < limit && ((words[cursor] & 0xf000f000) >>> 0) !== 0x50005000) cursor += stride;
  return cursor + 1;
}

export function createRenderer(canvas, { sharpTextures = false, scale: renderScale = 4 } = {}) {
  const settings = {
    quality: renderScale, overscan: 0, ambilight: false, fullResTextures: false,
    textureFilter: sharpTextures ? 2 : 0,
  };
  let primitiveId = 0, renderer, area;
  const gpu = {
    status: 0, twin: 0, txflip: 0, tyflip: 0, quadU: 0, quadV: 0,
    getDisplayArea: () => ({ ...area }),
    updateTexturePage(page) { this.status = (this.status & ~0x1ff) | (page & 0x1ff); },
  };
  // INSERT_RENDERER

  renderer = new WebGLRenderer();
  const [drawLine, drawTriangle, drawRectangle] = ['drawLine', 'drawTriangle', 'drawRectangle'].map(key => renderer[key].bind(renderer));
  // INSERT_POLYGON_HELPERS
  const commands = {
    // INSERT_DRAW_COMMANDS
  };
  const handlers = Array.from({ length: 256 }, (_, op) => commands['pckt' + (op & 0xfc).toString(16).toUpperCase()]);
  const packet = new Int32Array(16);
  const signed11 = value => (value << 21) >> 21;
  const applied = new Uint32Array(7);
  function apply(word) {
    switch (word >>> 24) {
      case 0xe1:
        gpu.status = (gpu.status & ~0x7ff) | (word & 0x7ff);
        gpu.txflip = (word >>> 12) & 1;
        gpu.tyflip = (word >>> 13) & 1;
        break;
      case 0xe2:
        gpu.twin = ((word & 31) << 3) | (((word >>> 5) & 31) << 11) |
          (((word >>> 10) & 31) << 19) | (((word >>> 15) & 31) << 27);
        break;
      case 0xe3:
        renderer.setDrawAreaTL(word & 1023, (word >>> 10) & 511);
        break;
      case 0xe4: {
        const right = word & 1023;
        renderer.setDrawAreaBR(right === 511 ? area.w - 1 : right, (word >>> 10) & 511);
        break;
      }
      case 0xe5: {
        const x = signed11(word);
        renderer.setDrawAreaOF(x === 0 ? (area.w - 512) / 2 : x, signed11(word >>> 11));
        break;
      }
      case 0xe6:
        gpu.status = (gpu.status & ~0x1800) | ((word & 3) << 11);
        break;
    }
  }

  function clear(x, width) {
    flushVertexBuffer();
    flushDepth();
    clearRect(0, x, area.y, width, area.h);
  }

  function render(vram, y, headers, words, resetAt, filterTextures = sharpTextures) {
    if (gl.isContextLost()) return false;
    for (let batch = 0; batch < headers.length; batch += 10) {
      const end = headers[batch + 8] + headers[batch + 9];
      for (let i = headers[batch + 8]; i < end;) {
        i = packetEnd(words, i, end);
        if (i > end) return false;
      }
    }
    settings.textureFilter = filterTextures ? 2 : 0;
    latchFilters(renderer);
    gpu.status = 0;
    area = { x: 0, y, w: 684, h: 256 };
    gl.activeTexture(gl.TEXTURE0);
    gl_bindTexture(TEXTURE_2D, upload);
    gl_texSubImage2D(TEXTURE_2D, 0, 0, 0, 1024, 512, gl.RED_INTEGER, gl.UNSIGNED_SHORT, vram);
    renderer.seenRender = true;
    clear(0, area.w);
    applied.fill(0);
    for (let batch = 0; batch < headers.length; batch += 10) {
      if (batch / 10 === resetAt) clear((area.w - 512) / 2, 512);
      for (let k = 1; k < 7; ++k) {
        if (!batch || applied[k] !== headers[batch + k]) apply(applied[k] = headers[batch + k]);
      }
      const end = headers[batch + 8] + headers[batch + 9];
      for (let i = headers[batch + 8]; i < end; i = packetEnd(words, i, end)) {
        const word = words[i], op = word >>> 24;
        if (op >= 0x20 && op < 0x80) {
          const n = drawLengths[(op - 0x20) >> 2];
          if (!n) {
            const stride = (op & 16) ? 2 : 1;
            const terminator = packetEnd(words, i, end) - 1;
            for (let q = i + 1 + stride; q < terminator; q += stride) {
              packet[0] = (word & 0xff000000) | ((stride === 2 ? words[q - 3] : word) & 0xffffff);
              packet[1] = words[q - stride];
              packet[2] = words[q - (stride === 2 ? 1 : 0)];
              packet[3] = words[q];
              nextPrimitive();
              drawLine(packet, 0, 1, stride === 2 ? 2 : 0, stride === 2 ? 3 : 2);
            }
            continue;
          }
          for (let k = 0; k < n; ++k) packet[k] = words[i + k];
          nextPrimitive();
          if (n > 1) handlers[op]?.(packet);
        } else if (op === 2) {
          renderer.fillRectangle(words.subarray(i, i + 3));
        } else if (op >= 0xe1 && op <= 0xe6) {
          apply(applied[op & 7] = word);
        }
      }
    }
    renderer.onVBlankBegin();
    return true;
  }

  function redraw() {
    if (!area || gl.isContextLost()) return false;
    renderer.setTransparencyMode(4, renderer.programDisplay);
    showDisplay(renderer, 0, area);
    return true;
  }

  return { render, redraw };
}
