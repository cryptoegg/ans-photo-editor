// Filters: the ready-made ones (js/effects/presets.js, from the lyric video app) and your own
// ("Save as my filter": kept in this browser, in every project). A filter is a chain of effects;
// picking one gives the slide its own copy of the chain (look.chain), so editing it changes
// only that slide (and the slides selected with it).
import { PRESETS, getPreset } from './effects/presets.js';
import { getEffect } from './effects/registry.js';
import { dbGet, dbPut } from './store.js';

let mine = []; // [{ id, name, note, chain }]

export async function loadMyFilters() {
  try { mine = (await dbGet("meta", "myFilters")) || []; } catch (err) { mine = []; }
}
export const myFilters = () => mine;

// (light / colour: the slide's own Adjust → Light and Colour, kept with it and put back on with it)
export async function saveMyFilter(name, chain, light = null, colour = null) {
  const filter = { id: `my-${Date.now().toString(36)}`, name: name.trim() || "My filter", note: "Your filter", chain: chain.map(({ id, ...rest }) => ({ ...rest })), light, colour };
  mine = [...mine, filter];
  await dbPut("meta", mine, "myFilters");
  return filter;
}
export async function deleteMyFilter(id) {
  mine = mine.filter((f) => f.id !== id);
  await dbPut("meta", mine, "myFilters");
}

export const getFilter = (id) => (id ? getPreset(id) || mine.find((f) => f.id === id) || null : null);
export const isMine = (id) => mine.some((f) => f.id === id);
export const filterName = (id) => { const f = getFilter(id); return f ? f.name : id ? "Custom" : "Original"; };

let counter = 0;
export const newEffectId = () => `fx-${Date.now().toString(36)}-${++counter}`;

// A fresh copy of a filter's chain, every setting filled in: [{ id, type, on, …settings }]
export function freshChain(filterId) {
  const filter = getFilter(filterId);
  if (!filter) return [];
  return filter.chain
    .filter((fx) => getEffect(fx.type))
    .map(({ type, on, ...settings }) => ({ id: newEffectId(), type, on: on !== false, ...getEffect(type).defaults(), ...settings }));
}

// A new effect for ＋ Add effect, with its starting settings
export function newEffect(type) {
  return { id: newEffectId(), type, on: true, ...getEffect(type).defaults() };
}

export { PRESETS };
