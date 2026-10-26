// The graphics-card side of effects (WebGL 2): one hidden canvas shared by every layer.
// A picture is uploaded once, then goes through its effects one "pass" at a time,
// bouncing between working images on the card, and the result is drawn onto the hidden
// canvas for js/effects/chain.js to keep.
//
// Inside every pass (see PRELUDE): texelFetch(picture, pixel(), 0) reads this pixel of the
// picture so far (row 0 is the picture's top row), or texture(picture, here()) reads it
// blended smoothly (for passes at another size, e.g. a smaller copy for a blur). `size` is
// the size of the image the pass is drawing, in pixels, `seed` this effect's own random seed,
// and random(cell, salt) a repeatable random number.
// Working images keep extra colour detail (half-float) where the graphics card can draw into
// it, so soft glows fade smoothly; otherwise the usual 8 bits per colour.
//
// If the browser can't use the graphics card (or it drops out), available() is false and
// the pictures are drawn without their effects; listeners hear when that changes.

// Pictures bigger than this on their long side are scaled down first (still bigger than a
// 4K export)
export const MAX_SIDE = 4096;

const VERTEX = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

// Put in front of every effect's recipe
const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 colour;
uniform vec2 size;   // the size of the image this pass draws, in pixels
uniform uint seed;   // this effect's seed (the layer's seed mixed with the effect's id)

// This pixel, counted from the picture's top-left (working images keep the top row first)
ivec2 pixel() { return ivec2(gl_FragCoord.xy); }

// Where this pixel is, from 0 to 1 across the image (for texture(): any image size)
vec2 here() { return gl_FragCoord.xy / size; }

// A whole-number hash (PCG): the same answer on every graphics card
uint hash(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

// A repeatable random number from -1 to 1 for a grid cell (salt: a different set of numbers)
float random(ivec2 cell, uint salt) {
  uint h = hash(uint(cell.x) ^ hash(uint(cell.y) ^ hash(seed ^ hash(salt))));
  return float(h) / 4294967295.0 * 2.0 - 1.0;
}

// How bright a colour looks (0 black - 1 white)
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// The picture at uv (0 - 1), blended smoothly between pixels, with see-through pixels (around
// lettering) weighted less, so edges don't go dark. Off the edge: the nearest edge pixel.
vec4 sampleAt(sampler2D t, vec2 uv) {
  ivec2 n = textureSize(t, 0);
  vec2 q = uv * vec2(n) - 0.5;
  ivec2 i = ivec2(floor(q));
  vec2 f = q - floor(q);
  vec4 s[4];
  ivec2 o[4] = ivec2[4](ivec2(0, 0), ivec2(1, 0), ivec2(0, 1), ivec2(1, 1));
  for (int k = 0; k < 4; k++) {
    ivec2 at = i + o[k];
    vec4 c = texelFetch(t, clamp(at, ivec2(0), n - 1), 0);
    s[k] = vec4(c.rgb * c.a, c.a);
  }
  vec4 c = mix(mix(s[0], s[1], f.x), mix(s[2], s[3], f.x), f.y);
  return c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0);
}

// Where this pixel is, in short sides from the picture's top-left (the same at any size)
vec2 place() { return (vec2(pixel()) + 0.5) / min(size.x, size.y); }

// Smooth random noise from 0 to 1 (one bump per unit of p); fbm: layered, cloudier
float noise(vec2 p, uint salt) {
  vec2 c = floor(p), f = p - c;
  f = f * f * (3.0 - 2.0 * f);
  ivec2 i = ivec2(c) + ivec2(4096);
  float a = random(i, salt), b = random(i + ivec2(1, 0), salt);
  float d = random(i + ivec2(0, 1), salt), e = random(i + ivec2(1, 1), salt);
  return 0.5 + 0.5 * mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}
float fbm(vec2 p, uint salt) {
  float sum = 0.0, weight = 0.5;
  for (int i = 0; i < 5; i++) { sum += weight * noise(p, salt + uint(i) * 17u); p *= 2.03; weight *= 0.5; }
  return sum / 0.96875;
}
`;

// The last step: copy the result onto the hidden canvas, whose rows run bottom-up
const PRESENT = `
uniform sampler2D picture;
void main() { colour = texelFetch(picture, ivec2(int(gl_FragCoord.x), int(size.y) - 1 - int(gl_FragCoord.y)), 0); }`;

let canvas = null;
let gl = null;
let lost = false;
let corners = null;                 // the two triangles covering the picture
const programs = new Map();         // recipe text -> compiled program
const pictures = new Map();         // picture key -> uploaded picture
const MAX_PICTURES = 4;
let spares = [];                    // working images, reused between passes
let detailed = false;               // working images keep extra colour detail (half-float)
let flatCanvas = null;              // where a picture is drawn before it goes to the graphics card
const listeners = new Set();

// Whether effects can be drawn right now
export function available() {
  return !!start() && !lost;
}

// Hear when effects become available or unavailable (the graphics card dropped out / came back)
export function onAvailabilityChange(listener) {
  listeners.add(listener);
}

// The hidden canvas (the tests use it to make the graphics card drop out)
export function engineCanvas() {
  start();
  return canvas;
}

function start() {
  if (canvas) return gl;
  canvas = document.createElement("canvas");
  gl = canvas.getContext("webgl2", {
    alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false,
    preserveDrawingBuffer: true
  });
  if (!gl) {
    console.warn("Effects: this browser can't use the graphics card (WebGL 2), so pictures are drawn without effects.");
    return null;
  }
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault(); // so it can come back
    lost = true;
    forgetEverything();
    listeners.forEach((listener) => listener(false));
  });
  canvas.addEventListener("webglcontextrestored", () => {
    lost = false;
    prepare();
    listeners.forEach((listener) => listener(true));
  });
  prepare();
  return gl;
}

function prepare() {
  corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  detailed = !!gl.getExtension("EXT_color_buffer_float");
}

function forgetEverything() {
  programs.clear();
  pictures.clear();
  ownTextures.clear();
  spares = [];
  corners = null;
}

// Pictures worked out every frame (a video, a camera, or a moving look) are kept a little
// smaller, so playback stays smooth (still bigger than a 1440p export)
export const MAX_SIDE_EVERY_FRAME = 2560;

// The size a picture is worked on at (scaled down if it's bigger than maxSide)
export function workingSize(width, height, maxSide = MAX_SIDE) {
  const limit = Math.min(maxSide, gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : maxSide);
  const scale = Math.min(1, limit / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Run a chain of effects on a picture and leave the result on the hidden canvas.
// key: names the picture (it's uploaded once); source: an image / bitmap / canvas / video frame.
// steps: [{ effect, settings, seed }], in order. Returns the hidden canvas, or null.
// options.fresh: the picture under this key has changed (a video / camera frame): upload it
// again; options.time: the moment of the song (for moving looks); options.maxSide: size limit.
// Returns null too when no effect changed anything (e.g. all at 0): draw the original then.
export function runChain(key, source, sourceWidth, sourceHeight, steps, options = {}) {
  if (!available()) return null;
  const { fresh = false, time = 0, maxSide = MAX_SIDE, span = null } = options;
  const { width, height } = workingSize(sourceWidth, sourceHeight, maxSide);
  const input = uploadPicture(key, source, width, height, fresh);
  const inUse = new Set();
  let current = input;
  for (const step of steps) {
    const made = [];
    const run = {
      input: current,
      width,
      height,
      seed: step.seed,          // this effect's seed (for choices made in JavaScript, e.g. a random path)
      time,                     // the moment of the song, in seconds (for moving looks)
      span,                     // { from, to }: when the layer is on screen (song seconds), or null
      // A picture an effect makes for itself (e.g. ASCII's sheet of characters): make() returns a
      // canvas, uploaded once per key and kept (a few)
      texture: (key, make) => textureFor(key, make),
      // One pass: draw `recipe` into a new working image and return it.
      // textures: { name in the recipe: working image }, uniforms: { name: number or [numbers] },
      // at: { width, height } to draw a smaller (or bigger) image than the picture
      pass: (recipe, textures, uniforms = {}, at = null) => {
        const w = Math.max(1, Math.round(at ? at.width : width));
        const h = Math.max(1, Math.round(at ? at.height : height));
        const target = spare(w, h, inUse);
        drawPass(recipe, textures, uniforms, step.seed, w, h, target.framebuffer);
        made.push(target);
        return target;
      }
    };
    const result = step.effect.apply(step.settings, run);
    // Working images this step made but didn't hand on can be reused
    made.forEach((image) => { if (image !== result) inUse.delete(image); });
    if (current !== input && current !== result) inUse.delete(current);
    current = result;
  }
  if (current === input) { usedSizes.clear(); return null; }
  canvas.width = width;
  canvas.height = height;
  drawPass(PRESENT, { picture: current }, {}, 0, width, height, null);
  // Working images of sizes this chain didn't use (e.g. from an earlier picture) are let go
  spares = spares.filter((image) => {
    if (inUse.has(image) || usedSizes.has(`${image.width}x${image.height}`)) return true;
    gl.deleteFramebuffer(image.framebuffer);
    gl.deleteTexture(image.texture);
    return false;
  });
  usedSizes.clear();
  return canvas;
}
const usedSizes = new Set();

// A working image not in use (made if needed)
function spare(width, height, inUse) {
  let image = spares.find((s) => s.width === width && s.height === height && !inUse.has(s));
  if (!image) {
    image = makeImage(width, height, detailed ? gl.RGBA16F : gl.RGBA8);
    image.framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, image.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image.texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    spares.push(image);
  }
  usedSizes.add(`${width}x${height}`);
  inUse.add(image);
  return image;
}

function makeImage(width, height, format = gl.RGBA8) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
  return { texture, width, height };
}

// The picture on the graphics card, uploaded once per key and size. It's drawn onto a plain
// canvas first, so every kind of source arrives the same way (straight colours, top row first).
function uploadPicture(key, source, width, height, fresh = false) {
  const id = `${key}@${width}x${height}`;
  if (pictures.has(id) && !fresh) {
    const picture = pictures.get(id);
    pictures.delete(id); // most recently used goes last
    pictures.set(id, picture);
    return picture;
  }
  if (!flatCanvas) flatCanvas = document.createElement("canvas");
  const flat = flatCanvas;
  flat.width = width;
  flat.height = height;
  const flatCtx = flat.getContext("2d");
  flatCtx.imageSmoothingQuality = "high";
  flatCtx.drawImage(source, 0, 0, width, height);
  // A changed frame goes into the texture it had before (no new texture every frame)
  const picture = pictures.get(id) || makeImage(width, height);
  pictures.delete(id);
  gl.bindTexture(gl.TEXTURE_2D, picture.texture);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, flat);
  pictures.set(id, picture);
  while (pictures.size > MAX_PICTURES) {
    const [oldest, old] = pictures.entries().next().value;
    gl.deleteTexture(old.texture);
    pictures.delete(oldest);
  }
  return picture;
}

// Effects' own pictures (run.texture), by key, most recently used last
const ownTextures = new Map();
const MAX_OWN_TEXTURES = 8;
function textureFor(key, make) {
  if (ownTextures.has(key)) {
    const kept = ownTextures.get(key);
    ownTextures.delete(key);
    ownTextures.set(key, kept);
    return kept;
  }
  const source = make();
  const image = makeImage(Math.max(1, source.width), Math.max(1, source.height));
  gl.bindTexture(gl.TEXTURE_2D, image.texture);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
  ownTextures.set(key, image);
  while (ownTextures.size > MAX_OWN_TEXTURES) {
    const [oldest, old] = ownTextures.entries().next().value;
    gl.deleteTexture(old.texture);
    ownTextures.delete(oldest);
  }
  return image;
}

function drawPass(recipe, textures, uniforms, seed, width, height, framebuffer) {
  const program = programFor(recipe);
  gl.useProgram(program);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.viewport(0, 0, width, height);
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  const corner = gl.getAttribLocation(program, "corner");
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

  const at = (name) => gl.getUniformLocation(program, name);
  if (at("size")) gl.uniform2f(at("size"), width, height);
  if (at("seed")) gl.uniform1ui(at("seed"), seed >>> 0);
  Object.entries(textures).forEach(([name, image], unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, image.texture);
    if (at(name)) gl.uniform1i(at(name), unit);
  });
  Object.entries(uniforms).forEach(([name, value]) => {
    const location = at(name);
    if (!location) return;
    const values = Array.isArray(value) ? value : [value];
    gl[`uniform${values.length}fv`](location, values);
  });
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function programFor(recipe) {
  if (programs.has(recipe)) return programs.get(recipe);
  const compile = (type, text) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error("Effect recipe didn't compile: " + gl.getShaderInfoLog(shader));
    }
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, PRELUDE + recipe));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error("Effect recipe didn't link: " + gl.getProgramInfoLog(program));
  }
  programs.set(recipe, program);
  return program;
}
