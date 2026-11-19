// The Edit view: the current slide big, at its fixed shape (1:1, or a row of squares for a
// panorama). Photos and texts behave like pictures in the lyric video app (its mediaFrame.js):
// click one to pick it and a dashed frame with corner squares shows while the pointer is over
// it; drag inside to move it, drag a corner to size it (around its middle; a photo keeps its
// shape unless Lock ratio is off, a text's corner sizes its font), and drag just outside a
// corner (or the ↻ under it) to turn it (Shift: 15° steps; it settles on upright and the
// quarter turns, ⌘ = free; double-click ↻: upright). Click the grey to let go (then only the slide
// shows). The part of a picked photo past the slide's edges shows faintly (never exported).
// Pinch / ⌘-scroll anywhere zooms the view (never the photo: its corners size it).
//
// Guides (▦: thirds → grid → fine grid → off, per square) and snapping (🧲, on by default): a
// moved photo or text clicks onto the centre lines, the frame's edges, the guides and a
// panorama's seams (by its edges or middle), the line lights pink, and dragging on pulls it free.
// ⌘ held = no snapping. Guides are never exported.
import { state, changed, commit, currentItem, currentLayer, onChange, items } from '../state.js';
import { activeSet, aspectOf, isVideo, layersOf, isGrid } from '../project.js';
import { drawItem, drawPlaced, layoutText, textAt, photoBox, shownBox, trimOf, isTrimmed, onBox, textBox, turn, layerFrame, cellRects } from '../render.js';
import { lookedPicture, lookedFrame, lookedWhole } from '../looks.js';
import { brushReady, brushDown, brushMove, brushUp, brushLeave, drawBrush, showBrushPanel } from './brush.js';
import { maskDown, maskMove, maskUp, drawMasks } from './masks.js';
import { initVideoBar, videoFrame, spaceMovedView } from './videoBar.js';
import { getPicture, loadPicture } from '../media.js';
import { uiColour, onSkinChange } from './skin.js';
import { duplicateLayer, removeLayer } from '../actions.js';

const PREFS_KEY = "ans_photo_guides";
const SNAP = 7;         // screen pixels before something clicks onto a line
const SNAP_MIDDLE = 11; // ...a little further for the exact middle (the line people want most)
const PAD = 48;         // room around the frame
const HANDLE = 8;       // a corner square's reach
const TURN_REACH = 24;  // how far outside a corner turning works
const KNOB = 30;        // the ↻ knob, under the bottom edge
const ROTATE_CURSOR = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M19 12a7 7 0 1 1-2.05-4.95' fill='none' stroke='white' stroke-width='4' stroke-linecap='round'/><path d='M19 12a7 7 0 1 1-2.05-4.95' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'/><path d='M20 3v6h-6z' fill='black' stroke='white' stroke-width='1'/></svg>") 12 12, alias`;

let canvas, ctx, area;
let prefs = { grid: 1, magnet: true };
let viewZoom = 1;       // 1 = fit
let viewPan = { x: 0, y: 0 };
let spaceHeld = false;  // (Space held: the hand, dragging moves the view, as in Photoshop)
let panning = null;     // { x, y, pan, moved } while the view is dragged // (the view moved, CSS pixels: zoomed toward the pointer, two-finger scrolled)
let lit = [];           // lines something is snapped to: [{ axis, at }] (frame pixels)
let drag = null;
let hovering = false;   // the pointer is over the picked thing's frame (so its frame shows)

export function initStage() {
  canvas = document.getElementById("stage-canvas");
  area = document.getElementById("edit-view");
  ctx = canvas.getContext("2d");
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch (err) { /* defaults */ }
  new ResizeObserver(draw).observe(area);
  onChange(() => draw());
  onSkinChange(draw);
  document.fonts && document.fonts.addEventListener("loadingdone", draw);

  const guidesBtn = document.getElementById("btn-guides");
  const magnetBtn = document.getElementById("btn-magnet");
  const showPrefs = () => {
    const names = ["Guides: off", "Guides: thirds", "Guides: grid", "Guides: fine grid"];
    guidesBtn.classList.toggle("on", prefs.grid > 0);
    guidesBtn.title = `${names[prefs.grid]} (click: thirds → grid → fine grid → off)`;
    magnetBtn.classList.toggle("on", prefs.magnet);
    magnetBtn.title = prefs.magnet ? "Snapping on: things click onto the middle, edges and guides (hold ⌘ to move freely)" : "Snapping off";
  };
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (err) { /* not kept */ } showPrefs(); draw(); };
  guidesBtn.onclick = () => { prefs.grid = (prefs.grid + 1) % 4; savePrefs(); };
  magnetBtn.onclick = () => { prefs.magnet = !prefs.magnet; savePrefs(); };
  showPrefs();
  document.getElementById("btn-zoom-in").onclick = () => { viewZoom = Math.min(4, viewZoom * 1.25); draw(); };
  document.getElementById("btn-zoom-out").onclick = () => { viewZoom = Math.max(0.3, viewZoom / 1.25); draw(); };
  document.getElementById("btn-zoom-fit").onclick = () => { viewZoom = 1; viewPan = { x: 0, y: 0 }; draw(); };

  initVideoBar(draw);
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("contextmenu", photoMenu);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("pointerleave", () => { brushLeave(); canvas.style.cursor = ""; if (!drag && hovering) { hovering = false; draw(); } });
  canvas.addEventListener("wheel", wheel, { passive: false });
  // Hold Space: the hand (drag moves the view). A tap of Space still plays a video (js/ui/videoBar.js).
  const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "") || (e.target && e.target.isContentEditable);
  document.addEventListener("keydown", (e) => {
    if (e.key !== " " || typing(e) || state.view !== "edit") return;
    e.preventDefault();
    if (!spaceHeld) { spaceHeld = true; if (!drag) canvas.style.cursor = "grab"; }
  });
  document.addEventListener("keyup", (e) => {
    if (e.key !== " ") return;
    spaceHeld = false;
    if (!panning) canvas.style.cursor = "";
  });
  canvas.addEventListener("dblclick", (e) => {
    const item = currentItem();
    if (!item) return;
    const f = frameRect(item), p = local(e, f);
    const picked = pickedBox(item, f);
    if (picked && zoneAt(picked.box, p) === "rotate") { setAngle(picked, 0); changed("project"); commit(); return; }
    const hit = textAt(ctx, item, f.w, f.h, p.x, p.y);
    if (hit) { pick("text", hit.id); state.tab = "text"; changed("view"); document.dispatchEvent(new CustomEvent("focus-text")); }
  });
}

// Where the frame sits on screen (CSS pixels): { x, y, w, h, pw } (pw: one slide's width; the
// set's shape, e.g. 4:5, times the panorama's slides)
function frameRect(item) {
  const W = area.clientWidth, H = area.clientHeight;
  const span = item ? item.span : 1;
  const a = aspectOf(activeSet(state.project).ratio);
  // (room under it for the floating canvas bar, and the video bar over that on a video slide)
  const below = isVideo(item) ? 124 : 76;
  const top = 24, room = H - below - top;
  const fit = Math.min((W - PAD * 2) / (span * a), room - 12);
  const h = Math.max(40, fit * viewZoom), w = h * a * span;
  return { x: Math.round((W - w) / 2 + viewPan.x), y: Math.round(top + (room - h) / 2 + viewPan.y), w, h, pw: h * a };
}

// ---- What's picked: the photo, a text, or nothing

// layer: for a photo, which layer (the slide itself, or one of its extra layers)
function pick(kind, id = null, layer = null) {
  state.photoPicked = kind === "photo";
  state.textId = kind === "text" ? id : null;
  const item = currentItem();
  state.layerId = kind === "photo" && layer && item && layer !== item ? layer.id : null;
}

// A layer's photo box on the frame (frame pixels), with the frame it's placed in (its grid cell,
// or the whole slide): { box, rect } or null
function layerBox(item, layer, f) {
  const pic = getPicture(layer.mediaId);
  const rect = layerFrame(item, layer, f.w, f.h);
  if (!pic || !rect) return null;
  const b = shownBox(layer.crop, pic.width, pic.height, rect.w, rect.h); // (the part that shows: trimmed edges left out)
  const whole = photoBox(layer.crop, pic.width, pic.height, rect.w, rect.h);
  return { rect, pic, whole, box: { ...b, cx: b.cx + rect.x, cy: b.cy + rect.y } };
}

// The layer under a point (frame pixels): in a grid, the cell's layer ({ cell } for an empty one);
// else the top photo there. Only on the slide itself (the faint part past its edges doesn't count),
// unless `picked` (the picked layer, whose handles reach past the edges).
function layerAt(item, f, p) {
  const onSlide = p.x >= 0 && p.y >= 0 && p.x <= f.w && p.y <= f.h;
  const cells = cellRects(item, f.w, f.h);
  if (cells) {
    const i = cells.findIndex((c) => p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h);
    if (i < 0) return null;
    const layer = layersOf(item)[i];
    return layer ? { layer } : { cell: i };
  }
  const all = layersOf(item);
  for (let i = all.length - 1; i >= 0; i--) {
    const lb = layerBox(item, all[i], f);
    if (lb && onBox(lb.box, p.x, p.y) && (onSlide || (state.photoPicked && currentLayer() === all[i]))) return { layer: all[i] };
  }
  return null;
}

// The picked thing's box on the frame: { kind, box, text?, layer?, rect? } or null
function pickedBox(item, f) {
  if (state.textId) {
    const t = item.texts.find((x) => x.id === state.textId);
    return t ? { kind: "text", text: t, box: textBox(layoutText(ctx, t, f.w, f.h)) } : null;
  }
  if (state.photoPicked) {
    const layer = currentLayer();
    const lb = layer && layerBox(item, layer, f);
    return lb ? { kind: "photo", layer, rect: lb.rect, box: lb.box, whole: lb.whole, pic: lb.pic, edges: !isGrid(item) } : null;
  }
  return null;
}

function setAngle(picked, degrees) {
  const a = Math.round((((degrees + 180) % 360 + 360) % 360 - 180) * 10) / 10; // (-180 … 180)
  if (picked.kind === "text") picked.text.rotation = a; else (picked.layer || currentItem()).crop.rotation = a;
}

// The corners of a turned box, on the frame: [[x, y] ×4] (tl, tr, bl, br)
function corners(box) {
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => {
    const [u, v] = turn((sx * box.w) / 2, (sy * box.h) / 2, box.rotation);
    return [box.cx + u, box.cy + v];
  });
}
const CORNER_NAMES = ["tl", "tr", "bl", "br"];
function knobAt(box) { const [u, v] = turn(0, box.h / 2 + KNOB, box.rotation); return [box.cx + u, box.cy + v]; }

// The middles of a box's sides (a photo's trim handles): [[name, x, y] ×4]
function sideMiddles(box) {
  return [["l", -1, 0], ["r", 1, 0], ["t", 0, -1], ["b", 0, 1]].map(([n, sx, sy]) => {
    const [u, v] = turn((sx * box.w) / 2, (sy * box.h) / 2, box.rotation);
    return [n, box.cx + u, box.cy + v];
  });
}

// What part of the picked box a point is on: a corner name, a side ("l", "r", "t", "b": a photo's trim handles, with
// edges true), "rotate", "inside" or null
function zoneAt(box, p, edges = false) {
  const cs = corners(box);
  for (let i = 0; i < 4; i++) if (Math.hypot(p.x - cs[i][0], p.y - cs[i][1]) <= HANDLE) return CORNER_NAMES[i];
  if (edges) for (const [n, x, y] of sideMiddles(box)) if (Math.hypot(p.x - x, p.y - y) <= HANDLE + 2) return n;
  const [kx, ky] = knobAt(box);
  if (Math.hypot(p.x - kx, p.y - ky) <= 11) return "rotate";
  if (onBox(box, p.x, p.y)) return "inside";
  if (cs.some(([x, y]) => Math.hypot(p.x - x, p.y - y) <= TURN_REACH)) return "rotate";
  return null;
}

// ---- Lines to snap to and to draw, along one side of the frame (frame pixels)

function guideLines(axis, item, f) {
  const lines = [];
  const squares = axis === "x" ? item.span : 1;
  for (let k = 0; k < squares; k++) {
    const o = axis === "x" ? k * f.pw : 0, s = axis === "x" ? f.pw : f.h;
    if (prefs.grid === 1) lines.push(o + s / 3, o + (2 * s) / 3);
    if (prefs.grid >= 2) {
      const cell = Math.min(f.pw, f.h) / (prefs.grid === 2 ? 6 : 12); // (square cells, out from the middle)
      for (let at = s / 2; at > 0.5; at -= cell) lines.push(o + at);
      for (let at = s / 2 + cell; at < s - 0.5; at += cell) lines.push(o + at);
    }
  }
  return lines;
}

function snapLines(axis, item, f) {
  const size = axis === "x" ? f.w : f.h;
  const middles = axis === "x" ? Array.from({ length: item.span }, (_, k) => (k + 0.5) * f.pw) : [f.h / 2];
  const seams = axis === "x" ? Array.from({ length: item.span - 1 }, (_, k) => (k + 1) * f.pw) : [];
  if (axis === "x" && item.span > 1) middles.push(f.w / 2);
  return { middles, others: [0, size, ...seams, ...guideLines(axis, item, f)] };
}

// The shift that snaps a box's edges or middle (its bounding box, frame pixels) onto the nearest
// line on each side; lights the lines it lands on
function snapBox(box, item, f, free) {
  if (!prefs.magnet || free) return { dx: 0, dy: 0 };
  const cs = corners(box);
  const xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1]);
  const along = (axis, lo, hi) => {
    const { middles, others } = snapLines(axis, item, f);
    const points = [lo, (lo + hi) / 2, hi];
    let best = null;
    const tryLine = (line, reach) => points.forEach((p) => {
      const d = line - p;
      if (Math.abs(d) <= reach && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line };
    });
    middles.forEach((line) => tryLine(line, SNAP_MIDDLE));
    others.forEach((line) => tryLine(line, SNAP));
    if (best) lit.push({ axis, at: best.line });
    return best ? best.d : 0;
  };
  return { dx: along("x", Math.min(...xs), Math.max(...xs)), dy: along("y", Math.min(...ys), Math.max(...ys)) };
}

// ---- Pointer

// The resize cursor for a side, turned with the photo (to the nearest of the four)
function sideCursor(zone, rotation) {
  const a = ((((zone === "l" || zone === "r" ? 0 : 90) + rotation) % 180) + 180) % 180;
  return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][Math.round(a / 45) % 4];
}

const local = (e, f) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left - f.x, y: e.clientY - r.top - f.y }; };

function down(e) {
  const item = currentItem();
  if (!item || !getPicture(item.mediaId)) return;
  const f = frameRect(item);
  const p = local(e, f);
  canvas.setPointerCapture(e.pointerId);
  if (spaceHeld && e.button === 0) { startPan(e); return; } // (the hand: Space + drag moves the view)
  if (maskDown(e, f, p)) return; // (a mask's handle: it moves, js/ui/masks.js)
  if (brushDown(e, f, p)) return; // (a touch-up brush in hand: it paints, js/ui/brush.js)
  const picked = pickedBox(item, f);
  const zone = picked ? zoneAt(picked.box, p, picked.edges) : null;
  if (e.button === 2) return; // (right-click: the menu picks what's under it)
  if (picked && zone && zone !== "inside") { startDrag(picked, zone, p, f); return; }

  // Otherwise: what's under the pointer (texts sit above the photos), picked and ready to move
  const hitText = textAt(ctx, item, f.w, f.h, p.x, p.y);
  const hit = hitText ? null : layerAt(item, f, p);
  if (hitText) {
    if (state.textId !== hitText.id) { pick("text", hitText.id); state.tab = "text"; changed("view"); }
  } else if (hit && hit.cell !== undefined) {
    // an empty grid cell: a photo for it
    document.dispatchEvent(new CustomEvent("add-layer"));
    return;
  } else if (hit) {
    if (!state.photoPicked || currentLayer() !== hit.layer) { pick("photo", null, hit.layer); changed("view"); }
  } else {
    if (state.textId || state.photoPicked) { pick(null); changed("view"); }
    // the grey round the slide (or an empty part of it), dragged: the view moves (zoomed, or moved already)
    if (e.button === 0 && (viewZoom !== 1 || viewPan.x || viewPan.y)) startPan(e);
    return;
  }
  startDrag(pickedBox(item, f), "inside", p, f);
}

// (the view's zoom and move, for checking)
export const viewNow = () => ({ zoom: viewZoom, pan: { ...viewPan } });

function startPan(e) {
  panning = { x: e.clientX, y: e.clientY, pan: { ...viewPan }, moved: false };
  canvas.style.cursor = "grabbing";
}

// Right-click a photo: it's picked, and a panel at the pointer has the tools (Move · Remove · Clone · Edge brush) and
// under them the brush's settings, or with no brush in hand Duplicate / Remove (js/ui/brush.js showBrushPanel)
function photoMenu(e) {
  e.preventDefault();
  if (e.ctrlKey && e.altKey) return; // (Control + Option drag sizes the brush)
  const item = currentItem();
  if (!item || !getPicture(item.mediaId)) return;
  const f = frameRect(item);
  const hit = brushReady() ? { layer: currentLayer() } : layerAt(item, f, local(e, f));
  if (!hit || !hit.layer) return;
  if (!brushReady()) { pick("photo", null, hit.layer); changed("view"); }
  const entries = [];
  if (!(hit.layer === item && isVideo(item))) entries.push({ label: "Duplicate", keys: "⌘D", action: () => duplicateLayer(hit.layer) }); // (a video slide's video: nothing to copy)
  if (layersOf(item).length > 1 && !(hit.layer === item && isVideo(item))) entries.push({ label: "Remove from slide", action: () => removeLayer(hit.layer) });
  showBrushPanel(e, entries);
}

function startDrag(picked, zone, p, f) {
  const item = currentItem();
  hovering = true;
  const layer = picked.layer || item;
  drag = { kind: picked.kind, text: picked.text, layer, rect: picked.rect || { x: 0, y: 0, w: f.w, h: f.h }, zone, f, start: p, box: { ...picked.box }, whole: picked.whole, pic: picked.pic, crop: { ...layer.crop, trim: { ...trimOf(layer.crop) } }, textStart: picked.text ? { ...picked.text } : null, moved: false };
  if (zone === "rotate") drag.from = Math.atan2(p.y - picked.box.cy, p.x - picked.box.cx);
  canvas.style.cursor = zone === "inside" ? "grabbing" : zone === "rotate" ? ROTATE_CURSOR : canvas.style.cursor;
}

function move(e) {
  if (panning) {
    const dx = e.clientX - panning.x, dy = e.clientY - panning.y;
    if (Math.abs(dx) + Math.abs(dy) > 2 && !panning.moved) { panning.moved = true; if (spaceHeld) spaceMovedView(); }
    viewPan = { x: panning.pan.x + dx, y: panning.pan.y + dy };
    draw();
    return;
  }
  if (spaceHeld) { canvas.style.cursor = "grab"; return; }
  if (!drag) { const item = currentItem(); if (item) { const f = frameRect(item), over = maskMove(e, f, local(e, f)); if (over) { canvas.style.cursor = over; return; } } }
  if (!drag && brushReady()) { const item = currentItem(), f = frameRect(item); canvas.style.cursor = "none"; brushMove(e, f, local(e, f)); return; }
  if (!drag) { hover(e); return; }
  const { f, box, zone } = drag;
  const item = currentItem();
  const p = local(e, f);
  let dx = p.x - drag.start.x, dy = p.y - drag.start.y;
  if (!dx && !dy && !drag.moved) return;
  drag.moved = true;
  lit = [];
  const crop = (drag.layer || item).crop, t = drag.text, rect = drag.rect;

  if (zone === "rotate") {
    let a = (drag.kind === "text" ? drag.textStart.rotation : drag.crop.rotation) + ((Math.atan2(p.y - box.cy, p.x - box.cx) - drag.from) * 180) / Math.PI;
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    else if (!e.metaKey) { const q = Math.round(a / 90) * 90; if (Math.abs(a - q) < 3) a = q; } // (settles on upright / quarter turns)
    setAngle(drag, a);
    drag.angle = drag.kind === "text" ? t.rotation : crop.rotation;
    if (drag.kind === "photo" && drag.pic) {
      // (a trimmed photo turns about the middle of the part that shows)
      const nb = shownBox({ ...crop, x: drag.crop.x, y: drag.crop.y }, drag.pic.width, drag.pic.height, rect.w, rect.h);
      crop.x = drag.crop.x + (box.cx - rect.x - nb.cx) / rect.w;
      crop.y = drag.crop.y + (box.cy - rect.y - nb.cy) / rect.h;
    }
  } else if (zone === "inside") {
    // Move: the middle follows the pointer, snapping its edges or middle to the lines
    const moved = { ...box, cx: box.cx + dx, cy: box.cy + dy };
    const snap = snapBox(moved, item, f, e.metaKey || (drag.kind === "photo" && isGrid(item))); // (in a grid cell: free)
    const cx = moved.cx + snap.dx, cy = moved.cy + snap.dy;
    if (drag.kind === "text") { t.x = cx / f.w; t.y = cy / f.h; }
    else { crop.x = drag.crop.x + (cx - box.cx) / rect.w; crop.y = drag.crop.y + (cy - box.cy) / rect.h; } // (the part that shows follows)
  } else if (["l", "r", "t", "b"].includes(zone)) {
    // A side: trim the photo there (Canva's side handles), dragged in or back out to the photo's own edge
    const [du, dv] = turn(dx, dy, -box.rotation);
    const t0 = drag.crop.trim, W = drag.whole.w, H = drag.whole.h, least = 0.03;
    const tr = { ...t0 };
    if (zone === "l") tr.l = Math.min(1 - t0.r - least, Math.max(0, t0.l + du / W));
    if (zone === "r") tr.r = Math.min(1 - t0.l - least, Math.max(0, t0.r - du / W));
    if (zone === "t") tr.t = Math.min(1 - t0.b - least, Math.max(0, t0.t + dv / H));
    if (zone === "b") tr.b = Math.min(1 - t0.t - least, Math.max(0, t0.b - dv / H));
    crop.trim = tr;
  } else {
    // A corner: size around the middle (the pointer's move along the box's own sides)
    [dx, dy] = turn(dx, dy, -box.rotation);
    const sx = zone.endsWith("r") ? 1 : -1, sy = zone.startsWith("b") ? 1 : -1;
    const fx = Math.max(0.02, (box.w + 2 * sx * dx) / box.w), fy = Math.max(0.02, (box.h + 2 * sy * dy) / box.h);
    const even = Math.abs(fx - 1) > Math.abs(fy - 1) ? fx : fy;
    if (drag.kind === "text") t.size = Math.min(0.8, Math.max(0.01, drag.textStart.size * even));
    else if (crop.lockRatio !== false) crop.zoom = Math.min(12, Math.max(0.03, drag.crop.zoom * even));
    else {
      crop.zoom = Math.min(12, Math.max(0.03, drag.crop.zoom * fy));
      crop.stretch = Math.min(8, Math.max(0.1, ((drag.crop.stretch || 1) * fx) / fy));
    }
    if (drag.kind === "photo" && drag.pic) {
      // (a trimmed photo sizes around the middle of the part that shows)
      const nb = shownBox({ ...crop, x: drag.crop.x, y: drag.crop.y }, drag.pic.width, drag.pic.height, rect.w, rect.h);
      crop.x = drag.crop.x + (box.cx - rect.x - nb.cx) / rect.w;
      crop.y = drag.crop.y + (box.cy - rect.y - nb.cy) / rect.h;
    }
  }
  changed("look");
}

function up() {
  if (panning) { panning = null; canvas.style.cursor = spaceHeld ? "grab" : ""; return; }
  if (maskUp()) return;
  if (!drag) { brushUp(); return; }
  const moved = drag.moved;
  drag = null;
  lit = [];
  canvas.style.cursor = "";
  if (moved) commit(); // (one drag = one undo step)
  draw();
}

function hover(e) {
  const item = currentItem();
  if (!item) { canvas.style.cursor = ""; return; }
  const f = frameRect(item);
  const p = local(e, f);
  const picked = pickedBox(item, f);
  const zone = picked ? zoneAt(picked.box, p, picked.edges) : null;
  const over = !!zone;
  if (over !== hovering) { hovering = over; draw(); }
  if (zone === "rotate") canvas.style.cursor = ROTATE_CURSOR;
  else if (zone === "tl" || zone === "br") canvas.style.cursor = "nwse-resize";
  else if (zone === "tr" || zone === "bl") canvas.style.cursor = "nesw-resize";
  else if (zone === "l" || zone === "r" || zone === "t" || zone === "b") canvas.style.cursor = sideCursor(zone, picked.box.rotation);
  else if (zone === "inside" || textAt(ctx, item, f.w, f.h, p.x, p.y)) canvas.style.cursor = "move";
  else {
    const hit = layerAt(item, f, p);
    canvas.style.cursor = hit ? (hit.cell !== undefined ? "copy" : "move") : "";
  }
}

// Pinch (or ⌘-scroll) anywhere over the canvas zooms the view toward the pointer, as in the Lyric Visualiser (Tom,
// 2026-11-18: never the photo; its corner handles size it). Zoomed in, a two-finger scroll moves around. Fit resets both.
function wheel(e) {
  const item = currentItem();
  if (!item || !getPicture(item.mediaId)) return;
  e.preventDefault();
  if (!e.metaKey && !e.ctrlKey) {
    if (viewZoom <= 1 && !viewPan.x && !viewPan.y) return; // (nothing to move around)
    viewPan = { x: viewPan.x - e.deltaX, y: viewPan.y - e.deltaY };
    draw();
    return;
  }
  const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  const before = frameRect(item), u = (px - before.x) / before.w, v = (py - before.y) / before.h;
  viewZoom = Math.min(6, Math.max(0.3, viewZoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))));
  if (viewZoom <= 1.001 && viewZoom >= 0.999) viewZoom = 1;
  const after = frameRect(item); // (the same point of the slide stays under the pointer)
  viewPan = { x: viewPan.x + px - (after.x + u * after.w), y: viewPan.y + py - (after.y + v * after.h) };
  if (viewZoom <= 1) viewPan = { x: viewPan.x * 0.8, y: viewPan.y * 0.8 }; // (zoomed back out: it drifts home to the middle)
  draw();
}

// ---- Drawing

let queued = false;
export function draw() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; paint(); });
}

function paint() {
  const ratio = window.devicePixelRatio || 1;
  const W = area.clientWidth, H = area.clientHeight;
  if (canvas.width !== Math.round(W * ratio) || canvas.height !== Math.round(H * ratio)) {
    canvas.width = Math.round(W * ratio);
    canvas.height = Math.round(H * ratio);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const item = currentItem();
  document.getElementById("empty-state").hidden = items().length > 0;
  document.getElementById("btn-before").classList.toggle("on", !!state.before);
  if (!item) return;
  const pic = getPicture(item.mediaId);
  if (!pic) { loadPicture(item.mediaId).then(draw); return; }
  layersOf(item).forEach((l) => { if (!getPicture(l.mediaId)) loadPicture(l.mediaId).then(draw); }); // (the other layers' photos)
  const f = frameRect(item);
  ctx.setTransform(ratio, 0, 0, ratio, f.x * ratio, f.y * ratio);

  // A video: the frame at the playhead, with its look (worked out once for both draws below)
  const raw = isVideo(item) ? videoFrame(item) : null;
  const frame = raw && !state.before ? lookedFrame(item, raw, "preview", state.project.seed) : raw;

  // The slide lifted off the dotted desk: a soft shadow under it
  ctx.save();
  ctx.shadowColor = "rgba(59, 58, 55, 0.2)";
  ctx.shadowBlur = 30 * ratio;
  ctx.shadowOffsetY = 8 * ratio;
  ctx.fillStyle = item.background || "#ffffff";
  ctx.fillRect(0, 0, f.w, f.h);
  ctx.restore();

  // The picked photo past its frame's edges (the slide's, or its grid cell's), faint: only while
  // it's picked (click the grey to see just the slide)
  const layer = currentLayer();
  const layerPic = layer && getPicture(layer.mediaId);
  const rect = layer && layerFrame(item, layer, f.w, f.h);
  if (state.photoPicked && layerPic && rect) {
    const looked = (layer === item && frame) || (state.before ? layerPic.preview : lookedPicture(layer, "preview", state.project.seed));
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.translate(rect.x, rect.y);
    drawPlaced(ctx, looked, layer.crop, rect.w, rect.h);
    ctx.restore();
  }

  drawItem(ctx, item, f.w, f.h, { before: state.before, seed: state.project.seed, frame, frameLooked: true });
  // A picked photo's trimmed-off sides, faint over the slide (as past its edges), to see what the side handles took off
  if (state.photoPicked && layerPic && rect && !isGrid(item) && isTrimmed(layer.crop)) {
    const looked = (layer === item && frame) || (state.before ? layerPic.preview : lookedPicture(layer, "preview", state.project.seed));
    const b = photoBox(layer.crop, layerPic.width, layerPic.height, rect.w, rect.h), t = trimOf(layer.crop);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, f.w, f.h); ctx.clip();
    ctx.translate(rect.x + b.cx, rect.y + b.cy);
    ctx.rotate((b.rotation * Math.PI) / 180);
    ctx.beginPath();
    ctx.rect(-b.w / 2, -b.h / 2, b.w, b.h);
    ctx.rect(-b.w / 2 + t.l * b.w, -b.h / 2 + t.t * b.h, b.w * (1 - t.l - t.r), b.h * (1 - t.t - t.b));
    ctx.clip("evenodd");
    ctx.rotate((-b.rotation * Math.PI) / 180);
    ctx.translate(-b.cx, -b.cy);
    ctx.globalAlpha = 0.3;
    drawPlaced(ctx, looked, layer.crop, rect.w, rect.h);
    ctx.restore();
  }
  // The edge brush in hand: the whole photo faintly over the slide (to see what Restore brings back; over the kept part
  // it's the same picture, so only the cut-away part shows it)
  if (state.tool === "edge" && brushReady() && layerPic && rect) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, f.w, f.h); ctx.clip();
    ctx.globalAlpha = 0.28;
    ctx.translate(rect.x, rect.y);
    drawPlaced(ctx, lookedWhole(layer, "preview", state.project.seed), layer.crop, rect.w, rect.h);
    ctx.restore();
  }

  // A grid's empty cells: click (or drop a photo) to fill them
  const cells = cellRects(item, f.w, f.h);
  if (cells) {
    cells.forEach((c, i) => {
      if (i < layersOf(item).length) return;
      ctx.save();
      ctx.fillStyle = "rgba(128,128,128,0.18)";
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "rgba(128,128,128,0.8)";
      ctx.strokeRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1);
      ctx.fillStyle = "rgba(90,90,90,0.9)";
      ctx.font = `${Math.max(14, Math.min(c.w, c.h) * 0.18)}px Helvetica, Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("＋", c.x + c.w / 2, c.y + c.h / 2);
      ctx.restore();
    });
  }

  // Guides, seams, the frame
  const hair = 1 / ratio;
  const line = (axis, at, colour, width = hair, dash = null) => {
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    if (axis === "x") { ctx.moveTo(at, 0); ctx.lineTo(at, f.h); } else { ctx.moveTo(0, at); ctx.lineTo(f.w, at); }
    ctx.stroke();
    ctx.restore();
  };
  const guide = "rgba(128, 128, 128, 0.55)";
  guideLines("x", item, f).forEach((at) => line("x", at, guide));
  guideLines("y", item, f).forEach((at) => line("y", at, guide));
  for (let k = 1; k < item.span; k++) line("x", k * f.pw, "rgba(120,120,120,0.95)", 1.5, [6, 5]);
  lit.forEach((l) => line(l.axis, l.at, uiColour("--snap") || "#ff2d8a", 1.5));

  // Slide numbers on a panorama
  if (item.span > 1) {
    const list = items();
    const first = list.slice(0, list.indexOf(item)).reduce((n, i) => n + i.span, 1);
    ctx.font = "700 11px Helvetica, Arial, sans-serif";
    for (let k = 0; k < item.span; k++) {
      const label = String(first + k);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath();
      ctx.roundRect(k * f.pw + 6, 6, ctx.measureText(label).width + 10, 16, 8);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(label, k * f.pw + 11, 18);
    }
  }

  // The picked photo / text: its dashed frame, corner squares and ↻ (while the pointer is on it)
  const picked = pickedBox(item, f);
  if (picked && (hovering || drag) && !brushReady()) {
    const { box } = picked;
    const accent = uiColour("--accent-ink") || "#1f4fbf";
    ctx.save();
    ctx.translate(box.cx, box.cy);
    ctx.rotate((box.rotation * Math.PI) / 180);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
    ctx.setLineDash([]);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
      ctx.fillStyle = "#fff";
      ctx.fillRect((sx * box.w) / 2 - 5, (sy * box.h) / 2 - 5, 10, 10);
      ctx.strokeRect((sx * box.w) / 2 - 5, (sy * box.h) / 2 - 5, 10, 10);
    });
    // a photo's side handles (trim): short bars at the middles of its sides
    if (picked.edges) {
      [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([sx, sy]) => {
        const long = 18, short = 6, w = sx ? short : long, h = sx ? long : short;
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.roundRect((sx * box.w) / 2 - w / 2, (sy * box.h) / 2 - h / 2, w, h, 3); ctx.fill(); ctx.stroke();
      });
    }
    // the ↻ knob under the middle
    ctx.beginPath();
    ctx.moveTo(0, box.h / 2);
    ctx.lineTo(0, box.h / 2 + KNOB - 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, box.h / 2 + KNOB, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.stroke();
    ctx.rotate((-box.rotation * Math.PI) / 180);
    const [kx, ky] = turn(0, box.h / 2 + KNOB, box.rotation);
    ctx.fillStyle = accent;
    ctx.font = "700 13px Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("↻", kx, ky + 1);
    // the angle, while turning
    if (drag && drag.zone === "rotate") {
      const label = `${Math.round(box.rotation)}°`;
      ctx.font = "700 12px Helvetica, Arial, sans-serif";
      const w = ctx.measureText(label).width + 12;
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.beginPath();
      ctx.roundRect(kx - w / 2, ky + 16, w, 20, 10);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(label, kx, ky + 26);
    }
    ctx.restore();
  }
  drawMasks(ctx, f); // (the picked mask: its handles, and red where it is while shaped or painted)
  drawBrush(ctx, f, ratio); // (a touch-up brush in hand: its circle)
}
