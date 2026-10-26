// A slide's look: its own Light and Colour adjustments, then a filter (a ready-made chain of
// effects from js/effects/presets.js) at a strength. Worked out on the graphics card
// (js/effects/gl.js) on the whole photo, and kept, so moving or zooming the photo never works it
// out again. No graphics card: the plain photo is used.
import { runChain, available } from './effects/gl.js';
import { getEffect } from './effects/registry.js';
import { freshChain } from './filters.js';
import { getPicture } from './media.js';

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

// The photo with its look: a canvas, or the plain picture when there's no look (or no
// graphics card). quality: "preview" (on screen) or "full" (export).
export function lookedPicture(item, quality = "preview", seed = 0) {
  const picture = getPicture(item.mediaId);
  if (!picture) return null;
  const source = quality === "full" ? picture.full : picture.preview;
  if (!hasLook(item.look) || !available()) return source;
  const look = item.look;
  const key = JSON.stringify([item.mediaId, quality, seed, look.preset, look.preset ? look.chain : null, look.preset ? look.strength : 0, look.light, look.colour]);
  const found = find(quality, key);
  if (found) return found;

  const lookSeed = mix(seed, item.mediaId);
  const { adjust, filter } = stepsOf(look, lookSeed);
  let result = source;
  try {
    const run = (input, steps, name) => {
      if (!steps.length) return input;
      const out = runChain(`${item.mediaId}@${quality}@${name}`, input, input.width, input.height, steps, { fresh: name !== "adjust" });
      return out ? copyOf(out) : input;
    };
    const adjusted = run(source, adjust, "adjust");
    result = adjusted;
    if (filter.length) {
      const filtered = run(adjusted, filter, "filter");
      if (look.strength >= 100 || filtered === adjusted) result = filtered;
      else {
        // In between: the filtered photo laid over the adjusted one at the strength
        const blend = copyOf(adjusted, filtered.width, filtered.height);
        const ctx = blend.getContext("2d");
        ctx.globalAlpha = Math.max(0, look.strength) / 100;
        ctx.drawImage(filtered, 0, 0, blend.width, blend.height);
        result = blend;
      }
    }
  } catch (err) {
    console.error("The look couldn't be drawn:", err);
    return source;
  }
  keep(quality, key, result);
  return result;
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

function copyOf(source, width = source.width, height = source.height) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  c.getContext("2d").drawImage(source, 0, 0, width, height);
  return c;
}

function mix(seed, text) {
  let h = 2166136261 ^ (seed >>> 0);
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
