// Photos: each file brought in is kept once, as it came (IndexedDB "media"), and decoded into
// pictures kept in memory: "full" (the original size, for export) and "preview" (smaller, for
// editing on screen, so effects stay quick). iPhone photos (HEIC) are turned into JPEG on the way
// in where the browser can't read them itself (Chrome, Edge, Firefox).
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
    const picture = await decode(record.blob, record.name);
    pictures.set(id, picture);
    return picture;
  }).catch((err) => { console.error("Couldn't load a photo:", err); return null; })
    .finally(() => loading.delete(id));
  loading.set(id, promise);
  return promise;
}

const isHeic = (file) => /\.(heic|heif)$/i.test(file.name || "") || /image\/hei[cf]/i.test(file.type || "");
export const isPhotoFile = (file) => /^image\//.test(file.type || "") || isHeic(file) || /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(file.name || "");

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
