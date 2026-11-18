// A slide's look: its own Light and Colour adjustments, then a filter (a ready-made chain of
// effects from js/effects/presets.js) at a strength. Worked out on the graphics card
// (js/effects/gl.js) on the whole photo, and kept, so moving or zooming the photo never works it
// out again. No graphics card: the plain photo is used.
import { runChain, available } from './effects/gl.js';
import { getEffect } from './effects/registry.js';
import { freshChain } from './filters.js';
import { getPicture, loadPicture, stillAt } from './media.js';
import { changed } from './state.js';

// Finished looks by key, most recently used last: on-screen ones (a few per slide, so undo and
// switching back are instant), export ones (one or two: they're big) and filter swatches
const kept = { preview: new Map(), full: new Map(), swatch: new Map() };
const KEEP = { preview: 24, full: 2, swatch: 300 };
function keep(kind, key, value) {
  const map = kept[kind];
  map.set(key, value);
  while (map.size > KEEP[kind]) map.delete(map.keys().next().value);
}
function find(kind, key) {
  const map = kept[kind];
  if (!map.has(key)) return null;
  const value = map.get(key);
  map.delete(key);
  map.set(key, value);
  return value;
}

const isZero = (obj) => Object.values(obj).every((v) => !v);

// The steps of a look: { adjust: [...], filter: [...] }, each step { effect, settings, seed }
function stepsOf(look, seed) {
  const step = (type, settings) => {
    const effect = getEffect(type);
    return effect ? { effect, settings: { ...effect.defaults(), ...settings }, seed: mix(seed, type) } : null;
  };
  const adjust = [];
  if (!isZero(look.light)) adjust.push(step("tone", look.light));
  if (!isZero(look.colour)) adjust.push(step("colour", look.colour));
  const chain = look.preset ? (look.chain || freshChain(look.preset)) : [];
  const filter = look.strength > 0 ? chain.filter((fx) => fx.on !== false).map(({ type, ...settings }) => step(type, settings)).filter(Boolean) : [];
  return { adjust: adjust.filter(Boolean), filter };
}

// Whether a look changes the photo at all
export const hasLook = (look) => !!look.preset || !isZero(look.light) || !isZero(look.colour);

// The picture a slide starts from: the photo, or for a video the still at its cover moment
// (the first still while that one's being made)
function sourceOf(item, quality) {
  const picture = getPicture(item.mediaId);
  if (!picture) return null;
  if (picture.kind === "video") {
    const still = stillAt(item.mediaId, item.cover || 0, () => changed("view"));
    if (still) return quality === "full" ? still.full : still.preview;
  }
  return touchedUp(item, quality === "full" ? picture.full : picture.preview);
}

// The photo with its touch-ups (the Remove and Clone brushes, js/ui/brush.js) laid over it: item.retouch.tiles, each a
// small picture of the part one stroke changed ({ id, x, y, w, h } in the photo's own pixels), oldest first. Kept per
// picture and set of pieces, so it's laid on once. (An early version kept one photo-size picture: patchId.)
export function retouchKey(item) {
  const r = item.retouch;
  if (!r) return "";
  const ids = [...(r.patchId ? [r.patchId] : []), ...(r.tiles || []).map((t) => t.id)];
  return ids.map((id) => { const p = getPicture(id); return p ? `${id}@${p.rev || 0}` : `${id}?`; }).join(",");
}
const touched = new WeakMap(); // picture -> { key, canvas }
function touchedUp(item, picture) {
  const r = item.retouch;
  if (!r || (!r.patchId && !(r.tiles && r.tiles.length))) return picture;
  const photo = getPicture(item.mediaId);
  const missing = [...(r.patchId ? [r.patchId] : []), ...(r.tiles || []).map((t) => t.id)].filter((id) => !getPicture(id));
  if (missing.length) { Promise.all(missing.map((id) => loadPicture(id))).then(() => changed("view")); return picture; }
  const key = retouchKey(item);
  const was = touched.get(picture);
  if (was && was.key === key) return was.canvas;
  const canvas = document.createElement("canvas"); // (a new one each change: the cut-out keeps its own per picture)
  canvas.width = picture.width;
  canvas.height = picture.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(picture, 0, 0);
  ctx.imageSmoothingQuality = "high";
  if (r.patchId) ctx.drawImage(getPicture(r.patchId).full, 0, 0, canvas.width, canvas.height);
  const k = canvas.width / ((photo && photo.width) || canvas.width);
  (r.tiles || []).forEach((t) => ctx.drawImage(getPicture(t.id).full, t.x * k, t.y * k, t.w * k, t.h * k));
  touched.set(picture, { key, canvas });
  return canvas;
}

// Run a look on a picture: the adjustments, then the filter at its strength. Returns a canvas
// (made new, or `into` reused), or the source itself when nothing changes it.
function applyLook(item, source, keyBase, seed, into = null) {
  const look = item.look;
  const { adjust, filter } = stepsOf(look, mix(seed, item.mediaId));
  const run = (input, steps, name, fresh) => {
    if (!steps.length) return input;
    const out = runChain(`${keyBase}@${name}`, input, input.width, input.height, steps, { fresh });
    return out ? copyOf(out, out.width, out.height, name === "filter" && look.strength >= 100 ? into : null) : input;
  };
  const adjusted = run(source, adjust, "adjust", !!into);
  if (!filter.length) return adjusted === source || !into ? adjusted : copyOf(adjusted, adjusted.width, adjusted.height, into);
  const filtered = run(adjusted, filter, "filter", true);
  if (look.strength >= 100 || filtered === adjusted) return filtered;
  // In between: the filtered picture laid over the adjusted one at the strength
  const blend = copyOf(adjusted, filtered.width, filtered.height, into);
  const ctx = blend.getContext("2d");
  ctx.globalAlpha = Math.max(0, look.strength) / 100;
  ctx.drawImage(filtered, 0, 0, blend.width, blend.height);
  ctx.globalAlpha = 1;
  return blend;
}

// The slide's picture with its look: a canvas, or the plain picture when there's no look (or no
// graphics card). quality: "preview" (on screen) or "full" (export). Kept, so it's worked out once.
function lookedOnly(item, quality = "preview", seed = 0) {
  const source = sourceOf(item, quality);
  if (!source) return null;
  if (!hasLook(item.look) || !available()) return source;
  const look = item.look;
  const key = JSON.stringify([item.mediaId, retouchKey(item), item.kind === "video" ? item.cover : 0, source.width, quality, seed, look.preset, look.preset ? look.chain : null, look.preset ? look.strength : 0, look.light, look.colour]);
  const found = find(quality, key);
  if (found) return found;
  let result;
  try { result = applyLook(item, source, `${item.mediaId}@${quality}`, seed); }
  catch (err) { console.error("The look couldn't be drawn:", err); return source; }
  keep(quality, key, result);
  return result;
}

// The look without the cut-out (the edge brush shows the whole photo faintly under it)
export const lookedWhole = (item, quality = "preview", seed = 0) => lookedOnly(item, quality, seed);

// The slide's picture with its look, then its cut-out (js/cutout.js) when it has one switched on
export function lookedPicture(item, quality = "preview", seed = 0) {
  return cutOut(item, lookedOnly(item, quality, seed));
}

// A cut-out: the picture with its mask laid on (the background see-through). Kept per picture and mask, so
// moving the photo never works it out again. While the mask loads the whole photo shows.
const cut = new WeakMap(); // picture -> { key (mask and change), canvas }
function cutOut(item, picture) {
  const c = item.cutout;
  if (!picture || !c || !c.on || !c.maskId) return picture;
  const mask = getPicture(c.maskId);
  if (!mask) { loadPicture(c.maskId).then((m) => { if (m) changed("view"); }); return picture; }
  const key = `${c.maskId}@${mask.rev || 0}`;
  const was = cut.get(picture);
  if (was && was.key === key) return was.canvas;
  const canvas = document.createElement("canvas");
  canvas.width = picture.width;
  canvas.height = picture.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(picture, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(mask.full, 0, 0, canvas.width, canvas.height);
  cut.set(picture, { key, canvas });
  return canvas;
}

// One frame of a video (a canvas) with the slide's look, worked out fresh every time (playing,
// exporting); the result goes into one canvas kept per slide and quality
const frameCanvases = new Map();
export function lookedFrame(item, frame, quality = "preview", seed = 0) {
  if (!hasLook(item.look) || !available()) return frame;
  const k = `${item.id}@${quality}`;
  if (!frameCanvases.has(k)) frameCanvases.set(k, document.createElement("canvas"));
  try { return applyLook(item, frame, `${item.mediaId}@frame@${quality}`, seed, frameCanvases.get(k)); }
  catch (err) { console.error("The look couldn't be drawn:", err); return frame; }
}

// A small filter swatch: a little square of the photo with a preset on it (no adjustments)
// (the photo with its touch-ups: a word taken off shouldn't come back in the tiles)
export function presetSwatch(item, presetId, seed, side = 120) {
  const mediaId = item.mediaId;
  const key = JSON.stringify(["swatch", mediaId, retouchKey(item), presetId, side]);
  const found = find("swatch", key);
  if (found) return found;
  const picture = getPicture(mediaId);
  if (!picture) return null;
  const source = picture.kind === "video" ? picture.preview : touchedUp(item, picture.preview);
  const square = document.createElement("canvas");
  square.width = square.height = side;
  const s = Math.min(source.width, source.height);
  square.getContext("2d").drawImage(source, (source.width - s) / 2, (source.height - s) / 2, s, s, 0, 0, side, side);
  let result = square;
  if (presetId && available()) {
    const { filter } = stepsOf({ preset: presetId, strength: 100, light: {}, colour: {} }, mix(seed, mediaId));
    try {
      const out = runChain(`swatch@${mediaId}@${side}`, square, side, side, filter, { fresh: true });
      if (out) result = copyOf(out);
    } catch (err) { console.error(err); }
  }
  keep("swatch", key, result);
  return result;
}

function copyOf(source, width = source.width, height = source.height, into = null) {
  const c = into || document.createElement("canvas");
  if (c.width !== width) c.width = width;
  if (c.height !== height) c.height = height;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return c;
}

function mix(seed, text) {
  let h = 2166136261 ^ (seed >>> 0);
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
