// A slide's look: its own Light and Colour adjustments, then a filter (a ready-made chain of
// effects from js/effects/presets.js) at a strength. Worked out on the graphics card
// (js/effects/gl.js) on the whole photo, and kept, so moving or zooming the photo never works it
// out again. No graphics card: the plain photo is used.
import { runChain, available } from './effects/gl.js';
import { getEffect } from './effects/registry.js';
import { freshChain } from './filters.js';
import { getPicture, stillAt } from './media.js';
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
  return quality === "full" ? picture.full : picture.preview;
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
export function lookedPicture(item, quality = "preview", seed = 0) {
  const source = sourceOf(item, quality);
  if (!source) return null;
  if (!hasLook(item.look) || !available()) return source;
  const look = item.look;
  const key = JSON.stringify([item.mediaId, item.kind === "video" ? item.cover : 0, source.width, quality, seed, look.preset, look.preset ? look.chain : null, look.preset ? look.strength : 0, look.light, look.colour]);
  const found = find(quality, key);
  if (found) return found;
  let result;
  try { result = applyLook(item, source, `${item.mediaId}@${quality}`, seed); }
  catch (err) { console.error("The look couldn't be drawn:", err); return source; }
  keep(quality, key, result);
  return result;
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
export function presetSwatch(mediaId, presetId, seed, side = 120) {
  const key = JSON.stringify(["swatch", mediaId, presetId, side]);
  const found = find("swatch", key);
  if (found) return found;
  const picture = getPicture(mediaId);
  if (!picture) return null;
  const square = document.createElement("canvas");
  square.width = square.height = side;
  const s = Math.min(picture.preview.width, picture.preview.height);
  square.getContext("2d").drawImage(picture.preview, (picture.preview.width - s) / 2, (picture.preview.height - s) / 2, s, s, 0, 0, side, side);
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
