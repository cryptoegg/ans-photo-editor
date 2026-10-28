// The filmstrip: the slides in swipe order. Click to edit one, ⇧-click a run, ⌘-click to add or
// take one away (what's outlined is what Filters / Adjust change). Drag to reorder. A panorama
// shows as one joined block. A dot marks slides with edits.
import { state, select, onChange, items } from '../state.js';
import { slideCount, firstSlideOf, isEdited, activeSet, aspectOf, isVideo } from '../project.js';
import { drawItem } from '../render.js';
import { getPicture, loadPicture, stillsMade } from '../media.js';
import { moveItems, addFiles } from '../actions.js';

const HEIGHT = 88;
const thumbs = new Map(); // item id -> { key, canvas }
let strip = null;
let dragIds = null;

export function initFilmstrip() {
  strip = document.getElementById("filmstrip");
  onChange((what) => { if (what !== "view") redraw(); });
  strip.addEventListener("dragover", (e) => {
    e.preventDefault();
    const target = e.target.closest(".thumb");
    strip.querySelectorAll(".drop-before, .drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
    if (target && dragIds) {
      const r = target.getBoundingClientRect();
      target.classList.add(e.clientX < r.left + r.width / 2 ? "drop-before" : "drop-after");
    }
  });
  strip.addEventListener("dragleave", (e) => { if (!strip.contains(e.relatedTarget)) clearMarks(); });
  strip.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length && !dragIds) { clearMarks(); addFiles(e.dataTransfer.files); return; }
    if (!dragIds) return;
    const target = e.target.closest(".thumb");
    let beforeId = null;
    if (target) {
      const r = target.getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) beforeId = target.dataset.id;
      else { const next = target.nextElementSibling; beforeId = next && next.classList.contains("thumb") ? next.dataset.id : null; }
    }
    const ids = dragIds;
    dragIds = null;
    clearMarks();
    moveItems(ids, beforeId);
  });
  redraw();
}

function clearMarks() {
  strip.querySelectorAll(".drop-before, .drop-after, .dragging").forEach((el) => el.classList.remove("drop-before", "drop-after", "dragging"));
}

let pending = false;
function redraw() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; build(); });
}

function build() {
  const p = state.project;
  const set = activeSet(p);
  const a = aspectOf(set.ratio);
  const ratio = window.devicePixelRatio || 1;
  strip.innerHTML = "";
  set.items.forEach((item) => {
    const el = document.createElement("div");
    el.className = "thumb";
    el.dataset.id = item.id;
    el.draggable = true;
    el.classList.toggle("selected", state.selected.has(item.id));
    el.classList.toggle("current", state.current === item.id);
    el.title = item.span > 1 ? `Slides ${firstSlideOf(p, item)}–${firstSlideOf(p, item) + item.span - 1}: one panorama` : `Slide ${firstSlideOf(p, item)}`;
    el.append(thumbFor(item, ratio, a));
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = item.span > 1 ? `${firstSlideOf(p, item)}–${firstSlideOf(p, item) + item.span - 1}` : String(firstSlideOf(p, item));
    el.append(num);
    if (item.span > 1) el.append(Object.assign(document.createElement("span"), { className: "pano-tag", textContent: "Panorama" }));
    if (isEdited(item)) el.append(Object.assign(document.createElement("span"), { className: "dot", title: "Edited" }));
    if (isVideo(item)) el.append(Object.assign(document.createElement("span"), { className: "vid", textContent: `▶ ${(item.trim.end - item.trim.start).toFixed(1)} s` }));
    el.addEventListener("click", (e) => select(item.id, e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : "one"));
    el.addEventListener("dragstart", (e) => {
      dragIds = state.selected.has(item.id) ? set.items.filter((i) => state.selected.has(i.id)).map((i) => i.id) : [item.id];
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragIds.join(","));
      requestAnimationFrame(() => el.classList.add("dragging"));
    });
    el.addEventListener("dragend", () => { dragIds = null; clearMarks(); });
    strip.append(el);
  });
  if (slideCount(p) < set.max) {
    const add = document.createElement("button");
    add.className = "add-tile";
    add.textContent = "＋";
    add.title = "Add photos";
    add.onclick = () => document.getElementById("file-input").click();
    strip.append(add);
  }
  const count = document.getElementById("slide-count");
  count.textContent = `${slideCount(p)} of ${set.max}`;
  count.classList.toggle("full", slideCount(p) >= set.max);
  // (the dead ones go)
  const ids = new Set(set.items.map((i) => i.id));
  [...thumbs.keys()].forEach((id) => { if (!ids.has(id)) thumbs.delete(id); });
}

// The item's little picture, drawn again only when it changed
function thumbFor(item, ratio, a) {
  const media = [item.mediaId, ...((item.layers || []).map((l) => l.mediaId))];
  const loaded = media.every((id) => getPicture(id));
  const key = JSON.stringify([item.mediaId, item.span, item.crop, item.background, item.look, item.texts, item.layers, item.layout, item.style, loaded, ratio, a, item.cover, stillsMade]);
  const kept = thumbs.get(item.id);
  if (kept && kept.key === key) return kept.canvas;
  const canvas = document.createElement("canvas");
  canvas.height = Math.round(HEIGHT * ratio);
  canvas.width = Math.round(canvas.height * a * item.span);
  canvas.style.height = `${HEIGHT}px`;
  canvas.style.width = `${HEIGHT * a * item.span}px`;
  const ctx = canvas.getContext("2d");
  if (loaded) {
    drawItem(ctx, item, canvas.width, canvas.height, { seed: state.project.seed });
    // the cuts between a panorama's slides
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.setLineDash([3 * ratio, 3 * ratio]);
    const pw = canvas.width / item.span;
    for (let k = 1; k < item.span; k++) { ctx.beginPath(); ctx.moveTo(Math.round(k * pw) + 0.5, 0); ctx.lineTo(Math.round(k * pw) + 0.5, canvas.height); ctx.stroke(); }
  } else {
    Promise.all(media.map((id) => loadPicture(id))).then(() => redraw());
  }
  thumbs.set(item.id, { key, canvas });
  return canvas;
}
