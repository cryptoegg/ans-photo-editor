// The app's live state: the open project, which slides are selected, what's on screen, and
// undo / redo (whole copies of the project record). Everything that changes calls changed();
// listeners redraw. A finished change (a drag let go, a slider let go, a click) is commit()ed:
// one undo step, and the project is saved soon after.
import { newProject, tidyProject, clone, activeSet, setActiveItems, allLists } from './project.js';

const UNDO_KEPT = 100;
const listeners = new Set();

export const state = {
  project: newProject(),
  selected: new Set(),    // item ids: what the Filters / Adjust panels change
  current: null,          // the item id on the canvas (and the one Crop and Text change)
  textId: null,           // the text picked on the canvas, or null
  photoPicked: false,     // a photo picked on the canvas (its frame and handles show)
  layerId: null,          // which layer of the slide is picked (null: the slide's own photo);
                          // Filters, Adjust and Crop work on it
  view: "edit",           // "edit" | "phone"
  phonePlatform: "instagram", // (the app the set is shown as: project.stage, Phone view)
  phoneSlide: 0,          // the slide the phone shows (0-based)
  phoneScreen: "feed",    // "feed" (the post in the feed) | "profile" (on your profile page)
  tab: "filters",         // (old: the Editor's tabs; gone 2026-11-23)
  lib: "media",           // the left rail's library: media, filters, tools, captions
  before: false,          // \ held: the photos without their look
  maskId: null,           // the mask picked in Adjust → Masks (js/masks.js): its settings show, its handles on the canvas
  tool: null              // a brush in hand (js/ui/brush.js): "edge" (the cut-out's edge) | "heal" (spot heal) | null
};

let undoStack = [];
let redoStack = [];
// The record as text, for undo steps (without its "last changed" time, which isn't an edit)
const snap = (p) => JSON.stringify(p, (key, value) => (key === "updated" ? undefined : value));
let lastSaved = snap(state.project); // the record as of the last commit
// History (Tom, 2026-11-23, as Photoshop's): every step named by what it changed; each undo / redo entry is { json, label, time }
let nowLabel = "Opened", nowTime = Date.now();
const NAMES = [
  [/\.preset$|\.strength$/, "Filter"], [/look\.chain/, "Effects"], [/look\.light/, "Light"], [/look\.(colour|curves|grade|hsl|lut)/, "Colour"],
  [/look\.skin/, "Skin"], [/masks/, "Mask"], [/retouch/, "Touch-up"], [/cutout/, "Background removed"], [/crop\.(x|y)$/, "Move"],
  [/crop\.(zoom|stretch)/, "Size"], [/crop\.rotation/, "Turn"], [/crop\.(trim|flip)/, "Crop"], [/crop\.(vertical|horizontal)/, "Perspective"], [/crop/, "Crop"],
  [/style\.(opacity|blend)/, "Opacity"], [/style/, "Photo style"], [/texts.*\.(x|y)$/, "Move"], [/texts.*\.(size|aspect)$/, "Size"],
  [/texts.*\.rotation$/, "Turn"], [/texts.*\.content$/, "Text"], [/texts.*\.hidden$|\.hidden$/, "Hide / show"], [/\.locked$/, "Lock"],
  [/\.name$/, "Rename"], [/\.group$/, "Group"], [/texts/, "Caption / shape"], [/layers/, "Layers"], [/background$/, "Background"],
  [/set\.ratio/, "Shape of the set"], [/set\.items$/, "Slides"], [/span/, "Panorama"], [/name$/, "Name"]
];
function firstDiff(a, b, path = "") {
  if (a === b) return null;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return path;
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return path;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], `${path}.${k}`); if (d !== null) return d; }
  return null;
}
function describe(before, after) {
  try {
    const A = JSON.parse(before), B = JSON.parse(after);
    const path = firstDiff(A, B) || ""; // (e.g. .set.items.0.look.light.exposure)
    if (/texts$/.test(path)) {
      // (a caption or shape added or deleted: which)
      const at = (o) => path.split(".").slice(1).reduce((x, k) => (x ? x[k] : x), o) || [];
      const a = at(A), b = at(B), more = b.length > a.length;
      const t = (more ? b.find((x) => !a.some((y) => y.id === x.id)) : a.find((x) => !b.some((y) => y.id === x.id))) || {};
      return `${more ? "New" : "Deleted"} ${t.kind === "shape" ? "shape" : "caption"}`;
    }
    return (NAMES.find(([re]) => re.test(path)) || [, "Change"])[1];
  } catch (err) { return "Change"; }
}
// [{ label, time, now }] oldest first, the one showing marked now
export function historyList() {
  return [...undoStack.map((e) => ({ label: e.label, time: e.time })), { label: nowLabel, time: nowTime, now: true }, ...[...redoStack].reverse().map((e) => ({ label: e.label, time: e.time }))];
}
// Go to step i of historyList(): undo or redo until it's showing
export function historyGo(i) {
  const at = undoStack.length;
  if (i < at) for (let k = 0; k < at - i; k++) undo();
  else for (let k = 0; k < i - at; k++) redo();
}

export const onChange = (fn) => listeners.add(fn);

// Something changed: what = "project" (the record), "selection", "view" or "look" (only how it
// looks, mid-drag / mid-slide)
export function changed(what = "project") {
  listeners.forEach((fn) => { try { fn(what); } catch (err) { console.error(err); } });
}

export const project = () => state.project;
// The slides being edited: the one set
export const items = () => activeSet(state.project).items;
export const setItems = (list) => setActiveItems(state.project, list);
export const itemById = (id) => items().find((i) => i.id === id) || null;
export const currentItem = () => itemById(state.current);
export const selectedItems = () => items().filter((i) => state.selected.has(i.id));

// One undo step for everything changed since the last one
export function commit() {
  const now = snap(state.project);
  if (now === lastSaved) return;
  undoStack.push({ json: lastSaved, label: nowLabel, time: nowTime });
  if (undoStack.length > UNDO_KEPT) undoStack.shift();
  redoStack = [];
  nowLabel = describe(lastSaved, now); nowTime = Date.now();
  lastSaved = now;
  state.project.updated = Date.now();
  changed("commit");
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function undo() {
  commit(); // (anything half-done becomes its own step first)
  if (!undoStack.length) return;
  redoStack.push({ json: lastSaved, label: nowLabel, time: nowTime });
  const e = undoStack.pop();
  nowLabel = e.label; nowTime = e.time;
  restore(e.json);
}
export function redo() {
  if (!redoStack.length) return;
  undoStack.push({ json: lastSaved, label: nowLabel, time: nowTime });
  const e = redoStack.pop();
  nowLabel = e.label; nowTime = e.time;
  restore(e.json);
}
function restore(json) {
  lastSaved = json;
  state.project = tidyProject(JSON.parse(json));
  state.project.updated = Date.now();
  tidySelection();
  changed("project");
  changed("commit");
}

// Open a project (a fresh start for undo / redo)
export function openProject(p) {
  state.project = tidyProject(clone(p));
  undoStack = [];
  redoStack = [];
  nowLabel = "Opened"; nowTime = Date.now();
  lastSaved = snap(state.project);
  state.selected = new Set();
  state.current = null;
  state.textId = null;
  state.phoneSlide = 0;
  tidySelection();
  changed("project");
}

// Keep the selection pointing at items that exist (after undo, delete…)
export function tidySelection() {
  const list = items();
  const ids = new Set(list.map((i) => i.id));
  state.selected = new Set([...state.selected].filter((id) => ids.has(id)));
  if (!ids.has(state.current)) state.current = list[0] ? list[0].id : null;
  if (state.current && !state.selected.size) state.selected.add(state.current);
  const item = currentItem();
  if (!item || !item.texts.some((t) => t.id === state.textId)) state.textId = null;
  if (!item || !(item.layers || []).some((l) => l.id === state.layerId)) state.layerId = null;
}

// The picked layer of the slide on the canvas: one of its extra layers, or the slide itself
export function currentLayer() {
  const item = currentItem();
  if (!item) return null;
  return (state.layerId && (item.layers || []).find((l) => l.id === state.layerId)) || item;
}

// Select one item (click), add / remove one (⌘-click), or a run of them (shift-click)
export function select(id, how = "one") {
  const list = items().map((i) => i.id);
  if (how === "toggle") {
    if (state.selected.has(id) && state.selected.size > 1) {
      state.selected.delete(id);
      if (state.current === id) state.current = [...state.selected][0];
    } else { state.selected.add(id); state.current = id; }
  } else if (how === "range" && state.current) {
    const a = list.indexOf(state.current), b = list.indexOf(id);
    const [from, to] = a < b ? [a, b] : [b, a];
    state.selected = new Set(list.slice(from, to + 1));
    state.current = id;
  } else {
    state.selected = new Set([id]);
    state.current = id;
  }
  if (state.textId && !(currentItem() && currentItem().texts.some((t) => t.id === state.textId))) state.textId = null;
  state.layerId = null;
  changed("selection");
}

export function selectAll() {
  state.selected = new Set(items().map((i) => i.id));
  changed("selection");
}
