// Post (Tom, 2026-11-19): the Social Media Calendar's Add a post as a pop-up over the editor, with the set's slides
// already in it (ans-idently/POST-FROM-APPS.md, pop=photo-editor, media=photo). The artist picks the kind of post,
// unticks any slide they don't want, presses Next; the slides are made (as Export makes them: JPEG, MP4 for a video
// slide) and handed over, then they caption and schedule it there as one carousel. Nothing is exported or downloaded.
// With no artist known it opens the calendar's Upload posts in this tab instead.
import { state } from '../state.js';
import { exportShape, makeExports } from '../exporter.js';
import { drawSlides } from '../render.js';
import { loadPicture } from '../media.js';
import { maskIdsOf } from '../cutout.js';
import { toast } from './toast.js';

let dlg = null, frame = null, listening = false;

// The artist they're working as: the Identity page that opened the editor, else the last one picked in Identity
export function postArtist() {
  try {
    const back = sessionStorage.getItem("ans_photo_home");
    const a = back && new URL(back, location.origin).searchParams.get("artist");
    return a || localStorage.getItem("identity-last-artist") || "";
  } catch { return ""; }
}

export function openPost() {
  const p = state.project;
  if (!exportShape(p).count) { toast("Add photos first"); return; }
  const artist = postArtist();
  if (!artist) { location.href = "/identity/calendar/?part=new&media=photo"; return; }
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.className = "post-pop";
    frame = document.createElement("iframe");
    frame.title = "Post";
    const x = document.createElement("button");
    x.type = "button"; x.className = "post-close"; x.textContent = "✕"; x.title = "Close";
    x.onclick = () => dlg.close();
    dlg.append(x, frame);
    document.body.append(dlg);
  }
  if (!listening) { addEventListener("message", onMessage); listening = true; }
  frame.src = window.__postCalendar || `/identity/calendar/?artist=${encodeURIComponent(artist)}&pop=photo-editor&media=photo`; // (tests: a stand-in calendar)
  dlg.showModal();
}

const nameOf = (p) => (p.name && p.name !== "Untitled" ? p.name : "Slide");

// Every picture the post will have (a panorama gives one per slide), with a small picture of each
async function slidesNow(p) {
  const sh = exportShape(p);
  await Promise.all(sh.set.items.flatMap((i) => [i.mediaId, ...((i.layers || []).map((l) => l.mediaId)), ...maskIdsOf([i, ...(i.layers || [])])]).map((id) => loadPicture(id)));
  const w = 240, h = Math.round(240 * sh.height / sh.width);
  return drawSlides(sh.set, w, h, { quality: "preview", seed: p.seed }).map((s, i) => ({
    id: String(i), name: `${nameOf(p)} · ${i + 1}`, thumb: s.canvas.toDataURL("image/jpeg", 0.8), kind: "photo"
  }));
}

async function onMessage(e) {
  if (!frame || e.origin !== location.origin || e.source !== frame.contentWindow) return;
  const m = e.data || {}, to = (x) => frame.contentWindow.postMessage(x, location.origin);
  const p = state.project;
  if (m.ans === "ready") to({ ans: "variations", items: await slidesNow(p) });
  else if (m.ans === "render") {
    try {
      const ids = (m.ids || []).map(Number);
      const total = ids.length;
      to({ ans: "progress", done: 0, total });
      // (made as Export makes them, then the ticked ones handed over in their order)
      const blobs = await makeExports(p, 1, (f) => to({ ans: "progress", done: Math.min(total - 1, Math.floor(f * total)), total }));
      const base = nameOf(p);
      const files = ids.map((i) => {
        const b = blobs[i];
        const ext = b.type === "video/mp4" ? "mp4" : "jpg";
        return new File([b], `${base} ${String(i + 1).padStart(2, "0")}.${ext}`, { type: b.type });
      });
      to({ ans: "files", files });
    } catch (err) {
      console.error("Post:", err);
      to({ ans: "error", message: "The slides couldn't be made. Try again." });
    }
  } else if (m.ans === "close") dlg.close();
}
