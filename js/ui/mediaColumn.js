// The Media column (Style 2, as in the Lyric Visualiser): the project's photos and videos, three across, and
// your saved filters. Folding sections (Photos and Videos open, Your filters shut); the blue arrow at the top
// folds the whole column to a strip. Clicking a picture goes to the first slide using it; + adds photos or
// videos (the same as the slides strip's button); a filter goes onto the chosen slides.
import { state, onChange, items, select } from '../state.js';
import { allLists, layersOf } from '../project.js';
import { getPicture, loadPicture } from '../media.js';
import { myFilters } from '../filters.js';
import { lookItems, useFilter, buildLibrary } from './panel.js';

const $ = (id) => document.getElementById(id);
const FOLD_KEY = "ans_photo_media_folded";
const shut = { photos: false, videos: false, filters: true }; // (sections start like this every time)
const thumbs = new Map(); // mediaId -> canvas

export function initMediaColumn() {
  const col = $("media-col");
  let folded = false;
  try { folded = localStorage.getItem(FOLD_KEY) === "1"; } catch (e) {}
  setFolded(folded);
  col.addEventListener("click", (e) => { if (col.classList.contains("folded") && !e.target.closest(".col-fold")) setFolded(false); });
  // The left rail (Tom, 2026-11-23, as the Lyric Visualiser's): Media · Filters · Tools · Captions open here; the one
  // already open folds the column away, or opens it again
  document.querySelectorAll("#rail button").forEach((b) => b.addEventListener("click", () => {
    const shown = !col.classList.contains("folded");
    if (state.lib === b.dataset.lib) { setFolded(shown); build(); return; }
    state.lib = b.dataset.lib;
    if (!shown) setFolded(false);
    build();
  }));
  onChange((what) => { if (what !== "look") build(); });
  build();
}

function setFolded(on) {
  $("media-col").classList.toggle("folded", on);
  $("workspace").classList.toggle("no-media", on);
  try { localStorage.setItem(FOLD_KEY, on ? "1" : "0"); } catch (e) {}
  document.querySelectorAll("#rail button").forEach((b) => b.classList.toggle("on", !on && b.dataset.lib === state.lib)); // (folded: none lit)
  window.dispatchEvent(new Event("resize")); // (the canvas fits the new width)
}

// Every photo and video in the project (all platforms), once each, in the order they first appear
function mediaList() {
  const seen = new Map();
  allLists(state.project).flat().forEach((item) => layersOf(item).forEach((layer, i) => {
    if (!layer.mediaId || seen.has(layer.mediaId)) return;
    const video = i === 0 && item.kind === "video";
    seen.set(layer.mediaId, { id: layer.mediaId, video, seconds: video && item.trim ? item.trim.end - item.trim.start : 0 });
  }));
  return [...seen.values()];
}

const usedOn = (item, mediaId) => layersOf(item).some((l) => l.mediaId === mediaId);

const LIBS = { media: "Media", filters: "Filters", effects: "Effects", tools: "Tools", captions: "Captions", shapes: "Shapes", history: "History" };
let shownLib = null;

function build() {
  const col = $("media-col");
  if (!col) return;
  const lib = LIBS[state.lib] ? state.lib : "media";
  // (something picked elsewhere opened a library, like a brush picked in the tools row: the column opens to it)
  if (shownLib && lib !== shownLib && col.classList.contains("folded")) setFolded(false);
  document.querySelectorAll("#rail button").forEach((b) => b.classList.toggle("on", b.dataset.lib === lib && !col.classList.contains("folded")));
  const scroll = lib === shownLib ? col.scrollTop : 0;
  shownLib = lib;
  const media = mediaList();
  const photos = media.filter((m) => !m.video), videos = media.filter((m) => m.video);
  const current = items().find((i) => i.id === state.current);
  col.replaceChildren();

  const head = el("div", "col-head");
  // (as the Lyric Visualiser's, Tom 2026-11-23: the blue ‹ first, then the name: "‹ Filters"; it folds the column away)
  const fold = el("button", "col-fold");
  fold.type = "button";
  fold.title = "Fold this column";
  fold.setAttribute("aria-label", "Fold this column");
  fold.onclick = () => setFolded(!col.classList.contains("folded"));
  head.append(fold, el("span", "col-title", LIBS[lib]));
  col.append(head);
  if (lib !== "media") {
    const host = el("div", "lib-body panel"); // (".panel": the Editor's own look for sliders, switches and boxes)
    col.append(host);
    buildLibrary(host, lib);
    col.scrollTop = scroll;
    return;
  }

  col.append(section("photos", "Photos", photos.length, true, () => grid(photos, current)));
  col.append(section("videos", "Videos", videos.length, true, () => grid(videos, current)));
  const mine = myFilters();
  col.append(section("filters", "Your filters", mine.length, false, () => filterRows(mine)));
  col.scrollTop = scroll;
}

function section(key, name, count, canAdd, body) {
  const sec = el("section", "mc-sec" + (shut[key] ? " shut" : ""));
  const head = el("div", "mc-head");
  head.append(el("span", "chev"), el("span", "", name), el("span", "mc-n", String(count)));
  if (canAdd) {
    const plus = el("button", "mc-plus", "+");
    plus.type = "button";
    plus.title = `Add ${name.toLowerCase()}`;
    plus.onclick = (e) => { e.stopPropagation(); $("file-input").click(); };
    head.append(plus);
  }
  head.onclick = () => {
    shut[key] = !shut[key];
    build();
  };
  const content = el("div", "mc-body");
  if (!shut[key]) content.append(body());
  sec.append(head, content);
  return sec;
}

function grid(list, current) {
  const box = el("div", "mc-grid");
  list.forEach((m) => {
    const tile = el("button", "mc-tile" + (current && usedOn(current, m.id) ? " on" : ""));
    tile.type = "button";
    tile.append(thumb(m.id));
    if (m.video) tile.append(el("span", "len", clock(m.seconds)));
    tile.onclick = () => {
      const target = items().find((i) => usedOn(i, m.id));
      if (target) select(target.id);
    };
    box.append(tile);
  });
  const add = el("button", "mc-tile mc-add", "+");
  add.type = "button";
  add.title = "Add photos or videos";
  add.onclick = () => $("file-input").click();
  box.append(add);
  return box;
}

function thumb(mediaId) {
  let canvas = thumbs.get(mediaId);
  if (canvas && canvas.dataset.drawn) return canvas;
  if (!canvas) { canvas = document.createElement("canvas"); canvas.width = canvas.height = 180; thumbs.set(mediaId, canvas); }
  const draw = (pic) => {
    if (!pic || !pic.preview) return;
    const src = pic.preview, side = Math.min(src.width, src.height);
    canvas.getContext("2d").drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, 180, 180);
    canvas.dataset.drawn = "1";
  };
  const pic = getPicture(mediaId);
  if (pic) draw(pic); else loadPicture(mediaId).then(draw);
  return canvas;
}

function filterRows(list) {
  const box = el("div");
  if (!list.length) { box.append(el("p", "mc-empty", "None saved yet")); return box; }
  list.forEach((f) => {
    const row = el("div", "mc-file");
    row.title = `Put ${f.name} on the chosen slides`;
    row.append(el("span", "", f.name), el("span", "when", savedOn(f.id)));
    row.onclick = () => { const chosen = lookItems().filter(Boolean); if (chosen.length) useFilter(chosen, f.id); };
    box.append(row);
  });
  return box;
}

// (a saved filter's id is "my-" + the time it was saved)
function savedOn(id) {
  const t = parseInt(String(id).replace(/^my-/, ""), 36);
  if (!t) return "";
  return "Saved " + new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
