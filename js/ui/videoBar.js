// The video bar, under the canvas while a video slide is on it: ▶ / ❚❚ (space), the trim strip
// (the whole clip; drag its two ends to choose the part that's posted, 3 to 60 s, which Instagram
// takes; click or drag inside to move the playhead), the cover moment (◆: the still used for
// thumbnails, and for TikTok and YouTube while Linked: "Set as cover"), and sound on / off.
// Playing loops the trimmed part, with the slide's look on every frame.
import { state, changed, commit, currentItem, onChange } from '../state.js';
import { isVideo, VIDEO_MAX, VIDEO_MIN } from '../project.js';
import { getPicture } from '../media.js';

let bar, redraw;
let playing = false;
let time = 0;          // the playhead, in seconds into the clip
let shownFor = null;   // the item id the bar was built for
let drag = null;
const frameCanvas = document.createElement("canvas");

export function initVideoBar(onFrame) {
  redraw = onFrame;
  bar = document.getElementById("video-bar");
  onChange(() => refresh());
  document.addEventListener("keydown", (e) => {
    if (e.key !== " " || !bar || bar.hidden || (e.target.closest && e.target.closest("input, textarea, select, button, [contenteditable]"))) return;
    e.preventDefault();
    toggle();
  });
  refresh();
}

const clip = () => { const item = currentItem(); return isVideo(item) && state.view === "edit" ? item : null; };
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

// The frame showing now (a canvas the video's size), or null to use the still
export function videoFrame(item) {
  const pic = getPicture(item.mediaId);
  if (!pic || pic.kind !== "video" || item.id !== shownFor) return null;
  const v = pic.player;
  if (v.readyState < 2) return null;
  if (frameCanvas.width !== pic.width) frameCanvas.width = pic.width;
  if (frameCanvas.height !== pic.height) frameCanvas.height = pic.height;
  frameCanvas.getContext("2d").drawImage(v, 0, 0, pic.width, pic.height);
  return frameCanvas;
}

export function stopVideo() {
  if (!shownFor) return;
  const pic = currentPic();
  if (pic && pic.player) pic.player.pause();
  playing = false;
}
function currentPic() { const item = clip(); return item ? getPicture(item.mediaId) : null; }

function refresh() {
  const item = clip();
  if (!item) {
    if (shownFor) { stopAll(); shownFor = null; }
    bar.hidden = true;
    return;
  }
  const pic = getPicture(item.mediaId);
  if (!pic) { bar.hidden = true; return; }
  if (shownFor !== item.id) {
    stopAll();
    shownFor = item.id;
    time = item.trim.start;
    seek(pic, time);
  }
  pic.player.muted = !!item.muted;
  bar.hidden = false;
  if (drag || bar.dataset.for === item.id) update(item, pic); else build(item, pic);
}

function stopAll() {
  document.querySelectorAll("video").forEach((v) => v.pause());
  playing = false;
}

function seek(pic, t) {
  const v = pic.player;
  v.currentTime = Math.max(0, Math.min(t, pic.duration - 0.001));
  v.addEventListener("seeked", () => redraw(), { once: true });
}

function toggle() {
  const item = clip();
  if (!item) return;
  const pic = getPicture(item.mediaId);
  if (playing) { pic.player.pause(); playing = false; time = pic.player.currentTime; refresh(); return; }
  if (time < item.trim.start || time >= item.trim.end - 0.05) { time = item.trim.start; pic.player.currentTime = time; }
  pic.player.muted = !!item.muted;
  pic.player.play().catch(() => { pic.player.muted = true; pic.player.play().catch(() => {}); }); // (sound may need a click first)
  playing = true;
  refresh();
  const tick = () => {
    if (!playing || clip() !== item) return;
    const v = pic.player;
    if (v.currentTime >= item.trim.end || v.ended) { v.currentTime = item.trim.start; if (v.paused) v.play().catch(() => {}); }
    time = v.currentTime;
    redraw();
    placeHead(item, pic);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---- The bar: built once per slide, then only its positions and labels change

function build(item, pic) {
  bar.dataset.for = item.id;
  bar.innerHTML = `
    <button class="btn ghost small vb-play" title="Play / pause (space)">▶</button>
    <span class="vb-time"></span>
    <div class="vb-track" title="Drag the ends to trim · click to move the playhead">
      <div class="vb-kept"><i class="vb-end start" data-end="start"></i><i class="vb-end end" data-end="end"></i></div>
      <i class="vb-cover" title="Cover: the still used for thumbnails (and TikTok / YouTube while Linked)">◆</i>
      <i class="vb-head"></i>
    </div>
    <span class="vb-len"></span>
    <button class="btn ghost small vb-sound"></button>
    <button class="btn ghost small vb-cover-btn" title="Use the frame at the playhead as the still">Set as cover</button>`;
  bar.querySelector(".vb-play").onclick = toggle;
  bar.querySelector(".vb-sound").onclick = () => { const it = clip(); if (!it) return; it.muted = !it.muted; pic.player.muted = it.muted; changed("project"); commit(); };
  bar.querySelector(".vb-cover-btn").onclick = () => { const it = clip(); if (!it) return; it.cover = Math.round(time * 10) / 10; changed("project"); commit(); };
  const track = bar.querySelector(".vb-track");
  const d = pic.duration || 1;
  const move = (e) => {
    const it = clip();
    if (!it) return;
    const r = track.getBoundingClientRect();
    const t = Math.max(0, Math.min(d, ((e.clientX - r.left) / r.width) * d));
    if (drag.end === "start") {
      it.trim.start = Math.min(t, it.trim.end - Math.min(VIDEO_MIN, d));
      if (it.trim.end - it.trim.start > VIDEO_MAX) it.trim.end = it.trim.start + VIDEO_MAX;
      time = it.trim.start;
    } else if (drag.end === "end") {
      it.trim.end = Math.max(t, it.trim.start + Math.min(VIDEO_MIN, d));
      if (it.trim.end - it.trim.start > VIDEO_MAX) it.trim.start = it.trim.end - VIDEO_MAX;
      time = Math.max(it.trim.start, it.trim.end - 0.04);
    } else time = t;
    seek(pic, time);
    update(it, pic);
  };
  track.onpointerdown = (e) => {
    track.setPointerCapture(e.pointerId);
    drag = { end: (e.target.dataset && e.target.dataset.end) || null };
    if (playing) { pic.player.pause(); playing = false; }
    move(e);
  };
  track.onpointermove = (e) => { if (drag) move(e); };
  track.onpointerup = () => {
    if (!drag) return;
    const trimmed = !!drag.end;
    drag = null;
    if (trimmed) { changed("project"); commit(); } else update(clip(), pic);
  };
  update(item, pic);
}

function update(item, pic) {
  if (!item) return;
  const d = pic.duration || 1;
  const pct = (s) => `${(Math.max(0, Math.min(d, s)) / d) * 100}%`;
  const length = item.trim.end - item.trim.start;
  const kept = bar.querySelector(".vb-kept");
  kept.style.left = pct(item.trim.start);
  kept.style.width = `${((item.trim.end - item.trim.start) / d) * 100}%`;
  bar.querySelector(".vb-cover").style.left = pct(item.cover);
  bar.querySelector(".vb-play").textContent = playing ? "❚❚" : "▶";
  const len = bar.querySelector(".vb-len");
  len.textContent = `${length.toFixed(1)} s`;
  len.title = length < VIDEO_MIN ? "Instagram wants clips of at least 3 seconds" : "The part that's posted (Instagram takes 3 to 60 s)";
  len.classList.toggle("over", length < VIDEO_MIN - 0.05);
  const sound = bar.querySelector(".vb-sound");
  sound.textContent = item.muted ? "🔇" : "🔊";
  sound.title = item.muted ? "Sound off (the export is silent)" : "Sound on";
  placeHead(item, pic);
}

function placeHead(item, pic) {
  const head = bar.querySelector(".vb-head"), label = bar.querySelector(".vb-time");
  if (head) head.style.left = `${(time / (pic.duration || 1)) * 100}%`;
  if (label) label.textContent = fmt(time);
}
