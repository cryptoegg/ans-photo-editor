// Masks (Tom, 2026-11-18, like Lightroom's): fixes on part of a photo. A photo layer's `masks` is a list, each its own
// part of the photo with its own Light and Colour:
//   { id, kind, on, invert, light: {…}, colour: {…}, … }
//   kind "brush"    painted by hand (the Mask brush, js/ui/brush.js): maskId, a PNG in the media store (white, the
//                   strength in its alpha)
//   kind "linear"   a fade: line = { x0, y0, x1, y1 } in shares of the photo; full at (x0, y0), none from (x1, y1)
//   kind "radial"   a round part: round = { cx, cy, rx, ry, feather } (shares of the photo; feather 0 - 100)
//   kind "subject"  the person / main thing, found by the Remove background model (js/cutout.js): maskId
// invert: everything but that part. The fixes go on after the photo's own Light and Colour (and Curves…) and before
// its filter (js/looks.js), each worked out on the whole photo, then laid on through its mask.
import { LIGHT_DEFAULTS, COLOUR_DEFAULTS, newId } from './project.js';
import { getPicture, loadPicture } from './media.js';
import { changed } from './state.js';

export const MASK_KINDS = [
  ["brush", "Brush", "Paint where the fix goes"],
  ["linear", "Gradient", "A fix that fades in across the photo (a sky, a floor)"],
  // (Round, "radial", taken off the menu by Tom, 2026-11-23; a Round mask already made still works and shows as Round)
  ["subject", "Subject", "The person or main thing, found for you"],
  // (Tom, 2026-11-23, as Photoshop's selections: each makes a painted mask, touched up after with the mask brush)
  ["lasso", "Lasso", "Draw round the part the fix goes on"],
  ["wand", "Wand", "Click a colour: the part of the photo that colour runs through"]
];
// Masks made as a picture that the mask brush can paint on
export const PAINTED = ["brush", "lasso", "wand"];
// The Effect brush's effects (Tom, 2026-11-18, from his references): [id, label, effect type, its settings]. A mask with
// `effect: { id, type, settings }` paints that effect on (a Brush mask: the Effect brush, js/ui/brush.js).
export const BRUSH_EFFECTS = [
  ["pixelate", "Pixelate", "pixelate", {}],
  ["blur", "Blur", "blur", { amount: 45, style: "soft" }],
  ["blocks", "Blocks", "datamosh", { speed: 0 }],
  ["shards", "Shards", "shards", {}],
  ["pull", "Pull", "stretch", { direction: "columns", size: 25, speed: 0 }],
  ["smear", "Smear", "liquify", { speed: 0, patches: 0, size: 60 }],
  ["crumple", "Crumple", "crumple", {}],
  ["stripes", "RGB stripes", "stripes", {}],
  ["halftone", "Halftone", "halftone", {}],
  ["mono", "Black & white", "colour", { mono: true }]
];
// Taken off the list (Tom, 2026-11-18) but still drawn where they were painted: not offered for new strokes
export const RETIRED_EFFECTS = [["glow", "Glow", "bloom", { strength: 60 }]];
const known = (id) => BRUSH_EFFECTS.find(([k]) => k === id) || RETIRED_EFFECTS.find(([k]) => k === id);
export const brushEffect = (id) => known(id) || BRUSH_EFFECTS[0];
// (an effect whose recipe is gone (Tiles, Low poly): shown and drawn as Pixelate)
export const tidyEffect = (e) => (e && known(e.id) ? e : e ? effectOf("pixelate") : null);
export const effectOf = (id) => { const [k, , type, settings] = brushEffect(id); return { id: k, type, settings: { ...settings } }; };

export const maskName = (layer, m) => {
  const label = m.effect ? brushEffect(m.effect.id)[1] : m.kind === "radial" ? "Round" : (MASK_KINDS.find(([k]) => k === m.kind) || [, "Mask"])[1];
  const same = (layer.masks || []).filter((x) => (m.effect ? x.effect && x.effect.id === m.effect.id : x.kind === m.kind && !x.effect));
  return same.length > 1 ? `${label} ${same.indexOf(m) + 1}` : label;
};

export function newMask(kind) {
  const m = { id: newId("k"), kind, on: true, invert: false, light: LIGHT_DEFAULTS(), colour: COLOUR_DEFAULTS() };
  if (kind === "linear") m.line = { x0: 0.5, y0: 0, x1: 0.5, y1: 0.5 };
  if (kind === "radial") m.round = { cx: 0.5, cy: 0.42, rx: 0.25, ry: 0.3, feather: 60 };
  return m;
}

// A saved mask brought up to date
export function tidyMask(m) {
  const out = { ...newMask(m.kind || "brush"), ...m };
  out.light = { ...LIGHT_DEFAULTS(), ...(m.light || {}) };
  out.colour = { ...COLOUR_DEFAULTS(), ...(m.colour || {}) };
  return out;
}

const isZero = (obj) => Object.values(obj || {}).every((v) => !v);
// The masks that change the photo: switched on, something set, and something to show (a brush / subject with a picture)
export const activeMasks = (layer) => ((layer && layer.masks) || []).filter((m) => m.on && (!isZero(m.light) || !isZero(m.colour) || m.effect) && (m.kind === "linear" || m.kind === "radial" || m.maskId));

// For the looks' memory: what the masks are now (their pictures by id and change)
export function masksKey(layer) {
  const list = activeMasks(layer);
  if (!list.length) return "";
  return JSON.stringify(list.map((m) => [m, m.maskId ? `${(getPicture(m.maskId) || {}).rev || 0}${getPicture(m.maskId) ? "" : "?"}` : ""]));
}

// The mask as a picture w x h: white, its strength in the alpha. null while its picture loads.
export function maskCanvas(m, w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  if (m.kind === "linear") {
    const { x0, y0, x1, y1 } = m.line;
    const g = ctx.createLinearGradient(x0 * w, y0 * h, x1 * w, y1 * h);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else if (m.kind === "radial") {
    const { cx, cy, rx, ry, feather } = m.round;
    ctx.translate(cx * w, cy * h);
    ctx.scale(Math.max(1, rx * w), Math.max(1, ry * h));
    const g = ctx.createRadialGradient(0, 0, Math.max(0, 1 - feather / 100) * 0.999, 0, 0, 1);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    const pic = m.maskId && getPicture(m.maskId);
    if (!pic) { if (m.maskId) loadPicture(m.maskId).then((p) => { if (p) changed("view"); }); return null; }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(pic.full, 0, 0, w, h);
  }
  if (m.invert) {
    ctx.globalCompositeOperation = "xor";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
  }
  return c;
}

// The fix laid onto `base` (a canvas, changed in place) through the mask: `fixed` is the whole picture with the fix
export function layThrough(base, fixed, mask) {
  const t = document.createElement("canvas");
  t.width = base.width; t.height = base.height;
  const ctx = t.getContext("2d");
  ctx.drawImage(fixed, 0, 0, t.width, t.height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(mask, 0, 0, t.width, t.height);
  base.getContext("2d").drawImage(t, 0, 0);
}

// Every picture the masks use (to load, save in the project folder, export)
export const maskPictureIds = (layer) => ((layer && layer.masks) || []).map((m) => m.maskId).filter(Boolean);
