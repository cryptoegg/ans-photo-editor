// The project record: everything about one set of slides, in one plain object, so undo / redo
// are copies of it and saving is writing it out. New settings go in the record, never in loose
// variables.
//
//   project = {
//     id, name, created, updated, seed,
//     items: [item],                 the filmstrip, in swipe order (see below)
//     captions: { instagram, tiktok, youtube },
//     tiktok: { fill: "colour" | "blur" | "title", colour, title, titleColour }
//   }
//   item = {                         one photo; a panorama is one item covering `span` slides
//     id, mediaId, span,
//     crop: { x, y, zoom, stretch, lockRatio, rotation, flipH, flipV },
//                                    where the photo sits, free like the lyric app's pictures:
//                                    x / y its middle, off the frame's middle (frame widths /
//                                    heights); zoom 1 = just fills the frame upright ("Fill"),
//                                    smaller shows the background; stretch = extra width (Lock
//                                    ratio off); rotation in degrees
//     background,                    the colour wherever the photo doesn't cover (white)
//     look: { preset, chain, strength, light: {…}, colour: {…} },
//                                    preset: the filter picked (an id, js/filters.js); chain: this
//                                    slide's own copy of that filter's effects, edited freely
//                                    ([{ id, type, on, …settings }]; null = the filter as it comes)
//     lookGroup, ownLook,            slides with the same lookGroup on different platforms share
//                                    one look (js/state.js keeps them the same), unless ownLook
//     texts: [text]
//   }
//   text = { id, content, font, weight, size, colour, align, bubble, bubbleColour, stroke,
//            strokeColour, rotation, x, y }
//                                    size: a share of the frame's height; x / y: its middle,
//                                    from the frame's top-left, in frame widths / heights;
//                                    align: left | center | right | justify; bubble: none | box |
//                                    rounded | pill | outline | lines (around each line's words);
//                                    stroke: an outline round the letters, 0 - 20 (% of the size)
//
// Linked (the start): one square set that suits Instagram, TikTok (with a fill around the
// square) and YouTube alike, at most 10 slides: project.items.
// Linked off: each platform is its own stage, project.stages[platform] = { ratio, items }, with
// its own shape, slides, crops, panoramas and texts (made from the square set the first time; kept
// when you switch back). Looks stay shared across platforms unless a slide has its own.
export const MAX_SLIDES = 10;
export const RATIOS = { "1:1": [1, 1], "4:5": [4, 5], "3:4": [3, 4], "1.91:1": [1.91, 1], "9:16": [9, 16], "16:9": [16, 9] };
// The shapes each platform takes for sure (checked October 2026):
//   Instagram  4:5, 1:1, 1.91:1 (always), 3:4 (the app, since May 2025; tools posting through
//              Meta's API may still crop it to 4:5)
//   TikTok     9:16 (full screen), 4:5, 1:1; 4:5 and 1:1 go out as 9:16 with the fill round
//              them, so TikTok always gets a full-screen picture
//   YouTube    1:1, 4:5, 16:9 (its help suggests 1:1; the feed shows 4:5 and 16:9 posts too),
//              up to 10 images
// Linked: 1:1 or 4:5, the two shapes all three show in full (TikTok with the fill)
export const LINKED_RATIOS = ["1:1", "4:5"];
export const STAGES = {
  instagram: { ratios: ["4:5", "3:4", "1:1", "1.91:1"], ratio: "4:5", max: 20 },
  tiktok: { ratios: ["9:16", "4:5", "1:1"], ratio: "9:16", max: 35 },
  youtube: { ratios: ["1:1", "4:5", "16:9"], ratio: "1:1", max: 10 }
};
export const RATIO_NAMES = { "1:1": "1:1", "4:5": "4:5", "3:4": "3:4", "1.91:1": "1.91:1", "9:16": "9:16", "16:9": "16:9" };
// (TikTok: a shape other than 9:16 goes out on a 9:16 frame with the fill)
export const tiktokFilled = (ratio) => ratio !== "9:16";
// A shape's width over its height
export const aspectOf = (ratio) => { const [w, h] = RATIOS[ratio] || [1, 1]; return w / h; };
export const PLATFORMS = [
  { id: "instagram", label: "Instagram", post: "Carousel", captionLimit: 2200 },
  { id: "tiktok", label: "TikTok", post: "Photo post", captionLimit: 4000 },
  { id: "youtube", label: "YouTube", post: "Post", captionLimit: null }
];

export const LIGHT_DEFAULTS = () => ({ exposure: 0, contrast: 0, highlights: 0, shadows: 0, fade: 0, detail: 0 });
export const COLOUR_DEFAULTS = () => ({ mono: false, temperature: 0, tint: 0, saturation: 0, vibrance: 0 });
export const lookDefaults = () => ({ preset: null, chain: null, strength: 100, light: LIGHT_DEFAULTS(), colour: COLOUR_DEFAULTS() });
export const cropDefaults = () => ({ x: 0, y: 0, zoom: 1, stretch: 1, lockRatio: true, rotation: 0, flipH: false, flipV: false });
export const BACKGROUND = "#ffffff";
export const TEXT_DEFAULTS = () => ({ content: "", font: "Helvetica", weight: 400, size: 0.06, colour: "#ffffff", align: "center", bubble: "none", bubbleColour: "#111111", stroke: 0, strokeColour: "#000000", rotation: 0, x: 0.5, y: 0.5 });

const newId = (kind) => `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
export { newId };

export function newProject(name = "Untitled") {
  const now = Date.now();
  return {
    version: 1, id: newId("p"), name, created: now, updated: now,
    seed: Math.floor(Math.random() * 2147483647),
    items: [],
    linked: true, linkedRatio: "1:1", stage: "instagram", stages: null,
    captions: { instagram: "", tiktok: "", youtube: "" },
    tiktok: { fill: "blur", colour: "#111111", title: "", titleColour: "#ffffff" }
  };
}

// kind "video": an Instagram carousel clip, with trim { start, end } (seconds into the clip; at
// most 60 s long), cover (the moment used as its still: thumbnails, and TikTok / YouTube while
// Linked) and muted
export const VIDEO_MAX = 60, VIDEO_MIN = 3;
export function newItem(mediaId, kind = "photo", duration = 0) {
  const id = newId("s");
  const item = { id, mediaId, kind, span: 1, crop: cropDefaults(), background: BACKGROUND, look: lookDefaults(), lookGroup: id, ownLook: false, texts: [] };
  if (kind === "video") Object.assign(item, { trim: { start: 0, end: Math.min(duration || VIDEO_MAX, VIDEO_MAX) }, cover: 0, muted: false });
  return item;
}
export const isVideo = (item) => item && item.kind === "video";
// Which sets can hold a video: the Linked set and Instagram's (TikTok photo posts and YouTube
// posts take pictures only)
export const takesVideo = (platform) => !platform || platform === "instagram";

// ---- The set being edited: the square set (Linked) or the current platform's stage

// { items, ratio, max, platform } (platform null = Linked)
export function activeSet(p) {
  if (p.linked || !p.stages) return { items: p.items, ratio: linkedRatio(p), max: MAX_SLIDES, platform: null };
  return setFor(p, p.stage);
}
// The set a platform posts: its stage, or the square set while Linked
export function setFor(p, platform) {
  if (p.linked || !p.stages || !p.stages[platform]) return { items: p.items, ratio: linkedRatio(p), max: MAX_SLIDES, platform: p.linked ? null : platform };
  const stage = p.stages[platform];
  return { items: stage.items, ratio: stage.ratio, max: STAGES[platform].max, platform };
}
export const linkedRatio = (p) => (LINKED_RATIOS.includes(p.linkedRatio) ? p.linkedRatio : "1:1");
export function setActiveItems(p, list) {
  if (p.linked || !p.stages) p.items = list; else p.stages[p.stage].items = list;
}
// Every list of slides in the record (the square set and each stage)
export const allLists = (p) => [p.items, ...(p.stages ? Object.values(p.stages).map((s) => s.items) : [])];

// Older or partly-written records filled in with today's settings (in place)
export function tidyProject(p) {
  p.items = Array.isArray(p.items) ? p.items : [];
  p.linked = p.linked !== false;
  p.stage = STAGES[p.stage] ? p.stage : "instagram";
  if (p.stages) Object.keys(STAGES).forEach((k) => {
    const st = p.stages[k] || { items: [] };
    st.ratio = STAGES[k].ratios.includes(st.ratio) ? st.ratio : STAGES[k].ratio;
    st.items = Array.isArray(st.items) ? st.items : [];
    p.stages[k] = st;
  });
  allLists(p).flat().forEach((item) => {
    item.span = Math.max(1, Math.round(item.span || 1));
    item.crop = { ...cropDefaults(), ...(item.crop || {}) };
    const look = item.look || {};
    item.look = { ...lookDefaults(), ...look, light: { ...LIGHT_DEFAULTS(), ...(look.light || {}) }, colour: { ...COLOUR_DEFAULTS(), ...(look.colour || {}) } };
    if (item.look.chain !== undefined && !Array.isArray(item.look.chain)) item.look.chain = null;
    item.lookGroup = item.lookGroup || item.id;
    item.ownLook = !!item.ownLook;
    item.kind = item.kind === "video" ? "video" : "photo";
    if (item.kind === "video") {
      item.trim = { start: 0, end: VIDEO_MAX, ...(item.trim || {}) };
      item.cover = Number.isFinite(item.cover) ? item.cover : item.trim.start;
      item.muted = !!item.muted;
      item.span = 1;
    }
    item.background = item.background || BACKGROUND;
    item.texts = (Array.isArray(item.texts) ? item.texts : []).map((t) => ({ ...TEXT_DEFAULTS(), ...t }));
  });
  p.captions = { instagram: "", tiktok: "", youtube: "", ...(p.captions || {}) };
  p.tiktok = { fill: "blur", colour: "#111111", title: "", titleColour: "#ffffff", ...(p.tiktok || {}) };
  return p;
}

export const slideCount = (p, set = activeSet(p)) => set.items.reduce((n, item) => n + item.span, 0);

// The slide number (1-based) an item starts on
export function firstSlideOf(p, item, set = activeSet(p)) {
  let n = 1;
  for (const other of set.items) { if (other === item || other.id === item.id) return n; n += other.span; }
  return n;
}

// "Slide 3" or "Slides 3–5"
export function slideLabel(p, item) {
  const first = firstSlideOf(p, item);
  return item.span > 1 ? `Slides ${first}–${first + item.span - 1}` : `Slide ${first}`;
}

// Every slide in swipe order: [{ item, piece }] (piece: which square of a panorama)
export function slides(p, set = activeSet(p)) {
  const list = [];
  set.items.forEach((item) => { for (let piece = 0; piece < item.span; piece++) list.push({ item, piece }); });
  return list;
}

// Whether a slide has anything changed from how it came in (the dot in the filmstrip)
export function isEdited(item) {
  const plain = lookDefaults(), crop = cropDefaults();
  return item.texts.length > 0 || item.look.preset !== null || item.background !== BACKGROUND ||
    Object.keys(plain.light).some((k) => item.look.light[k] !== plain.light[k]) ||
    Object.keys(plain.colour).some((k) => item.look.colour[k] !== plain.colour[k]) ||
    Object.keys(crop).some((k) => item.crop[k] !== crop[k]);
}

export const clone = (value) => JSON.parse(JSON.stringify(value));
