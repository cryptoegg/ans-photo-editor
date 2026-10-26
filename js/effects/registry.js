// The effect list. An image layer's `effects.chain` is a stack of these, applied top to
// bottom like a chain of guitar pedals (js/effects/chain.js). Each effect is one file in
// js/effects/ with:
//   type, label   - its id in the record, and its name in the panel
//   group         - its heading in the + Add effect menu (Colour, Light & blur, Texture…)
//   description   - one line saying what it does (on the Effects tab's Add page)
//   later         - (optional) true: being reworked, so left out of the menu (saved ones still draw)
//   only          - (optional) the layer types it's offered for, e.g. ["image"]
//   adjust        - (optional) true: in the Adjust section at the top (always on, no one slider)
//   inside        - (optional) the Adjust card it's shown inside (Colour tint: "colour")
//   defaults()    - its settings, with their starting values
//   videoDefaults() - (optional) the starting values that differ on a video / camera
//   controls      - what the panel shows for it, built from this list:
//                   { key, label, min, max, step } a slider,
//                   { key, label, kind: "colour" } a colour picker,
//                   { key, label, kind: "choice", options: [{ value, label }] } a dropdown,
//                   { key, label, kind: "toggle" } a tick box,
//                   { key, label, kind: "text" } a line of text;
//                   a slider with drives(settings, seed) also moves other settings (returns
//                   { key: value } to change, e.g. Screen's Wander)
//   migrate(settings) - (optional) bring settings saved by an older version up to date
//   moves(settings) - (optional) true when the look changes as the song plays (run.time: the
//                   moment of the song, in seconds); it's then worked out every frame
//   apply(settings, run) - its recipe on the graphics card: run.pass(recipe, textures,
//                   uniforms) draws one pass and returns the new picture; run.input is the
//                   picture so far, run.seed this effect's seed (see js/effects/gl.js for what a
//                   recipe can use)
// To add an effect: create its file and add it here.
import tone from './tone.js';
import tint from './tint.js';
import colour from './colour.js';
import solarise from './solarise.js';
import duotone from './duotone.js';
import negative from './negative.js';
import fisheye from './fisheye.js';
import bloom from './bloom.js';
import blur from './blur.js';
import grain from './grain.js';
import halftone from './halftone.js';
import ascii from './ascii.js';
import screen from './screen.js';
import paper from './paper.js';
import dust from './dust.js';
import leak from './leak.js';
import burn from './burn.js';
import vhs from './vhs.js';
import frame from './frame.js';
import liquify from './liquify.js';
import stretch from './stretch.js';
import slice from './slice.js';
import datamosh from './datamosh.js';
import melt from './melt.js';
import scan from './scan.js';
import disintegrate from './disintegrate.js';

// The one order effects are applied in (and listed in, on the Effects tab): colour first, then
// warps, light and blur, textures, and damage / the frame last (so the border sits on top).
// A layer's chain is always kept in this order, with at most one of each effect.
export const EFFECTS = [
  tone, colour, tint,                           // Adjust: Light, Colour (+ its Colour tint)
  duotone, negative, solarise,                  // colour effects
  fisheye, liquify, stretch, slice, datamosh, melt, scan, // warp
  blur, bloom, leak,                            // light & blur
  halftone, ascii, screen, paper, grain, dust,  // texture
  burn, vhs, frame,                             // damage & frames
  disintegrate                                  // last: the finished look crumbles away (pictures only)
];

// Where an effect type goes in that order
export function effectOrder(type) {
  const i = EFFECTS.findIndex((e) => e.type === type);
  return i < 0 ? EFFECTS.length : i;
}

export function getEffect(type) {
  return EFFECTS.find((e) => e.type === type) || null;
}

// An effect's starting settings on a layer of this type (videos and cameras have their own for some)
export function startingSettings(effect, layerType) {
  if (!effect) return {};
  const video = (layerType === "video" || layerType === "camera") && effect.videoDefaults;
  return { ...effect.defaults(), ...(video ? effect.videoDefaults() : {}) };
}
