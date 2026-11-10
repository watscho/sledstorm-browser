#!/usr/bin/env python3
"""Build the opt-in WebGL2 preview from verified eNGE sources."""
import argparse
import hashlib
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
COMMIT = '3c154d8c429fca39eb9295104c922c9b803a2823'
BASE = f'https://raw.githubusercontent.com/kootstra-rene/enge-js/{COMMIT}/'
FILES = {
    'LICENSE': '9cbb6d5f89adb620de2f2bdb34984ad080fa477312761f0b4d71ce3d0a5be23e',
    'code/enge-webgl2.js': 'b185c6f04b301003295c63f270b19a4ca83b346f5a100e7705ba5b0062d9ac7b',
    'code/enge-webgl2-shaders.js': 'a025bcf5fbd0921899ecfa09c0e3b33f2dfe1cb5901d5ad494650395c2e8bb1f',
    'code/psx/gpu.js': 'e451a58cb6c174b2121452fc99d48a0633675087cc058ac7df60dac97e251e29',
}


def source(name, directory):
    if directory:
        data = (directory / name).read_bytes()
    else:
        with urlopen(BASE + name, timeout=30) as response:
            data = response.read()
    if hashlib.sha256(data).hexdigest() != FILES[name]:
        raise ValueError(f'Unexpected source hash for {name}')
    return data.decode('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, help='Use an existing checkout of the pinned eNGE revision')
    args = parser.parse_args()
    license_text, render, shaders, gpu = (source(name, args.source) for name in FILES)

    shaders = shaders.replace("mdlr('enge:webgl2:shaders', () => {", 'const makeShaders = () => {', 1)
    shaders = shaders.strip().removesuffix('})') + '};'
    # The isolated PAL camera samples an immutable VRAM snapshot. Read its
    # native words directly instead of expanding and blitting two 4× copies.
    shaders = shaders.replace('uniform sampler2D u_texture;', 'uniform highp usampler2D u_texture;', 1)
    start = shaders.index('    int getSBGRfromRGBA(')
    end = shaders.index('    // one texel through texture window', start)
    sampler = (ROOT / 'research/emulator/sled-enge-vram.glsl').read_text()
    shaders = shaders[:start] + sampler + '\n' + shaders[end:]
    utils = render[render.index("  const shaders = include('enge:webgl2:shaders');"):
                   render.index("mdlr('enge:psx:webgl2'")].strip().removesuffix('})')
    utils = utils.replace("include('enge:webgl2:shaders')", 'makeShaders()')
    utils = utils[:utils.rindex('  return {')]

    render = render[render.index('  // VRAM render scale'):render.index('  window.primitiveId')]
    render = render.replace("  const canvas = document.getElementById('display');\n"
                            "  const ambilight = document.querySelector('#ambilight').getContext('2d', { alpha: false });",
                            "  const ambilight = document.createElement('canvas').getContext('2d');")
    render = render.replace('return abort();', 'throw e;')
    render = render.replace('      antialias: false,', '      antialias: false,\n      failIfMajorPerformanceCaveat: true,', 1)
    render = render.replace('  const [ONE,', '  if (!gl) throw new Error("WebGL2 unavailable");\n  const [ONE,', 1)
    render = render.replace('window.renderer', 'renderer')
    start = render.index('  // ---- lazy vram -> vramShadow synchronisation ----')
    sync = render.index('  const syncTextureSource =', start)
    end = render.index('\n\n', render.index('\n  }', sync))
    render = render[:start] + '''  // Textures read the immutable native snapshot. Only a draw mask needs
  // a copy of the current color target, so skip per-primitive dirty tracking.
  const syncTextureSource = () => {};
  const touchArea = () => {};
  const commitPacketArea = () => {};
  const syncRegion = (x, y, w, h) => {
    const x0 = scale * x, y0 = scale * y;
    const x1 = scale * (x + w), y1 = scale * (y + h);
    gl_blitFramebuffer(x0, y0, x1, y1, x0, y0, x1, y1, COLOR_BUFFER_BIT, NEAREST);
  };
''' + render[end:]
    render = render.replace('    gl_bindFramebuffer(DRAW_FRAMEBUFFER, fb_vramShadow);\n'
                            '    gl.clearBufferfv(gl.COLOR, 0, fillColor);\n', '')
    render = render.replace('showDisplay(this, (gpu.status >> 21) & 0b101, area);', 'showDisplay(this, 0, area);')
    render = render.replace('    gl.clear(gl.DEPTH_BUFFER_BIT);', '''    if (area) {
      gl_enable(gl.SCISSOR_TEST);
      gl.scissor(0, scale * area.y, scale * area.w, scale * area.h);
    }
    gl.clear(gl.DEPTH_BUFFER_BIT);
    if (area) gl_disable(gl.SCISSOR_TEST);''', 1)
    render = render.replace('gl_bindTexture(TEXTURE_2D, vramShadow);\n      gl.drawArrays(gl.TRIANGLES, 0, vertexBuffer.size());',
                            'gl_bindTexture(TEXTURE_2D, upload);\n      gl.drawArrays(gl.TRIANGLES, 0, vertexBuffer.size());')

    adapter = (ROOT / 'research/emulator/sled-enge-adapter.js').read_text()
    adapter = adapter.replace('  // INSERT_RENDERER', utils + '\n' + render)
    adapter = adapter.replace('  // INSERT_POLYGON_HELPERS',
                              gpu[gpu.index('  const flippedQuad'):gpu.index('  // 0x00-0x1f')])
    adapter = adapter.replace('    // INSERT_DRAW_COMMANDS', gpu[gpu.index('    // Monochrome 3 point polygon'):
                                                            gpu.index('    // Move image in framebuffer')])
    output = ROOT / 'web/generated/enge-hardware.js'
    output.parent.mkdir(exist_ok=True)
    output.write_text(f'/* eNGE {COMMIT}\n\n{license_text}*/\n{shaders}\n{adapter}')
    print(f'Prepared WebGL2 preview at {output.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
