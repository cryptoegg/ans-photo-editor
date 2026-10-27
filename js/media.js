// Photos and videos: each file brought in is kept once, as it came (IndexedDB "media"), and
// decoded into pictures kept in memory: "full" (the original size, for export) and "preview"
// (smaller, for editing on screen, so effects stay quick). iPhone photos (HEIC) are turned into
// JPEG on the way in where the browser can't read them itself (Chrome, Edge, Firefox).
// A video's picture is a still of it (thumbnails, filter swatches), plus a player for the canvas
// (`player`, with sound), a second one for stills at any moment (`stillAt`), and its file
// (`blob`) for frame-exact export (js/video/clipReader.js).
import { dbGet, dbPut } from './store.js';
import { newId } from './project.js';

export const PREVIEW_SIDE = 1600;
const HEIC_LIB = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";

const pictures = new Map();  // mediaId -> { full, preview, width, height, name }
const loading = new Map();   // mediaId -> promise of the above

export const getPicture = (id) => pictures.get(id) || null;

// The picture for a media id, loading it from storage if needed (null if it's missing)
export function loadPicture(id) {
  if (pictures.has(id)) return Promise.resolve(pictures.get(id));
  if (loading.has(id)) return loading.get(id);
  const promise = dbGet("media", id).then(async (record) => {
    if (!record) return null;
    const picture = record.kind === "video" ? await decodeVideo(record.blob, record.name) : await decode(record.blob, record.name);
    pictures.set(id, picture);
    return picture;
  }).catch((err) => { console.error("Couldn't load a photo:", err); return null; })
    .finally(() => loading.delete(id));
  loading.set(id, promise);
  return promise;
}

const isHeic = (file) => /\.(heic|heif)$/i.test(file.name || "") || /image\/hei[cf]/i.test(file.type || "");
export const isPhotoFile = (file) => /^image\//.test(file.type || "") || isHeic(file) || /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(file.name || "");
// MP4 and MOV (iPhone) are read frame by frame for export; WebM plays but exports more slowly
export const isVideoFile = (file) => /^video\//.test(file.type || "") || /\.(mp4|mov|m4v|webm)$/i.test(file.name || "");
export const isMediaFile = (file) => isPhotoFile(file) || isVideoFile(file);

// Bring a photo or video in: { id, kind, duration }
export async function addMediaFile(file, projectId) {
  if (!isVideoFile(file)) return { id: await addPhotoFile(file, projectId), kind: "photo" };
  const picture = await decodeVideo(file, file.name);
  const id = newId("m");
  await dbPut("media", { id, projectId, kind: "video", name: file.name, type: file.type, blob: file, width: picture.width, height: picture.height, duration: picture.duration, added: Date.now() });
  pictures.set(id, picture);
  return { id, kind: "video", duration: picture.duration };
}

// ---- Videos

const once = (el, ok, bad = "error") => new Promise((resolve, reject) => {
  const done = () => { el.removeEventListener(ok, done); el.removeEventListener(bad, fail); resolve(); };
  const fail = () => { el.removeEventListener(ok, done); el.removeEventListener(bad, fail); reject(new Error("This video can't be played in this browser")); };
  el.addEventListener(ok, done);
  el.addEventListener(bad, fail);
});

async function decodeVideo(blob, name) {
  const url = URL.createObjectURL(blob);
  const make = (muted) => {
    const v = document.createElement("video");
    v.src = url;
    v.preload = "auto";
    v.playsInline = true;
    v.muted = muted;
    return v;
  };
  const player = make(false);
  const seeker = make(true);
  await Promise.all([once(player, "loadedmetadata"), once(seeker, "loadeddata")]);
  const width = seeker.videoWidth, height = seeker.videoHeight, duration = seeker.duration;
  const picture = { kind: "video", url, blob, name, player, seeker, width, height, duration, stills: new Map(), queue: Promise.resolve() };
  picture.full = await grab(picture, Math.min(0.1, duration / 2));
  const scale = Math.min(1, PREVIEW_SIDE / Math.max(width, height));
  picture.preview = scaled(picture.full, scale);
  return picture;
}

function scaled(source, scale) {
  if (scale >= 1) return source;
  const c = document.createElement("canvas");
  c.width = Math.round(source.width * scale);
  c.height = Math.round(source.height * scale);
  c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
  return c;
}

// A still of the video at `seconds` (a canvas at its full size), one seek at a time
function grab(picture, seconds) {
  const run = picture.queue.then(async () => {
    const v = picture.seeker;
    const t = Math.max(0, Math.min(seconds, picture.duration - 0.001));
    if (Math.abs(v.currentTime - t) > 0.0005) { v.currentTime = t; await once(v, "seeked"); }
    const c = document.createElement("canvas");
    c.width = picture.width;
    c.height = picture.height;
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    return c;
  });
  picture.queue = run.catch(() => {});
  return run;
}

// The still at `seconds` (to 1/10 s), ready now if it's been made (else null, and it's made, then
// `ready` is called): { full, preview }
export let stillsMade = 0; // (goes up as each still is made, so thumbnails know to redraw)
export function stillAt(mediaId, seconds, ready) {
  const picture = pictures.get(mediaId);
  if (!picture || picture.kind !== "video") return null;
  const key = Math.round(seconds * 10) / 10;
  const kept = picture.stills.get(key);
  if (kept && kept.full) return kept;
  if (!kept) {
    const entry = {};
    picture.stills.set(key, entry);
    grab(picture, key).then((full) => {
      entry.full = full;
      entry.preview = scaled(full, Math.min(1, PREVIEW_SIDE / Math.max(full.width, full.height)));
      stillsMade++;
      if (ready) ready();
    }).catch((err) => { console.error(err); picture.stills.delete(key); });
  }
  return null;
}

// Bring a file in: kept in storage, decoded, and given a media id. Resolves to the id.
export async function addPhotoFile(file, projectId) {
  let blob = file;
  let picture;
  try {
    picture = await decode(blob, file.name);
  } catch (err) {
    if (!isHeic(file)) throw err;
    blob = await heicToJpeg(file); // (this browser can't read HEIC itself)
    picture = await decode(blob, file.name);
  }
  const id = newId("m");
  await dbPut("media", { id, projectId, name: file.name, type: blob.type, blob, width: picture.width, height: picture.height, added: Date.now() });
  pictures.set(id, picture);
  return id;
}

async function decode(blob, name) {
  // (the photo turned the way the camera held it: browsers read the EXIF orientation here)
  const full = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const scale = Math.min(1, PREVIEW_SIDE / Math.max(full.width, full.height));
  const preview = scale < 1
    ? await createImageBitmap(full, { resizeWidth: Math.round(full.width * scale), resizeHeight: Math.round(full.height * scale), resizeQuality: "high" })
    : full;
  return { full, preview, width: full.width, height: full.height, name };
}

let heicLoading = null;
async function heicToJpeg(file) {
  if (!heicLoading) {
    heicLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = HEIC_LIB;
      s.onload = () => resolve(window.heic2any);
      s.onerror = () => { heicLoading = null; reject(new Error("The HEIC reader couldn't be loaded (are you online?)")); };
      document.head.appendChild(s);
    });
  }
  const heic2any = await heicLoading;
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.95 });
  return Array.isArray(out) ? out[0] : out;
}
