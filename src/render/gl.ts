/* A small WebGL quad renderer for the scene and the ghosts: textured rectangles with an opacity and one of the
   three blends the scene uses. Canvas 2D does the same job, but blending a dozen screen-sized layers (two of them
   in screen mode) through it runs at a third of the frame rate on a laptop GPU. Everything is premultiplied.
   A second program draws you from the camera: the picture through the person mask, mirrored, graded into the night. */

export type Blend = 'normal' | 'screen' | 'lighter';

export interface Tex {
  t: WebGLTexture;
  /** pixel size of the texture as uploaded */
  w: number; h: number;
}

const VS = `
attribute vec2 a;
uniform vec4 rect;   // x, y, w, h in device pixels
uniform vec4 uvr;    // u0, v0, u1, v1
uniform vec2 view;   // canvas size in device pixels
varying vec2 uv;
void main() {
  vec2 p = rect.xy + a * rect.zw;
  uv = mix(uvr.xy, uvr.zw, a);
  gl_Position = vec4(p / view * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}`;

const FS = `
precision mediump float;
uniform sampler2D tex;
uniform float alpha;
varying vec2 uv;
void main() { gl_FragColor = texture2D(tex, uv) * alpha; }`;

/** you, cut out: mirrored like a mirror, the mask feathered, the bottom faded into the fog, and moonlit (a little
    desaturated, cooled and lifted toward the mist) so you sit in the scene rather than on it */
const CUT = `
precision mediump float;
uniform sampler2D tex;
uniform sampler2D mask;
uniform float alpha;
uniform float fade;
uniform vec4 mrect;  // the picture's part of the whole camera frame (x, y, w, h), which the mask covers
varying vec2 uv;
void main() {
  vec2 m = vec2(1.0 - uv.x, uv.y);
  vec2 f = mrect.xy + m * mrect.zw;
  vec3 c = texture2D(tex, m).rgb;
  float a = smoothstep(.3, .7, texture2D(mask, f).r) * (1.0 - smoothstep(1.0 - fade, 1.0, f.y));
  float l = dot(c, vec3(.299, .587, .114));
  c = mix(vec3(l), c, .72) * vec3(.84, .87, 1.06);
  c = mix(c, vec3(.42, .40, .86), .1);
  gl_FragColor = vec4(c * a, a) * alpha;
}`;

type Uniform = 'rect' | 'uvr' | 'view' | 'alpha' | 'tex' | 'mask' | 'fade' | 'mrect';
interface Prog { p: WebGLProgram; u: Partial<Record<Uniform, WebGLUniformLocation>> }

export class Gl {
  readonly gl: WebGLRenderingContext;
  private flat: Prog;
  private cut: Prog;
  private cur: Prog | null = null;
  private webgl2: boolean;
  private blend: Blend | null = null;
  w = 1; h = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    const opts: WebGLContextAttributes = { alpha: false, antialias: false, premultipliedAlpha: true, depth: false, stencil: false };
    const gl2 = canvas.getContext('webgl2', opts);
    const gl = gl2 ?? canvas.getContext('webgl', opts);
    if (!gl) throw new Error('This browser has WebGL turned off');
    this.gl = gl;
    this.webgl2 = !!gl2;

    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const vs = shader(gl.VERTEX_SHADER, VS);
    const program = (fs: string): Prog => {
      const p = gl.createProgram()!;
      gl.attachShader(p, vs);
      gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
      // both share the one quad buffer at attribute 0
      gl.bindAttribLocation(p, 0, 'a');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program');
      const u: Prog['u'] = {};
      for (const n of ['rect', 'uvr', 'view', 'alpha', 'tex', 'mask', 'fade', 'mrect'] as Uniform[]) {
        const l = gl.getUniformLocation(p, n);
        if (l) u[n] = l;
      }
      return { p, u };
    };
    this.flat = program(FS);
    this.cut = program(CUT);
    this.use(this.cut);
    gl.uniform1i(this.cut.u.tex!, 0);
    gl.uniform1i(this.cut.u.mask!, 1);
    this.use(this.flat);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  }

  private use(p: Prog) {
    if (this.cur !== p) { this.gl.useProgram(p.p); this.cur = p; }
  }

  /** match the drawing buffer to the canvas's CSS size at this pixel ratio */
  resize(cssW: number, cssH: number, dpr: number) {
    const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.w = w; this.h = h;
    this.gl.viewport(0, 0, w, h);
    for (const p of [this.cut, this.flat]) { this.use(p); this.gl.uniform2f(p.u.view!, w, h); }
  }

  /** upload an image once; mipmapped (where WebGL allows) so big layers stay smooth on small screens */
  texture(src: TexImageSource & { width: number; height: number }, mip = true): Tex {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const pot = (n: number) => (n & (n - 1)) === 0;
    const canMip = mip && (this.webgl2 || (pot(src.width) && pot(src.height)));
    if (canMip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, canMip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { t, w: src.width, h: src.height };
  }

  /** re-upload a canvas or camera frame that changes every frame (a ghost's sprite, you) */
  update(tex: Tex | null, src: HTMLCanvasElement | ImageBitmap): Tex {
    const gl = this.gl;
    if (!tex) {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      tex = { t, w: 0, h: 0 };
    }
    gl.bindTexture(gl.TEXTURE_2D, tex.t);
    // same size as last frame: write into the storage it has rather than allocating new
    if (tex.w === src.width && tex.h === src.height) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    tex.w = src.width; tex.h = src.height;
    return tex;
  }

  free(tex: Tex) { this.gl.deleteTexture(tex.t); }

  clear(r: number, g: number, b: number) {
    const gl = this.gl;
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * Draw `tex` into the rectangle (x, y, w, h) in device pixels. `sub` picks a part of the texture in its pixels
   * (for a sprite canvas bigger than this frame's sprite).
   */
  draw(tex: Tex, x: number, y: number, w: number, h: number, alpha = 1, blend: Blend = 'normal', sub?: [number, number, number, number]) {
    if (alpha <= .002) return;
    const gl = this.gl, u = this.flat.u;
    this.use(this.flat);
    this.setBlend(blend);
    gl.bindTexture(gl.TEXTURE_2D, tex.t);
    gl.uniform4f(u.rect!, x, y, w, h);
    if (sub) gl.uniform4f(u.uvr!, sub[0] / tex.w, sub[1] / tex.h, (sub[0] + sub[2]) / tex.w, (sub[1] + sub[3]) / tex.h);
    else gl.uniform4f(u.uvr!, 0, 0, 1, 1);
    gl.uniform1f(u.alpha!, alpha);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** you from the camera: `img` through `mask` (a one-channel texture from `maskTexture`, over the whole frame),
      mirrored, into the rectangle in device pixels. `img` is the part `part` (x, y, w, h, fractions) of the frame; the
      bottom `fade` of the frame dissolves */
  drawCutout(img: Tex, mask: Tex, x: number, y: number, w: number, h: number, alpha: number, fade: number, part = [0, 0, 1, 1]) {
    if (alpha <= .002) return;
    const gl = this.gl, u = this.cut.u;
    this.use(this.cut);
    this.setBlend('normal');
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, mask.t);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, img.t);
    gl.uniform4f(u.rect!, x, y, w, h);
    gl.uniform4f(u.uvr!, 0, 0, 1, 1);
    gl.uniform1f(u.alpha!, alpha);
    gl.uniform1f(u.fade!, fade);
    gl.uniform4f(u.mrect!, part[0], part[1], part[2], part[3]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** a one-channel mask (0..255 per pixel) as a texture, reusing `tex` */
  maskTexture(tex: Tex | null, data: Uint8Array, w: number, h: number): Tex {
    const gl = this.gl;
    if (!tex) {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      tex = { t, w: 0, h: 0 };
    }
    gl.bindTexture(gl.TEXTURE_2D, tex.t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (tex.w === w && tex.h === h) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    tex.w = w; tex.h = h;
    return tex;
  }

  private setBlend(blend: Blend) {
    if (blend === this.blend) return;
    const gl = this.gl;
    this.blend = blend;
    if (blend === 'normal') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else if (blend === 'screen') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    else gl.blendFunc(gl.ONE, gl.ONE);
  }
}

type Source = TexImageSource & { width: number; height: number };

/**
 * The top layer (symbols, effects, your stroke) drawn into the same WebGL canvas in CSS pixels. A second canvas
 * over the scene would cost the browser a full-screen composite every frame it has anything on it.
 * Images get a texture the first time they're drawn; canvases that change pass `fresh` to be uploaded again.
 */
export class Painter {
  dpr = 1;
  private cache = new Map<Source, Tex>();

  constructor(private gl: Gl) {}

  image(src: Source, x: number, y: number, w: number, h: number, alpha = 1, o: { fresh?: boolean; blend?: Blend; sub?: [number, number, number, number] } = {}) {
    if (alpha <= .002) return;
    let tex = this.cache.get(src);
    if (!tex) { tex = o.fresh ? this.gl.update(null, src as HTMLCanvasElement) : this.gl.texture(src); this.cache.set(src, tex); }
    else if (o.fresh) this.gl.update(tex, src as HTMLCanvasElement);
    const d = this.dpr;
    this.gl.draw(tex, x * d, y * d, w * d, h * d, alpha, o.blend ?? 'normal', o.sub);
  }

  /** let go of a canvas that won't be drawn again */
  forget(src: Source) {
    const tex = this.cache.get(src);
    if (tex) { this.gl.free(tex); this.cache.delete(src); }
  }
}
