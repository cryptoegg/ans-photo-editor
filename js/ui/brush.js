// The retouch brushes (Tom, 2026-11-18), picked in the Editor's Tools fold and painted on the canvas over the picked
// photo. Three cover what Photoshop's healing tools do:
// - Remove: paint over anything to take it away (a pimple, a crumb, a word). On letting go the part is rebuilt from
//   the photo around it (Content-Aware: js/fill-worker.js). Replaces Spot heal, Patch and the Remove tool.
// - Clone: Alt-click where to copy from, then paint (the source follows the brush: Aligned). Blend on (the colour
//   blends into what's around it, like the Healing Brush) or off (an exact copy, like the Clone Stamp).
// - Edge brush: tidies a cut-out (js/cutout.js): Erase takes more away, Restore brings the photo back (the whole
//   photo shows faintly meanwhile).
// None of them changes the photo: the cut-out is a mask, and Remove / Clone strokes are small pictures of just the part
// each changed, laid over the photo before its look (item.retouch.tiles, `touchedUp` in looks.js). Each stroke is one
// undo step and is kept in the media store.
// Settings, as in Photoshop: Size and Hardness (this browser's, localStorage), changed in the Tools fold, by
// right-clicking the photo (a small panel at the pointer), with [ ] (size) and Shift+[ ] (hardness), or by holding
// Control + Option and dragging on the photo (left / right size, up / down hardness). Esc puts the brush down.
import { state, changed, commit, currentItem, currentLayer } from '../state.js';
import { getPicture, loadPicture, putPicture } from '../media.js';
import { dbPut } from '../store.js';
import { newId } from '../project.js';
import { photoBox, turn, layerFrame } from '../render.js';

const PREFS_KEY = "ans_photo_brush";
export const brush = { size: 40, hardness: 50, edge: "erase", blend: true, mask: "paint" };
try {
  const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
  if (saved.softness !== undefined && saved.hardness === undefined) saved.hardness = 100 - saved.softness; // (it was Softness)
  delete saved.softness;
  Object.assign(brush, saved);
} catch (e) { /* defaults */ }
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(brush)); } catch (e) {} };
export function setBrush(key, value) { brush[key] = value; savePrefs(); changed("view"); }

// Size on its slider (Tom, 2026-11-18: it jumped from tiny to huge): a gradual scale, each step the same share bigger,
// 4 to 500 px over 0 to 1000
export const SIZE_MIN = 4, SIZE_MAX = 500;
export const sizeToSlider = (size) => Math.round((Math.log(Math.max(SIZE_MIN, size) / SIZE_MIN) / Math.log(SIZE_MAX / SIZE_MIN)) * 1000);
export const sliderToSize = (v) => Math.round(SIZE_MIN * Math.pow(SIZE_MAX / SIZE_MIN, v / 1000));

// What a brush is doing, for the Editor (Remove: "Removing…" while it works)
export const brushStatus = { busy: false, progress: null, hint: "" };

let pointer = null;   // where the pointer is over the canvas (frame pixels), for the brush's circle
let stroke = null;    // the stroke being painted (or the brush being sized)
const clone = { layer: null, src: null, offset: null }; // Clone's source: a point on the photo, then the offset kept while painting

const TOOLS = ["remove", "clone", "erase", "edge", "mask"]; // (mask: painting a Brush mask, js/masks.js; not among the icons)
export function brushReady() {
  if (state.tool === "heal") state.tool = "remove"; // (it was Spot heal)
  if (!TOOLS.includes(state.tool)) return null;
  const item = currentItem(), layer = currentLayer();
  if (!item || !layer || !state.photoPicked || (item.kind === "video" && layer === item)) return null;
  if (state.tool === "edge" && !(layer.cutout && layer.cutout.on && layer.cutout.maskId)) return null;
  if (state.tool === "mask" && !((layer.masks || []).some((m) => m.id === state.maskId && m.kind === "brush"))) return null;
  const pic = getPicture(layer.mediaId);
  return pic ? { item, layer, pic } : null;
}

export function pickTool(tool) { setTool(state.tool === tool ? null : tool); }
// A brush in hand, or none (Move: the usual pointer, picking and moving things)
export function setTool(tool) {
  state.tool = tool || null;
  if (state.tool) state.photoPicked = true;
  closePanel();
  changed("view");
}

// The tools as icons (Tom, 2026-11-18), the same in the canvas bar, the Tools fold and the right-click panel; their
// names in the hover boxes (js/ui/tips.js). The Edge brush only with a cut-out.
export const TOOLS_LIST = [
  ["", "Move: pick and move things (Esc)"],
  ["remove", "Remove: paint over anything to take it away"],
  ["clone", "Clone: Alt-click where to copy from, then paint"],
  ["erase", "Eraser: wipe part of the photo away"],
  ["edge", "Edge brush: tidy a cut-out's edge"],
];
// The tool buttons (each class `cls`), kept up to date in `into` when given (rebuilt only the first time, so a hover
// box stays put); a click picks the tool, then `after(tool)`
export function toolIcons(cls, into = null, after = null) {
  const box = into || document.createElement("div");
  if (box.children.length !== TOOLS_LIST.length) {
    box.replaceChildren(...TOOLS_LIST.map(([tool, tip]) => {
      const b = Object.assign(document.createElement("button"), { type: "button", className: cls });
      b.dataset.tool = tool;
      b.setAttribute("aria-label", tip.split(":")[0]);
      b.onclick = () => { setTool(tool); if (after) after(tool); };
      return b;
    }));
  }
  [...box.children].forEach((b, i) => {
    const [tool, tip] = TOOLS_LIST[i], ok = toolAllowed(tool);
    b.classList.toggle("on", (state.tool || "") === tool);
    b.disabled = !ok;
    let text = tool === "edge" && !ok ? "Edge brush: remove the background first" : tip;
    if (tool === "remove" && brushStatus.progress != null) text = `Downloading the AI fill ${Math.round(brushStatus.progress * 100)}%`;
    else if (tool === "remove" && brushStatus.busy) text = "Removing…";
    if (b.dataset.tip !== text) b.title = text;
    b.classList.toggle("busy", tool === "remove" && (brushStatus.busy || brushStatus.progress != null));
  });
  return box;
}
export function toolAllowed(tool) {
  if (!tool) return true;
  const item = currentItem(), layer = currentLayer();
  if (!item || !layer || (item.kind === "video" && layer === item) || !getPicture(layer.mediaId)) return false;
  return tool !== "edge" || !!(layer.cutout && layer.cutout.on && layer.cutout.maskId);
}

document.addEventListener("keydown", (e) => {
  if (!state.tool || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "")) return;
  if (e.key === "Escape") { if (panel) closePanel(); else { state.tool = null; changed("view"); } return; }
  const smaller = e.key === "[" || e.key === "{", bigger = e.key === "]" || e.key === "}";
  if (!smaller && !bigger) return;
  e.preventDefault();
  if (e.shiftKey) setBrush("hardness", Math.max(0, Math.min(100, brush.hardness + (bigger ? 25 : -25))));
  else setBrush("size", Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(brush.size * (bigger ? 1.2 : 1 / 1.2)))));
});

// ---- Where things are: the frame (screen) and the photo's own pixels (also for the masks' handles, js/ui/masks.js)

export function placement(ready, f) {
  const { item, layer, pic } = ready;
  const rect = layerFrame(item, layer, f.w, f.h);
  return { rect, box: photoBox(layer.crop, pic.width, pic.height, rect.w, rect.h) };
}
export function toPhoto(ready, f, p) {
  const { layer, pic } = ready, { rect, box } = placement(ready, f);
  let [x, y] = turn(p.x - rect.x - box.cx, p.y - rect.y - box.cy, -box.rotation);
  if (layer.crop.flipH) x = -x;
  if (layer.crop.flipV) y = -y;
  return { x: (x / box.w + 0.5) * pic.width, y: (y / box.h + 0.5) * pic.height, r: (brush.size / 2) * (pic.width / box.w) };
}
export function toFrame(ready, f, q) {
  const { layer, pic } = ready, { rect, box } = placement(ready, f);
  let x = (q.x / pic.width - 0.5) * box.w, y = (q.y / pic.height - 0.5) * box.h;
  if (layer.crop.flipH) x = -x;
  if (layer.crop.flipV) y = -y;
  const [u, v] = turn(x, y, box.rotation);
  return { x: u + rect.x + box.cx, y: v + rect.y + box.cy };
}

// A round dab: solid to `hardness`, fading to nothing at its edge
function dabShape(ctx, x, y, r, colour = "rgba(255,255,255,1)") {
  const inner = Math.max(0, Math.min(0.99, brush.hardness / 100));
  const g = ctx.createRadialGradient(x, y, r * inner, x, y, r);
  g.addColorStop(0, colour);
  g.addColorStop(1, colour.replace(/[\d.]+\)$/, "0)"));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
// Dabs from one point to the next, a quarter of the brush apart
function along(from, to, r, fn) {
  const d = Math.hypot(to.x - from.x, to.y - from.y), step = Math.max(1, r * 0.25), n = Math.max(1, Math.ceil(d / step));
  for (let i = 1; i <= n; i++) fn(from.x + ((to.x - from.x) * i) / n, from.y + ((to.y - from.y) * i) / n);
}
// (pen pressure, when there's a pen: lighter = a smaller brush)
const pressured = (e, r) => (e.pointerType === "pen" && e.pressure > 0 ? r * (0.25 + 0.75 * e.pressure) : r);

// The photo as it is now (with its earlier touch-ups) over a part of it: a canvas w x h of the photo's (x, y, w, h)
function photoNow(layer, pic, x, y, w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(pic.full, -x, -y);
  const r = layer.retouch;
  if (r && r.patchId && getPicture(r.patchId)) ctx.drawImage(getPicture(r.patchId).full, -x, -y, pic.width, pic.height);
  ((r && r.tiles) || []).forEach((t) => { const tp = getPicture(t.id); if (tp && t.x < x + w && t.y < y + h && t.x + t.w > x && t.y + t.h > y) ctx.drawImage(tp.full, t.x - x, t.y - y, t.w, t.h); });
  return c;
}

// A finished stroke kept: a small picture of the part it changed, added to the photo's touch-ups (one undo step)
async function keepTile(layer, canvas, x, y) {
  const id = newId("m");
  putPicture(id, { full: canvas, preview: canvas, width: canvas.width, height: canvas.height, name: "Touch-up.png", rev: 0 });
  const r = layer.retouch && !layer.retouch.patchId ? layer.retouch : { ...(layer.retouch || {}) };
  layer.retouch = { ...r, tiles: [...((r && r.tiles) || []), { id, x, y, w: canvas.width, h: canvas.height }] };
  changed("project");
  commit();
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  await dbPut("media", { id, projectId: state.project.id, kind: "touch-up", name: "Touch-up.png", type: "image/png", blob, width: canvas.width, height: canvas.height, added: Date.now() });
}

// ---- The pointer (js/ui/stage.js passes these on while a brush is in hand: true = handled)

export function brushDown(e, f, p) {
  const ready = brushReady();
  if (!ready || e.button !== 0) return false;
  closePanel();
  pointer = p;
  if (e.ctrlKey && !e.altKey) return true; // (Control-click on a Mac is a right-click: the panel opens instead)
  // Control + Option drag: size the brush (left / right) and its hardness (up / down), as in Photoshop
  if (e.ctrlKey && e.altKey) { stroke = { tool: "size", start: p, size: brush.size, hardness: brush.hardness }; return true; }
  const at = toPhoto(ready, f, p);
  at.r = pressured(e, at.r);
  if (state.tool === "clone" && e.altKey) {
    Object.assign(clone, { layer: ready.layer.id, src: { x: at.x, y: at.y }, offset: null });
    changed("view");
    return true;
  }
  if (state.tool === "mask") {
    // A Brush mask (js/masks.js): painted on a copy of its picture (so undo points back), white = the fix
    const m = ready.layer.masks.find((x) => x.id === state.maskId);
    const was = m.maskId && getPicture(m.maskId);
    if (m.maskId && !was) { loadPicture(m.maskId).then(() => changed("view")); return true; }
    const canvas = document.createElement("canvas");
    const k = Math.min(1, 2048 / Math.max(ready.pic.width, ready.pic.height));
    canvas.width = was ? was.full.width : Math.round(ready.pic.width * k);
    canvas.height = was ? was.full.height : Math.round(ready.pic.height * k);
    if (was) canvas.getContext("2d").drawImage(was.full, 0, 0);
    const id = newId("m");
    const picture = { full: canvas, preview: canvas, width: ready.pic.width, height: ready.pic.height, name: "Mask.png", rev: 0 };
    putPicture(id, picture);
    m.maskId = id;
    stroke = { tool: "edge", mode: brush.mask === "erase" ? "erase" : "restore", ready, f, last: at, canvas, picture, id, sx: canvas.width / ready.pic.width };
    edgeDab(at);
  } else if (state.tool === "edge" || state.tool === "erase") {
    // Both paint on the photo's mask (a copy, so undo points back): the Edge brush on its cut-out, the Eraser on its
    // cut-out if it has one switched on, else on a new mask that keeps the whole photo (`hand`: made by hand, so
    // Remove background still runs the model, js/cutout.js)
    const c = ready.layer.cutout, onMask = c && c.on && c.maskId;
    const canvas = document.createElement("canvas");
    let width = ready.pic.width, height = ready.pic.height, name = "Erased.png";
    if (onMask) {
      const mask = getPicture(c.maskId);
      if (!mask) { loadPicture(c.maskId).then(() => changed("view")); return true; }
      canvas.width = mask.full.width; canvas.height = mask.full.height;
      canvas.getContext("2d").drawImage(mask.full, 0, 0);
      ({ width, height } = mask);
      name = mask.name || "Cut-out.png";
    } else {
      const k = Math.min(1, 2048 / Math.max(width, height));
      canvas.width = Math.round(width * k); canvas.height = Math.round(height * k);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const id = newId("m");
    const picture = { full: canvas, preview: canvas, width, height, name, rev: 0 };
    putPicture(id, picture);
    ready.layer.cutout = { maskId: id, on: true, ...(onMask ? (c.hand ? { hand: true } : {}) : { hand: true }) };
    const mode = state.tool === "erase" ? "erase" : brush.edge;
    stroke = { tool: "edge", mode, ready, f, last: at, canvas, picture, id, sx: canvas.width / ready.pic.width };
    edgeDab(at);
  } else if (state.tool === "clone") {
    if (clone.layer !== ready.layer.id || !clone.src) { brushStatus.hint = "Alt-click the photo first, where to copy from"; changed("view"); return true; }
    if (!clone.offset) clone.offset = { dx: clone.src.x - at.x, dy: clone.src.y - at.y };
    // Painted straight onto a picture the photo's size while the stroke lasts (shown as it goes), then cut down to
    // the part it changed
    const { pic, layer } = ready;
    const canvas = document.createElement("canvas");
    canvas.width = pic.width; canvas.height = pic.height;
    const id = newId("m");
    const picture = { full: canvas, preview: canvas, width: pic.width, height: pic.height, name: "Touch-up.png", rev: 0 };
    putPicture(id, picture);
    const before = layer.retouch;
    layer.retouch = { ...(before || {}), tiles: [...((before && before.tiles) || []), { id, x: 0, y: 0, w: pic.width, h: pic.height }] };
    stroke = { tool: "clone", ready, f, last: at, canvas, picture, id, before, box: [at.x, at.y, at.x, at.y], dabs: [], offset: { ...clone.offset } };
    cloneDab(at);
  } else {
    stroke = { tool: "remove", ready, f, last: at, dabs: [], path: [p] };
    stroke.dabs.push(at);
  }
  brushStatus.hint = "";
  changed("look");
  return true;
}

export function brushMove(e, f, p) {
  if (!state.tool) return false;
  pointer = p;
  if (stroke && stroke.tool === "size") {
    brush.size = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(stroke.size * Math.pow(2, (p.x - stroke.start.x) / 80))));
    brush.hardness = Math.max(0, Math.min(100, Math.round(stroke.hardness - (p.y - stroke.start.y) * 0.5)));
  } else if (stroke) {
    const at = toPhoto(stroke.ready, stroke.f, p);
    at.r = pressured(e, at.r);
    along(stroke.last, at, at.r, (x, y) => {
      const d = { x, y, r: at.r };
      if (stroke.tool === "edge") edgeDab(d);
      else if (stroke.tool === "clone") cloneDab(d);
      else stroke.dabs.push(d);
    });
    if (stroke.tool === "remove") stroke.path.push(p);
    stroke.last = at;
  }
  changed("look");
  return true;
}

export async function brushUp() {
  if (!stroke) return !!state.tool;
  const s = stroke;
  stroke = null;
  if (s.tool === "size") { savePrefs(); changed("view"); return true; }
  if (s.tool === "edge") {
    const blob = await new Promise((res) => s.canvas.toBlob(res, "image/png"));
    await dbPut("media", { id: s.id, projectId: state.project.id, kind: "mask", name: s.picture.name || "Cut-out.png", type: "image/png", blob, width: s.picture.width, height: s.picture.height, added: Date.now() });
    changed("project");
    commit();
  } else if (s.tool === "clone") await finishClone(s);
  else await finishRemove(s);
  return true;
}

// (a stroke being painted: the masks' red shows only then, js/ui/masks.js)
export const brushStroking = () => !!stroke && stroke.tool !== "size";

export function brushLeave() { if (!stroke && pointer) { pointer = null; changed("look"); } }

// ---- Edge brush

function edgeDab(at) {
  const ctx = stroke.canvas.getContext("2d");
  ctx.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
  dabShape(ctx, at.x * stroke.sx, at.y * stroke.sx, at.r * stroke.sx);
  ctx.globalCompositeOperation = "source-over";
  stroke.picture.rev++;
}

// ---- Clone

function cloneDab(at) {
  const { ready, offset, canvas } = stroke;
  const r = Math.ceil(at.r), size = r * 2 + 2;
  // The source round the offset point (the photo as it was when the stroke began), shaped by the brush, laid on
  const piece = photoNow({ retouch: stroke.before }, ready.pic, Math.round(at.x + offset.dx) - r - 1, Math.round(at.y + offset.dy) - r - 1, size, size);
  const pctx = piece.getContext("2d");
  pctx.globalCompositeOperation = "destination-in";
  dabShape(pctx, r + 1 + (at.x + offset.dx - Math.round(at.x + offset.dx)), r + 1 + (at.y + offset.dy - Math.round(at.y + offset.dy)), at.r, "rgba(0,0,0,1)");
  canvas.getContext("2d").drawImage(piece, at.x - r - 1, at.y - r - 1);
  stroke.dabs.push(at);
  const b = stroke.box;
  b[0] = Math.min(b[0], at.x - at.r); b[1] = Math.min(b[1], at.y - at.r); b[2] = Math.max(b[2], at.x + at.r); b[3] = Math.max(b[3], at.y + at.r);
  stroke.picture.rev++;
}

async function finishClone(s) {
  const { layer, pic } = s.ready;
  const x0 = Math.max(0, Math.floor(s.box[0]) - 2), y0 = Math.max(0, Math.floor(s.box[1]) - 2);
  const x1 = Math.min(pic.width, Math.ceil(s.box[2]) + 2), y1 = Math.min(pic.height, Math.ceil(s.box[3]) + 2);
  layer.retouch = s.before || null; // (the stroke's photo-size picture comes off; its part goes back on as a piece)
  if (x1 - x0 < 2 || y1 - y0 < 2) { changed("project"); return; }
  const w = x1 - x0, h = y1 - y0;
  const tile = document.createElement("canvas");
  tile.width = w; tile.height = h;
  const tctx = tile.getContext("2d", { willReadFrequently: true });
  tctx.drawImage(s.canvas, -x0, -y0);
  if (brush.blend) {
    // Blend: the copied part's colour and light matched to what's round it (like the Healing Brush)
    const base = photoNow(layer, pic, x0, y0, w, h).getContext("2d").getImageData(0, 0, w, h);
    const piece = tctx.getImageData(0, 0, w, h);
    blendIn(base.data, piece.data, w, h);
    tctx.putImageData(piece, 0, 0);
  }
  await keepTile(layer, tile, x0, y0);
}

// The difference along a piece's edge (what's under it minus the piece) spread smoothly over the piece and added, so
// its colour and light carry on from its surroundings. `piece` has the brush's shape in its alpha.
function blendIn(base, piece, w, h) {
  const G = Math.max(1, Math.ceil(Math.max(w, h) / 96)), gw = Math.ceil(w / G), gh = Math.ceil(h / G);
  const a = (x, y) => piece[(Math.min(h - 1, y) * w + Math.min(w - 1, x)) * 4 + 3];
  for (let c = 0; c < 3; c++) {
    const diff = new Float32Array(gw * gh), fixed = new Uint8Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const x = Math.min(w - 1, gx * G), y = Math.min(h - 1, gy * G), i = (y * w + x) * 4;
      if (a(x, y) < 250) { fixed[gy * gw + gx] = 1; diff[gy * gw + gx] = a(x, y) > 5 ? base[i + c] - piece[i + c] : 0; }
    }
    // (the edge values only count where the piece is: fill the rest of the edge from its neighbours first)
    for (let it = 0; it < 500; it++) for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const i = gy * gw + gx;
      if (fixed[i] && a(Math.min(w - 1, gx * G), Math.min(h - 1, gy * G)) > 5) continue;
      let sum = 0, n = 0;
      if (gx > 0) { sum += diff[i - 1]; n++; } if (gx < gw - 1) { sum += diff[i + 1]; n++; }
      if (gy > 0) { sum += diff[i - gw]; n++; } if (gy < gh - 1) { sum += diff[i + gw]; n++; }
      diff[i] = n ? sum / n : 0;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1.001, x / G), fy = Math.min(gh - 1.001, y / G), ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const i = iy * gw + ix, j = Math.min(gw * gh - 1, i + gw), last = gw * gh - 1;
      const d = (diff[i] * (1 - tx) + diff[Math.min(i + 1, last)] * tx) * (1 - ty) + (diff[j] * (1 - tx) + diff[Math.min(j + 1, last)] * tx) * ty;
      const k = (y * w + x) * 4 + c;
      piece[k] = piece[k] + d;
    }
  }
}

// ---- Remove (Content-Aware)

let fillWorker = null, fillAsked = 0;
const fillWaiting = new Map();
function contentAware(rgba, w, h, hole) {
  if (!fillWorker) {
    fillWorker = new Worker(new URL("../fill-worker.js", import.meta.url), { type: "module" });
    fillWorker.onmessage = (e) => { const job = fillWaiting.get(e.data.id); if (!job) return; fillWaiting.delete(e.data.id); if (e.data.error) job.reject(new Error(e.data.error)); else job.resolve(e.data.rgba); };
  }
  const id = ++fillAsked;
  return new Promise((resolve, reject) => {
    fillWaiting.set(id, { resolve, reject });
    fillWorker.postMessage({ id, rgba, w, h, hole }, [rgba.buffer, hole.buffer]);
  });
}

const WORK = 1024; // (the most the quick fill works on across; a bigger part is worked out smaller and scaled up)
const AI_SIDE = 512; // (the AI fill's fixed size)
const BIG = 0.1;     // (a stroke more than this part of the photo across goes to the AI fill)

// The AI fill (js/lama-worker.js): downloaded the first time, its progress on the Remove button
let aiWorker = null, aiAsked = 0;
const aiWaiting = new Map();
function aiFill(rgba, mask) {
  if (!aiWorker) {
    aiWorker = new Worker(new URL("../lama-worker.js", import.meta.url), { type: "module" });
    aiWorker.onmessage = (e) => {
      if (e.data.progress !== undefined) { brushStatus.progress = e.data.progress; changed("view"); return; }
      const job = aiWaiting.get(e.data.id); if (!job) return; aiWaiting.delete(e.data.id);
      if (e.data.error) job.reject(new Error(e.data.error)); else job.resolve(e.data.rgba);
    };
    aiWorker.onerror = (e) => { aiWaiting.forEach((j) => j.reject(new Error(e.message || "The AI fill stopped"))); aiWaiting.clear(); aiWorker = null; };
  }
  const id = ++aiAsked;
  return new Promise((resolve, reject) => { aiWaiting.set(id, { resolve, reject }); aiWorker.postMessage({ id, rgba, mask }, [rgba.buffer, mask.buffer]); });
}

async function finishRemove(s) {
  const { layer, pic } = s.ready;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  s.dabs.forEach((d) => { x0 = Math.min(x0, d.x - d.r); y0 = Math.min(y0, d.y - d.r); x1 = Math.max(x1, d.x + d.r); y1 = Math.max(y1, d.y + d.r); });
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(pic.width, Math.ceil(x1)); y1 = Math.min(pic.height, Math.ceil(y1));
  if (x1 - x0 < 2 || y1 - y0 < 2) { changed("look"); return; }
  const extent = Math.max(x1 - x0, y1 - y0), big = extent > BIG * Math.max(pic.width, pic.height);
  brushStatus.busy = true;
  brushStatus.progress = null;
  removing = s;
  changed("view");
  // The area it works from, the photo there (with earlier touch-ups) at the working size, and the brushed part as the hole
  const area = (ax, ay, aw, ah, ww, wh, grow) => {
    const work = document.createElement("canvas");
    work.width = ww; work.height = wh;
    const wctx = work.getContext("2d", { willReadFrequently: true });
    wctx.imageSmoothingQuality = "high";
    wctx.drawImage(photoNow(layer, pic, ax, ay, aw, ah), 0, 0, ww, wh);
    const marks = document.createElement("canvas");
    marks.width = ww; marks.height = wh;
    const mctx = marks.getContext("2d");
    mctx.scale(ww / aw, wh / ah);
    mctx.fillStyle = "#000";
    s.dabs.forEach((d) => { mctx.beginPath(); mctx.arc(d.x - ax, d.y - ay, d.r + grow * (aw / ww), 0, Math.PI * 2); mctx.fill(); });
    const m = mctx.getImageData(0, 0, ww, wh).data, hole = new Uint8Array(ww * wh);
    for (let i = 0; i < ww * wh; i++) hole[i] = m[i * 4 + 3] > 20 ? 1 : 0;
    return { ax, ay, aw, ah, ww, wh, work, wctx, hole };
  };
  const quick = () => {
    const reach = Math.max(32, Math.round(0.75 * extent));
    const ax = Math.max(0, x0 - reach), ay = Math.max(0, y0 - reach), aw = Math.min(pic.width, x1 + reach) - ax, ah = Math.min(pic.height, y1 + reach) - ay;
    const k = Math.min(1, WORK / Math.max(aw, ah));
    return area(ax, ay, aw, ah, Math.max(16, Math.round(aw * k)), Math.max(16, Math.round(ah * k)), 1);
  };
  try {
    let A = null;
    if (big) {
      // The AI fill: a square round the part, about twice its size, at 512 x 512
      const side = Math.min(Math.max(pic.width, pic.height), Math.max(384, Math.round(extent * 2.2)));
      const aw = Math.min(side, pic.width), ah = Math.min(side, pic.height);
      const ax = Math.round(Math.min(pic.width - aw, Math.max(0, (x0 + x1) / 2 - aw / 2))), ay = Math.round(Math.min(pic.height - ah, Math.max(0, (y0 + y1) / 2 - ah / 2)));
      A = area(ax, ay, aw, ah, AI_SIDE, AI_SIDE, 4);
      try {
        const out = await aiFill(A.wctx.getImageData(0, 0, AI_SIDE, AI_SIDE).data, A.hole);
        A.wctx.putImageData(new ImageData(out, AI_SIDE, AI_SIDE), 0, 0);
      } catch (err) {
        console.warn("AI fill, so the quick fill instead:", err);
        A = null;
      }
    }
    if (!A) {
      A = quick();
      const filled = await contentAware(A.wctx.getImageData(0, 0, A.ww, A.wh).data, A.ww, A.wh, A.hole);
      A.wctx.putImageData(new ImageData(filled, A.ww, A.wh), 0, 0);
    }
    // Back at full size, laid in where it was brushed (softly at the edge, by the brush's hardness)
    const w = x1 - x0, h = y1 - y0;
    const tile = document.createElement("canvas");
    tile.width = w; tile.height = h;
    const tctx = tile.getContext("2d");
    tctx.imageSmoothingQuality = "high";
    tctx.drawImage(A.work, 0, 0, A.ww, A.wh, A.ax - x0, A.ay - y0, A.aw, A.ah);
    tctx.globalCompositeOperation = "destination-in";
    const shape = document.createElement("canvas");
    shape.width = w; shape.height = h;
    const sctx = shape.getContext("2d");
    s.dabs.forEach((d) => dabShape(sctx, d.x - x0, d.y - y0, d.r, "rgba(0,0,0,1)"));
    tctx.drawImage(shape, 0, 0);
    await keepTile(layer, tile, x0, y0);
  } catch (err) {
    console.error("Remove:", err);
    brushStatus.hint = "That part couldn't be filled. Try a smaller stroke.";
  } finally {
    brushStatus.busy = false;
    brushStatus.progress = null;
    removing = null;
    changed("view");
  }
}
let removing = null; // (a Remove stroke being filled: its marks stay on the canvas meanwhile)

// Take every Remove and Clone touch-up off the picked photo (one undo step)
export function clearTouchUps(layer) {
  if (!layer || !layer.retouch) return;
  layer.retouch = null;
  changed("project");
  commit();
}

// ---- The right-click panel on a photo (Tom, 2026-11-18): the tools on top (Move · Remove · Clone · Eraser · Edge brush), and
// under them the brush's Size, Hardness and own switch, or with no brush in hand the photo's own actions (Duplicate…)

let panel = null, panelAt = null, panelExtras = [];
function closePanel() { if (panel) { panel.remove(); panel = null; } }
document.addEventListener("pointerdown", (e) => { if (panel && !panel.contains(e.target)) closePanel(); }, true);
window.addEventListener("wheel", (e) => { if (panel && !panel.contains(e.target)) closePanel(); }, true);

export function showBrushPanel(e, extras = []) {
  e.preventDefault();
  panelAt = { x: e.clientX, y: e.clientY };
  panelExtras = extras;
  buildPanel();
}

function buildPanel() {
  closePanel();
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); kids.forEach((k) => n.append(k)); return n; };
  panel = el("div", { className: "brush-pop" });
  const tools = toolIcons("ti", null, (tool) => { if (tool) buildPanel(); });
  tools.className = "tool-icons";
  panel.append(tools);
  if (state.tool) {
    const slider = (label, key, min, max, toV = (x) => x, fromV = (x) => x) => {
      const value = el("span", { className: "value", textContent: String(brush[key]) });
      const input = el("input", { type: "range", min, max, value: toV(brush[key]) });
      const fill = () => input.style.setProperty("--p", `${((input.value - min) / (max - min)) * 100}%`);
      fill();
      input.oninput = () => { brush[key] = fromV(Number(input.value)); value.textContent = String(brush[key]); fill(); changed("look"); };
      input.onchange = () => setBrush(key, brush[key]);
      return el("label", { className: "field" }, el("span", { className: "field-head" }, el("span", { textContent: label }), value), input);
    };
    panel.append(el("div", { className: "pair" }, slider("Size", "size", 0, 1000, sizeToSlider, sliderToSize), slider("Hardness", "hardness", 0, 100)));
    if (state.tool === "edge" || state.tool === "clone") {
      const seg = el("div", { className: "segmented wide small" });
      const opts = state.tool === "edge" ? [["edge", "erase", "Erase"], ["edge", "restore", "Restore"]] : [["blend", true, "Blend"], ["blend", false, "Exact copy"]];
      opts.forEach(([key, v, l]) => seg.append(el("button", { type: "button", textContent: l, className: brush[key] === v ? "on" : "", onclick: () => { setBrush(key, v); seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.textContent === l)); } })));
      panel.append(seg);
    }
  } else if (panelExtras.length) {
    const list = el("div", { className: "brush-pop-menu" });
    panelExtras.forEach(({ label, keys, action }) => {
      const row = el("div", { className: "menu-item" }, el("span", { textContent: label }));
      if (keys) row.append(el("span", { className: "meta", textContent: keys }));
      row.onclick = () => { closePanel(); action(); };
      list.append(row);
    });
    panel.append(list);
  }
  document.body.append(panel);
  const r = panel.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, panelAt.x + 6))}px`;
  panel.style.top = `${Math.max(8, Math.min(window.innerHeight - r.height - 8, panelAt.y + 6))}px`;
}

// ---- What the brush shows on the canvas (js/ui/stage.js calls this after the slide is drawn; frame pixels)

export function drawBrush(ctx, f, ratio) {
  const ready = brushReady();
  // Remove: the brushed part lit red while it's painted and while it's being filled
  const marks = (stroke && stroke.tool === "remove" && stroke) || removing;
  if (ready && marks) {
    ctx.save();
    ctx.fillStyle = "rgba(220, 50, 80, 0.45)";
    marks.dabs.forEach((d) => { const c = toFrame(marks.ready, f, d); const rr = d.r * (placement(marks.ready, f).box.w / marks.ready.pic.width); ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }
  if (!ready || !pointer) return;
  // Clone: where it copies from (a cross), following the brush
  if (state.tool === "clone" && clone.layer === ready.layer.id && clone.src) {
    const at = toPhoto(ready, f, pointer);
    const src = clone.offset ? { x: at.x + clone.offset.dx, y: at.y + clone.offset.dy } : clone.src;
    const c = toFrame(ready, f, src);
    ctx.save();
    ctx.lineWidth = 1.5;
    for (const [colour, wdt] of [["rgba(0,0,0,0.6)", 3], ["#fff", 1.5]]) {
      ctx.strokeStyle = colour; ctx.lineWidth = wdt;
      ctx.beginPath(); ctx.moveTo(c.x - 7, c.y); ctx.lineTo(c.x + 7, c.y); ctx.moveTo(c.x, c.y - 7); ctx.lineTo(c.x, c.y + 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(c.x, c.y, brush.size / 2, 0, Math.PI * 2); ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  }
  // The brush's circle (the hard part inside a fainter ring); sizing: at the drag's start, filled faintly red
  const at = stroke && stroke.tool === "size" ? stroke.start : pointer;
  const r = brush.size / 2;
  ctx.save();
  if (stroke && stroke.tool === "size") {
    const g = ctx.createRadialGradient(at.x, at.y, r * (brush.hardness / 100) * 0.99, at.x, at.y, r);
    g.addColorStop(0, "rgba(220,50,80,0.5)"); g.addColorStop(1, "rgba(220,50,80,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(at.x, at.y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.lineWidth = 1 / ratio;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath(); ctx.arc(at.x, at.y, r + 0.5, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath(); ctx.arc(at.x, at.y, r - 0.5, 0, Math.PI * 2); ctx.stroke();
  if (brush.hardness < 95) {
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath(); ctx.arc(at.x, at.y, Math.max(1, r * (brush.hardness / 100)), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

// (for the Tools fold: whether Clone has its source on this photo)
export const cloneHasSource = (layer) => !!(layer && clone.layer === layer.id && clone.src);
