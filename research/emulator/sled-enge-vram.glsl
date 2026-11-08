    // The PAL wide pass samples textures from the original PSX VRAM snapshot.
    uint vramWord(ivec2 coord) {
      return texelFetch(u_texture, coord & ivec2(1023, 511), 0).r;
    }

    vec4 unpackColor(uint word) {
      uvec3 rgb = (uvec3(word, word >> 5u, word >> 10u) & 31u) << 3u;
      return vec4(vec3(rgb) / 255.0, (word & 0x8000u) == 0u ? 0.0 : 1.0);
    }

    vec4 vram16Bit(int tx, int ty) {
      return unpackColor(vramWord((v_texturePage >> u_scaleShift) + ivec2(tx, ty)));
    }

    vec4 vram16BitFull(ivec2 texel, ivec2 subpixel) {
      return vram16Bit(texel.x, texel.y);
    }

    ivec2 textureWindow(ivec2 t) {
      return ivec2(((t.x & 255) & ~twin.x) | (twin.z & twin.x),
                   ((t.y & 255) & ~twin.y) | (twin.a & twin.y));
    }

    vec4 vram8bit(int tx, int ty) {
      uint packedWord = vramWord((v_texturePage >> u_scaleShift) + ivec2(tx >> 1, ty));
      int index = int((packedWord >> uint((tx & 1) * 8)) & 255u);
      return unpackColor(vramWord(clut + ivec2(index, 0)));
    }

    vec4 vram4bit(int tx, int ty) {
      uint packedWord = vramWord((v_texturePage >> u_scaleShift) + ivec2(tx >> 2, ty));
      int index = int((packedWord >> uint((tx & 3) * 4)) & 15u);
      return unpackColor(vramWord(clut + ivec2(index, 0)));
    }
