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
  phonePlatform: "instagram",
  phoneSlide: 0,          // the slide the phone shows (0-based)
  phoneScreen: "feed",    // "feed" (the post in the feed) | "profile" (on your profile page)
  tab: "filters",         // the panel's tab
  before: false           // \ held: the photos without their look
};

let undoStack = [];
let redoStack = [];
// The record as text, for undo steps (without its "last changed" time, which isn't an edit)
const snap = (p) => JSON.stringify(p, (key, value) => (key === "updated" ? undefined : value));
let lastSaved = snap(state.project); // the record as of the last commit

export const onChange = (fn) => listeners.add(fn);

// Something changed: what = "project" (the record), "selection", "view" or "look" (only how it
// looks, mid-drag / mid-slide)
export function changed(what = "project") {
  if (what === "look" || what === "project") shareSlides();
  listeners.forEach((fn) => { try { fn(what); } catch (err) { console.error(err); } });
}

export const project = () => state.project;
// The slides being edited: the current platform's stage
export const items = () => activeSet(state.project).items;
export const setItems = (list) => setActiveItems(state.project, list);
export const itemById = (id) => items().find((i) => i.id === id) || null;
export const currentItem = () => itemById(state.current);
export const selectedItems = () => items().filter((i) => state.selected.has(i.id));

// The same slide on the other platforms (the same lookGroup) follows the one being edited: its
// look always, and while that platform has the same shape, its crop, texts and layers too, so a
// set on one shape is edited once for all three. A slide with its own look (ownLook) on either
// side is left alone.
export const SAME_SHAPE_KEYS = ["mediaId", "crop", "texts", "layers", "layout", "style", "background"];
function shareSlides() {
  const p = state.project;
  const here = activeSet(p);
  const from = new Map();
  here.items.forEach((item) => { if (!item.ownLook) from.set(item.lookGroup, item); });
  if (!from.size) return;
  Object.values(p.stages).forEach((stage) => {
    if (stage.items === here.items) return;
    const sameShape = stage.ratio === here.ratio;
    stage.items.forEach((other) => {
      const source = from.get(other.lookGroup);
      if (!source || other.ownLook) return;
      const keys = sameShape && other.span === source.span && other.kind === source.kind ? ["look", ...SAME_SHAPE_KEYS] : ["look"];
      keys.forEach((k) => { if (JSON.stringify(other[k]) !== JSON.stringify(source[k])) other[k] = clone(source[k]); });
    });
  });
}

// One undo step for everything changed since the last one
export function commit() {
  const now = snap(state.project);
  if (now === lastSaved) return;
  undoStack.push(lastSaved);
  if (undoStack.length > UNDO_KEPT) undoStack.shift();
  redoStack = [];
  lastSaved = now;
  state.project.updated = Date.now();
  changed("commit");
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function undo() {
  commit(); // (anything half-done becomes its own step first)
  if (!undoStack.length) return;
  redoStack.push(lastSaved);
  restore(undoStack.pop());
}
export function redo() {
  if (!redoStack.length) return;
  undoStack.push(lastSaved);
  restore(redoStack.pop());
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
