// The Phone view: the set as a phone screen shows it in Instagram, TikTok or YouTube (dark mode,
// as the apps look today), with that app's buttons and text round it (drawn here as simple
// stand-ins: a close guide, not a copy of the apps). No phone outline, just the screen. Flick
// through with ← →, the arrows, or by dragging. Double-click a slide to edit it.
// Feed | Profile: Profile shows the post on your page: Instagram's and TikTok's 3-across grids of
// 3:4 tiles (the first slide, cropped to 3:4 from the middle) and YouTube's Posts tab.
import { state, changed, onChange, select } from '../state.js';
import { slides, setFor, aspectOf, tiktokFilled as filledShape } from '../project.js';
import { setStage } from '../actions.js';
import { drawSlides, composeTikTok } from '../render.js';
import { getPicture, loadPicture } from '../media.js';

const SIDE = 720;
// The slides the phone shows: the set that platform posts
const phoneSet = () => setFor(state.project, state.phonePlatform);
const slideList = (p) => slides(p, phoneSet());
// TikTok shows a 1:1 or 4:5 set with the fill around it; a 9:16 set fills the screen
const tiktokFilled = () => filledShape(phoneSet().ratio);
let phone = null;
let rendered = { key: null, squares: [], tiktok: [] };
let renderTimer = null;

const stroke = (d) => d;
const ICON = {
  heart: '<path d="M12 20.5s-8-4.9-8-11A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 8 2.9c0 6.1-8 11-8 11z"/>',
  comment: '<path d="M20.5 11.5a8.5 8.5 0 1 1-3.5-6.9A8.5 8.5 0 0 1 20.5 11.5zm0 0V20l-3-2"/>',
  repost: '<path d="M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4v1M7 21l-3-3 3-3M4 18h12a4 4 0 0 0 4-4v-1"/>',
  send: '<path d="M21.5 3 2.5 9.5l7.5 3 3 7.5L21.5 3zM10 12.5l5-5"/>',
  bookmark: '<path d="M6 3h12v18l-6-5-6 5z"/>',
  share: '<path d="M13.5 4.5 21 12l-7.5 7.5v-4.2c-6 0-9.3 1.7-11.5 5.2.8-6.3 4.3-10.1 11.5-11z"/>',
  up: '<path d="M7.5 10.5V20H4v-9.5zm0 0L11.8 3a2.2 2.2 0 0 1 2.2 2.4l-.5 4.1h5.6a2 2 0 0 1 2 2.4l-1.4 6.6a2 2 0 0 1-2 1.5H7.5"/>',
  down: '<path d="M16.5 13.5V4H20v9.5zm0 0L12.2 21a2.2 2.2 0 0 1-2.2-2.4l.5-4.1H4.9a2 2 0 0 1-2-2.4l1.4-6.6a2 2 0 0 1 2-1.5h10.2"/>',
  quote: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8.5 10.5v3M8.5 10.5h-1.5M15.5 10.5v3M15.5 10.5H14"/>',
  more: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  menu: '<path d="M4 8h16M8 15h12"/>',
  home: '<path d="M3.5 11 12 4l8.5 7v9.5h-6v-6h-5v6h-6z"/>',
  reels: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="m10 9 5 3-5 3z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-5-5"/>',
  plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  shorts: '<path d="M14.5 3.5 7 7.8a3.5 3.5 0 0 0 0 6l1 .6-1 .6a3.5 3.5 0 0 0 3.5 6l7.5-4.3a3.5 3.5 0 0 0 0-6l-1-.6 1-.6a3.5 3.5 0 0 0-3.5-5.4z"/><path d="m10.5 9.5 4 2.5-4 2.5z"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"/>',
  friends: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-4 3.3-6 6.5-6s5.9 2 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c3 0 5 1.8 5.5 5"/>',
  inbox: '<path d="M4 5h16v11H9l-5 4z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.5-6.5 8-6.5s7 2 8 6.5"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  photo: '<rect x="4" y="5" width="13" height="13" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v11"/>',
  grid: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  back: '<path d="M15 4.5 7.5 12l7.5 7.5"/>'
};
const icon = (name, size = 22, fill = "none") => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${stroke(ICON[name])}</svg>`;
const STATUS = `<div class="ph-status"><b>9:41</b><span class="ph-status-right"><i class="ph-bars"></i>5G<i class="ph-battery">82</i></span></div>`;

// The screen is laid out at a real phone's size (390 x 845 points) and scaled to fit the space,
// so it reads like the app at any window size
const SCREEN = { w: 390, h: 845 };
let scale = 1;
let zoom = 1;  // − Fit +: 1 = the whole screen fits; more = closer (scroll to look around)
function fitPhone() {
  const row = document.querySelector(".phone-row"), fit = document.getElementById("phone-fit");
  if (!row || !fit || !row.clientHeight) return;
  const fitted = Math.max(0.2, Math.min((row.clientHeight - 8) / SCREEN.h, (row.clientWidth - 130) / SCREEN.w, 1));
  scale = fitted * zoom;
  phone.style.transform = `scale(${scale})`;
  fit.style.width = `${SCREEN.w * scale}px`;
  fit.style.height = `${SCREEN.h * scale}px`;
}

function setZoom(z) {
  zoom = Math.min(4, Math.max(0.5, z));
  fitPhone();
}

export function initPhone() {
  phone = document.getElementById("phone");
  const row = document.querySelector(".phone-row");
  new ResizeObserver(fitPhone).observe(row);
  document.getElementById("phone-zoom-in").onclick = () => setZoom(zoom * 1.25);
  document.getElementById("phone-zoom-out").onclick = () => setZoom(zoom / 1.25);
  document.getElementById("phone-zoom-fit").onclick = () => setZoom(1);
  row.addEventListener("wheel", (e) => {
    if (!e.metaKey && !e.ctrlKey) return; // (plain scrolling moves around a zoomed-in screen)
    e.preventDefault();
    setZoom(zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
  }, { passive: false });
  document.querySelectorAll("#phone-platforms button").forEach((b) => b.addEventListener("click", () => {
    state.phonePlatform = b.dataset.platform;
    setStage(b.dataset.platform); // (the phone and the stage go together)
    changed("view");
  }));
  document.querySelectorAll("#phone-screens button").forEach((b) => b.addEventListener("click", () => {
    state.phoneScreen = b.dataset.screen;
    changed("view");
  }));
  document.getElementById("phone-prev").onclick = () => go(-1);
  document.getElementById("phone-next").onclick = () => go(1);
  onChange((what) => {
    if (state.view !== "phone") return;
    if (what === "look") { clearTimeout(renderTimer); renderTimer = setTimeout(build, 200); } else build();
  });
}

// Move the phone a slide on (+1) or back (-1)
export function go(step) {
  const count = slideList(state.project).length;
  if (!count) return;
  state.phoneSlide = Math.max(0, Math.min(count - 1, state.phoneSlide + step));
  slideTo(state.phoneSlide, true);
}

function renderSlides() {
  const p = state.project;
  const set = phoneSet();
  const missing = set.items.flatMap((i) => [i.mediaId, ...((i.layers || []).map((l) => l.mediaId))]).filter((id) => !getPicture(id));
  if (missing.length) Promise.all(missing.map((id) => loadPicture(id))).then(() => { rendered.key = null; build(); });
  const key = JSON.stringify([set.items, set.ratio, p.tiktok, missing.length, state.before]);
  if (rendered.key === key) return;
  const squares = drawSlides(set, SIDE, SIDE / aspectOf(set.ratio), { before: state.before, seed: p.seed }).map((s) => s.canvas);
  rendered = { key, squares, tiktok: [] };
}
const tiktokSlide = (i) => (!tiktokFilled() ? rendered.squares[i] : rendered.tiktok[i] || (rendered.tiktok[i] = composeTikTok(rendered.squares[i], state.project, 720, 1280)));

function build() {
  document.querySelectorAll("#phone-platforms button").forEach((b) => b.classList.toggle("on", b.dataset.platform === state.phonePlatform));
  document.querySelectorAll("#phone-screens button").forEach((b) => b.classList.toggle("on", b.dataset.screen === state.phoneScreen));
  const profile = state.phoneScreen === "profile";
  document.getElementById("phone-view").classList.toggle("profile", profile);
  const p = state.project;
  const count = slideList(p).length;
  if (!count) { phone.className = "phone"; phone.innerHTML = `<div class="ph-empty">Add photos to see them here</div>`; return; }
  state.phoneSlide = Math.min(state.phoneSlide, count - 1);
  renderSlides();
  const name = (p.name || "yourname").toLowerCase().replace(/[^a-z0-9._]+/g, "").slice(0, 24) || "yourname";
  if (profile) { buildProfile(name, count); return; }
  const platform = state.phonePlatform;
  const caption = escape(p.captions[platform] || "");
  const firstLine = (text, fallback) => text ? text.split("<br>")[0] : `<span class="ph-faint">${fallback}</span>`;
  const dots = `<div class="ph-dots">${Array.from({ length: count }, (_, i) => `<i class="${i === state.phoneSlide ? "on" : ""}"></i>`).join("")}</div>`;
  const track = `<div class="ph-track" id="ph-track"></div>`;
  const counter = `<span class="ph-count" id="ph-count">${state.phoneSlide + 1}/${count}</span>`;
  const set = phoneSet();

  if (platform === "instagram") {
    phone.className = "phone ph-ig";
    phone.innerHTML = `${STATUS}
      <div class="ph-scroll">
        <div class="ph-head"><i class="ph-avatar ring"></i><div class="ph-who"><b>${name}</b><small>Original audio</small></div><span class="ph-grow"></span>${icon("menu", 24)}</div>
        <div class="ph-media" style="aspect-ratio: ${aspectOf(set.ratio)}">${track}${counter}</div>
        <div class="ph-ig-dots">${dots}</div>
        <div class="ph-actions">${icon("heart", 25)}<b>6,622</b>${icon("comment", 24)}<b>39</b>${icon("repost", 24)}<b>114</b>${icon("send", 24)}<b>654</b><span class="ph-grow"></span>${icon("bookmark", 24)}</div>
        <div class="ph-line"><i class="ph-avatar tiny"></i>Liked by <b>&nbsp;afriend&nbsp;</b> and <b>&nbsp;others</b></div>
        <div class="ph-line ph-cap"><b>${name}</b>&nbsp;${firstLine(caption, "Your caption shows here")} <span class="ph-faint">… more</span></div>
        <div class="ph-line ph-faint">1 hour ago</div>
      </div>
      <div class="ph-ig-nav"><span class="on">${icon("home", 26, "currentColor")}</span>${icon("reels", 25)}${icon("send", 25)}${icon("search", 25)}<i class="ph-avatar small"></i></div>`;
  } else if (platform === "tiktok") {
    phone.className = "phone ph-tt";
    phone.innerHTML = `${STATUS}
      <div class="ph-tt-top"><i class="ph-avatar plus"></i><i class="ph-avatar ring-tt"></i><span class="ph-grow"></span><b>For You</b><span class="ph-grow"></span>${icon("search", 27)}</div>
      <div class="ph-media ph-tt-media">${track}<span class="ph-count tt" id="ph-count">${state.phoneSlide + 1}/${count}</span></div>
      <div class="ph-rail"><span class="ph-follow"><i class="ph-avatar big"></i><em>+</em></span><span>${icon("heart", 36, "currentColor")}<small>22</small></span><span>${icon("comment", 34, "currentColor")}<small>3</small></span><span>${icon("bookmark", 32, "currentColor")}<small>0</small></span><span>${icon("share", 32, "currentColor")}<small>1</small></span><i class="ph-disc"></i></div>
      <div class="ph-tt-dots">${dots}</div>
      <div class="ph-tt-info"><div><b>${name}</b> <span class="ph-chip">${icon("photo", 13)} Photo</span> <span class="ph-faint">· 2h ago</span></div><div class="ph-tt-cap"><b>${firstLine(caption, "Your caption shows here")}</b></div><div class="ph-tt-sound">${icon("music", 15)} Add a sound in TikTok</div></div>
      <div class="ph-tt-nav"><span>${icon("home", 26)}<small>Home</small></span><span class="on">${icon("friends", 26, "currentColor")}<small>Friends</small></span><span class="ph-tt-plus">＋</span><span class="ph-badge-wrap">${icon("inbox", 26)}<em>99+</em><small>Inbox</small></span><span>${icon("user", 26)}<small>Profile</small></span></div>`;
  } else {
    phone.className = "phone ph-yt";
    phone.innerHTML = `${STATUS}
      <div class="ph-yt-top"><span class="ph-yt-logo"><i></i>YouTube</span><span class="ph-grow"></span><span class="ph-badge-wrap">${icon("bell", 25)}<em>1</em></span>${icon("search", 25)}</div>
      <div class="ph-yt-tabs"><b>Home</b><span>Subs</span><span>Music</span><span>Live</span><span>More</span></div>
      <div class="ph-scroll">
        <div class="ph-head"><i class="ph-avatar"></i><div class="ph-who"><b>${escape(p.name || "Your channel")} <span class="ph-tick">✓</span></b><small>1 day ago</small></div><span class="ph-grow"></span>${icon("more", 22)}</div>
        <div class="ph-yt-text">${caption ? `${caption.split("<br>").slice(0, 2).join(" ")}` : '<span class="ph-faint">Your post text shows here</span>'}<b class="ph-faint">…Read more</b></div>
        <div class="ph-media ph-yt-media" style="aspect-ratio: ${aspectOf(set.ratio) / 0.89}">${track}<span class="ph-count" id="ph-count">${state.phoneSlide + 1}/${count}</span></div>
        <div class="ph-actions yt">${icon("up", 24)}<small>574</small><span class="ph-gap"></span>${icon("down", 24)}<span class="ph-grow"></span>${icon("share", 24)}${icon("quote", 24)}${icon("comment", 24)}<small>9</small></div>
      </div>
      <div class="ph-yt-nav">${icon("home", 27, "currentColor")}${icon("shorts", 26)}${icon("plus", 28)}<i class="ph-avatar small"></i></div>`;
  }

  const trackEl = document.getElementById("ph-track");
  for (let i = 0; i < count; i++) {
    const src = platform === "tiktok" ? tiktokSlide(i) : rendered.squares[i];
    if (!src) continue;
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    c.getContext("2d").drawImage(src, 0, 0);
    trackEl.append(c);
  }
  slideTo(state.phoneSlide, false);
  fitPhone();
  swipeable(trackEl.parentElement);
  trackEl.parentElement.addEventListener("dblclick", () => {
    const slide = slideList(state.project)[state.phoneSlide];
    if (!slide) return;
    state.view = "edit";
    select(slide.item.id, "one");
    changed("view");
  });
}

// ---- Profile: the post first on your page, with stand-ins for your other posts

// A picture cut to 3:4 from its middle (what the profile grids show of a post)
function tile(src) {
  const c = document.createElement("canvas");
  c.width = 300;
  c.height = 400;
  const s = Math.min(src.width / 3, src.height / 4);
  c.getContext("2d").drawImage(src, (src.width - 3 * s) / 2, (src.height - 4 * s) / 2, 3 * s, 4 * s, 0, 0, 300, 400);
  return c;
}
// Your other posts: plain tiles in quiet shades
const others = (n, extra = "") => Array.from({ length: n }, (_, i) => `<div class="ph-tile ph-other" style="--shade:${[22, 30, 26, 34, 20, 28, 24, 32, 27, 21, 31, 25][i % 12]}%">${extra}</div>`).join("");

function buildProfile(name, count) {
  const p = state.project;
  const platform = state.phonePlatform;
  const views = `<span class="ph-views">${icon("play", 13)} 1,204</span>`;
  if (platform === "instagram") {
    phone.className = "phone ph-ig ph-profile";
    phone.innerHTML = `${STATUS}
      <div class="ph-prof-top"><b>${name}</b> <span class="ph-faint">⌄</span><span class="ph-grow"></span>${icon("plus", 25)}${icon("menu", 25)}</div>
      <div class="ph-scroll">
        <div class="ph-prof-head"><i class="ph-avatar huge"></i><div class="ph-prof-stats"><b>${escape(p.name || "Your name")}</b><div><span><b>12</b> posts</span><span><b>1,204</b> followers</span><span><b>318</b> following</span></div></div></div>
        <div class="ph-prof-bio"><span class="ph-faint">Your bio shows here</span></div>
        <div class="ph-prof-buttons"><span>Edit profile</span><span>Share profile</span><span class="ph-sq">${icon("user", 16)}</span></div>
        <div class="ph-prof-tabs"><span class="on">${icon("grid", 24)}</span><span>${icon("reels", 24)}</span><span>${icon("user", 24)}</span></div>
        <div class="ph-grid" id="ph-grid"><div class="ph-tile ph-mine">${count > 1 ? `<span class="ph-multi">${icon("photo", 16)}</span>` : ""}</div>${others(14)}</div>
      </div>
      <div class="ph-ig-nav">${icon("home", 26)}${icon("reels", 25)}${icon("send", 25)}${icon("search", 25)}<span class="on"><i class="ph-avatar small"></i></span></div>`;
    mine(tile(rendered.squares[0]));
  } else if (platform === "tiktok") {
    phone.className = "phone ph-tt ph-profile";
    phone.innerHTML = `${STATUS}
      <div class="ph-prof-top center">${icon("user", 24)}<span class="ph-grow"></span><b>${escape(p.name || "Your name")}</b> <span class="ph-faint">⌄</span><span class="ph-grow"></span>${icon("menu", 25)}</div>
      <div class="ph-scroll">
        <div class="ph-tt-prof"><i class="ph-avatar huge"></i><b>@${name}</b>
          <div class="ph-tt-stats"><span><b>318</b><small>Following</small></span><span><b>1,204</b><small>Followers</small></span><span><b>22.4K</b><small>Likes</small></span></div>
          <div class="ph-prof-buttons tt"><span>Edit profile</span><span>Share profile</span></div>
          <div class="ph-faint">Tap to add bio</div></div>
        <div class="ph-prof-tabs"><span class="on">${icon("grid", 22)}</span><span>${icon("lock", 22)}</span><span>${icon("repost", 22)}</span><span>${icon("bookmark", 22)}</span><span>${icon("heart", 22)}</span></div>
        <div class="ph-grid" id="ph-grid"><div class="ph-tile ph-mine">${views}</div>${others(14, views)}</div>
      </div>
      <div class="ph-tt-nav"><span>${icon("home", 26)}<small>Home</small></span><span>${icon("friends", 26)}<small>Friends</small></span><span class="ph-tt-plus">＋</span><span class="ph-badge-wrap">${icon("inbox", 26)}<small>Inbox</small></span><span class="on">${icon("user", 26, "currentColor")}<small>Profile</small></span></div>`;
    mine(tile(tiktokSlide(0)));
  } else {
    phone.className = "phone ph-yt ph-profile";
    const caption = escape(p.captions.youtube || "");
    phone.innerHTML = `${STATUS}
      <div class="ph-prof-top">${icon("back", 24)}<span class="ph-grow"></span>${icon("search", 24)}${icon("more", 22)}</div>
      <div class="ph-scroll">
        <div class="ph-yt-banner"></div>
        <div class="ph-yt-chan"><i class="ph-avatar huge"></i><div><b class="ph-yt-name">${escape(p.name || "Your channel")}</b><small class="ph-faint">@${name} · 1.2K subscribers · 48 videos</small></div></div>
        <div class="ph-prof-buttons yt"><span>Manage videos</span></div>
        <div class="ph-yt-tabs chan"><span>Home</span><span>Videos</span><span>Shorts</span><b>Posts</b><span>Playlists</span></div>
        <div class="ph-head"><i class="ph-avatar"></i><div class="ph-who"><b>${escape(p.name || "Your channel")}</b><small>1 day ago</small></div><span class="ph-grow"></span>${icon("more", 22)}</div>
        <div class="ph-yt-text">${caption ? caption.split("<br>").slice(0, 2).join(" ") : '<span class="ph-faint">Your post text shows here</span>'}</div>
        <div class="ph-yt-post" id="ph-grid"><div class="ph-mine" style="aspect-ratio: ${aspectOf(phoneSet().ratio)}">${count > 1 ? `<span class="ph-count">1/${count}</span>` : ""}</div></div>
      </div>
      <div class="ph-yt-nav">${icon("home", 27)}${icon("shorts", 26)}${icon("plus", 28)}<i class="ph-avatar small"></i></div>`;
    mine(rendered.squares[0]);
  }
  fitPhone();
}
// Your post's tile, copied in (a click on it opens the post in the feed)
function mine(src) {
  const box = phone.querySelector(".ph-mine");
  if (!box || !src) return;
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  c.getContext("2d").drawImage(src, 0, 0);
  box.prepend(c);
  box.title = "Your post: click to see it in the feed";
  box.onclick = () => { state.phoneScreen = "feed"; state.phoneSlide = 0; changed("view"); };
}

// How far the track moves for slide i (YouTube shows its neighbours peeking in at the sides)
const offsetFor = (i) => (state.phonePlatform === "youtube" ? `calc(${-i} * (89% + 8px))` : `${-i * 100}%`);

function slideTo(i, animate) {
  const track = document.getElementById("ph-track");
  if (!track) return;
  track.style.transition = animate ? "transform 0.28s cubic-bezier(.2,.8,.2,1)" : "none";
  track.style.transform = `translateX(${offsetFor(i)})`;
  const count = slideList(state.project).length;
  const label = document.getElementById("ph-count");
  if (label) label.textContent = `${i + 1}/${count}`;
  phone.querySelectorAll(".ph-dots").forEach((d) => d.querySelectorAll("i").forEach((dot, k) => dot.classList.toggle("on", k === i)));
}

// Drag the photos sideways like a finger: let go past 15% and it turns the page
function swipeable(media) {
  let start = null;
  media.addEventListener("pointerdown", (e) => { start = { x: e.clientX, w: media.clientWidth }; media.setPointerCapture(e.pointerId); });
  media.addEventListener("pointermove", (e) => {
    if (!start) return;
    const track = document.getElementById("ph-track");
    track.style.transition = "none";
    track.style.transform = `translateX(calc(${offsetFor(state.phoneSlide)} + ${(e.clientX - start.x) / scale}px))`;
  });
  const end = (e) => {
    if (!start) return;
    const moved = (e.clientX - start.x) / scale / start.w;
    start = null;
    if (moved < -0.15) go(1); else if (moved > 0.15) go(-1); else slideTo(state.phoneSlide, true);
  };
  media.addEventListener("pointerup", end);
  media.addEventListener("pointercancel", end);
}

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/\n/g, "<br>");

export function showPhone() { build(); }
