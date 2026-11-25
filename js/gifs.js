// GIFs (Tom, 2026-11-25): GIPHY's GIFs and stickers (stickers: see-through backgrounds) on a slide. A GIF sits with the
// captions and shapes (item.texts, kind "gif": x, y, size, aspect, rotation, opacity, speed, mediaId), so it picks,
// moves, sizes, turns and lists in Layers like them. The file is fetched once and kept in the media store (kind "gif"),
// so it opens offline, saves in the project folder and exports. Its frames are read with the browser's ImageDecoder
// (Chrome, Edge, Safari 17+), else it stays still on its first frame. On screen it plays; on a video slide's MP4 it
// plays with the clip; a photo slide's JPEG gets its first frame.
//
// GIPHY's terms: "Powered by GIPHY" shown wherever its search is (the GIFs tab). The key is GIPHY's own kind, made to sit
// in an app's code (rate-limited and tied to this app); a production key lifts the 100 searches an hour.
import { dbGet, dbPut } from './store.js';
import { newId } from './project.js';

export const GIPHY_KEY = "";
const keyNow = () => { try { return localStorage.getItem("ans_photo_giphy_key") || GIPHY_KEY; } catch { return GIPHY_KEY; } };
export const giphyReady = () => !!keyNow();

// ---- Search

// [{ id, title, preview, file, width, height }] (type "stickers" | "gifs"; no words: what's trending)
export async function searchGiphy(words, type = "stickers", offset = 0) {
  const q = String(words || "").trim();
  const url = new URL(`https://api.giphy.com/v1/${type === "gifs" ? "gifs" : "stickers"}/${q ? "search" : "trending"}`);
  url.searchParams.set("api_key", keyNow());
  if (q) url.searchParams.set("q", q);
  url.searchParams.set("limit", "24");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("rating", "pg-13");
  url.searchParams.set("bundle", "messaging_non_clips");
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status === 429 ? "GIPHY is busy: try again in a while" : "GIPHY didn't answer");
  const j = await r.json();
  return (j.data || []).map((g) => {
    const im = g.images || {}, small = im.fixed_width_small || im.fixed_width || {}, full = im.original || {};
    return {
      id: g.id, title: g.title || "GIF", preview: small.webp || small.url, file: full.webp || full.url,
      width: Number(full.width) || 200, height: Number(full.height) || 200
    };
  }).filter((g) => g.preview && g.file);
}

// ---- The file, kept in the media store

export async function keepGif(result, projectId) {
  const r = await fetch(result.file);
  if (!r.ok) throw new Error("The GIF couldn't be fetched");
  const blob = await r.blob();
  const id = newId("m");
  await dbPut("media", { id, projectId, kind: "gif", name: result.title, type: blob.type || "image/gif", blob, width: result.width, height: result.height, giphyId: result.id, added: Date.now() });
  await loadGif(id);
  return id;
}

// A GIF from a file of your own (dropped in or added on the GIFs tab)
export async function keepGifFile(file, projectId) {
  const id = newId("m");
  const anim = await decodeFrames(file);
  const size = anim ? anim.size : { width: 200, height: 200 };
  await dbPut("media", { id, projectId, kind: "gif", name: file.name.replace(/\.[^.]+$/, ""), type: file.type || "image/gif", blob: file, width: size.width, height: size.height, added: Date.now() });
  if (anim) { gifs.set(id, anim); tell(); }
  return { id, ...size };
}

// ---- Frames

const gifs = new Map();     // mediaId → { frames: [{ image, end }], length, size } once read (null: couldn't be)
const loading = new Map();
const listeners = new Set();
export const onGifsChange = (fn) => listeners.add(fn);
const tell = () => listeners.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } });

const MAX_SIDE = 720; // (big enough for a slide; keeps a long GIF's frames in memory small)
async function decodeFrames(blob) {
  if (typeof ImageDecoder === "undefined") return null;
  try {
    const type = blob.type || "image/gif";
    if (!(await ImageDecoder.isTypeSupported(type))) return null;
    const dec = new ImageDecoder({ data: await blob.arrayBuffer(), type });
    await dec.tracks.ready;
    await dec.completed;
    const count = Math.max(1, dec.tracks.selectedTrack.frameCount || 1);
    const frames = [];
    let at = 0, size = null;
    for (let i = 0; i < count && i < 600; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const w = image.displayWidth, h = image.displayHeight, k = Math.min(1, MAX_SIDE / Math.max(w, h));
      size = size || { width: w, height: h };
      const bitmap = await createImageBitmap(image, { resizeWidth: Math.max(1, Math.round(w * k)), resizeHeight: Math.max(1, Math.round(h * k)), resizeQuality: "high" });
      const ms = image.duration ? image.duration / 1000 : 100;
      at += (ms < 20 ? 100 : ms) / 1000; // (as browsers play them: very short frames count as 0.1 s)
      frames.push({ image: bitmap, end: at });
      image.close();
    }
    dec.close();
    return { frames, length: at, size };
  } catch (err) {
    console.warn("GIF frames:", err);
    return null;
  }
}

export function loadGif(id) {
  if (gifs.has(id)) return Promise.resolve(gifs.get(id));
  if (loading.has(id)) return loading.get(id);
  const p = dbGet("media", id).then(async (rec) => {
    const anim = rec ? await decodeFrames(rec.blob) : null;
    if (!anim && rec) anim_still(id, rec.blob);
    gifs.set(id, anim);
    tell();
    return anim;
  }).catch(() => null).finally(() => loading.delete(id));
  loading.set(id, p);
  return p;
}
// (no ImageDecoder: its first frame, as a still)
const stills = new Map();
function anim_still(id, blob) {
  createImageBitmap(blob).then((b) => { stills.set(id, b); tell(); }).catch(() => {});
}

// The frame showing at `seconds` (it loops), or null while it's being read
export function gifFrame(t, seconds = 0) {
  const anim = gifs.get(t.mediaId);
  if (anim === undefined) { loadGif(t.mediaId); return null; }
  if (!anim) return stills.get(t.mediaId) || null;
  const f = anim.frames;
  if (f.length === 1 || !anim.length) return f[0].image;
  const s = (((seconds * (t.speed || 1)) % anim.length) + anim.length) % anim.length;
  let lo = 0, hi = f.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (f[mid].end > s) hi = mid; else lo = mid + 1; }
  return f[lo].image;
}

export const isGif = (t) => t && t.kind === "gif";
export const gifIdsOf = (item) => ((item && item.texts) || []).filter(isGif).map((t) => t.mediaId);
// Every GIF on these slides read (before an export)
export const gifsReady = (list) => Promise.all(list.flatMap(gifIdsOf).map(loadGif));
// Any GIF here that moves (the screen keeps redrawing while one is showing)
export const movingGifs = (item) => ((item && item.texts) || []).some((t) => isGif(t) && !t.hidden && (gifs.get(t.mediaId)?.frames.length || 0) > 1);
// The screen's clock
export const gifClock = () => performance.now() / 1000;
