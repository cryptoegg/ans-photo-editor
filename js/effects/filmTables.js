// Film tables brought in (2026-11-22): the RawTherapee Film Simulation collection (CC BY-SA 4.0, by Pat David, Pavlov
// Dmitry and Michael Ezra), shrunk to 33-point tables by ans-build/references-shared/film-luts/convert.py and copied into
// films/: films.json (the list: brand > film > variant) and one <id>.bin each (33³ × 3 bytes, red changing fastest).
// The list is read at start; a table is fetched the first time a photo or a tile needs it. With no films/ folder
// there are simply no films. The Lyric Visualiser reads the same files.

const BASE = new URL("../../films/", import.meta.url);
let list = [], credit = "";
const tables = new Map(); // id → { size, data } once fetched
const loading = new Map();
const listeners = new Set();
export const onFilmsChange = (fn) => listeners.add(fn);
const tell = (what) => listeners.forEach((fn) => fn(what)); // ("list": the list came in; "table": a film's table did)

// [{ id, kind, brand, film, variant, name }]
export const listFilms = () => list.filter((f) => f.menu !== false); // (the 50 picked, 2026-11-23; the rest still open)
export const filmsCredit = () => credit;
export const filmInfo = (id) => list.find((f) => f.id === id) || null;

export const filmsReady = (async () => {
  try {
    const r = await fetch(new URL("films.json", BASE));
    if (!r.ok) return;
    const j = await r.json();
    credit = j.credit || "";
    list = (j.films || []).map((f) => ({ ...f, name: [f.film, f.variant].filter(Boolean).join(" ") }));
    tell("list");
  } catch (err) { /* no films here */ }
})();

export const filmLoaded = (id) => tables.has(id);

// The table, or null while it's being fetched (a redraw follows once it's in)
export function filmTable(id) {
  if (tables.has(id)) return tables.get(id);
  loadFilm(id);
  return null;
}
export function loadFilm(id) {
  if (tables.has(id)) return Promise.resolve(tables.get(id));
  if (loading.has(id)) return loading.get(id);
  const info = filmInfo(id);
  if (!info) return Promise.resolve(null);
  const p = fetch(new URL(info.file, BASE)).then((r) => (r.ok ? r.arrayBuffer() : null)).then((buf) => {
    if (!buf) return null;
    const bytes = new Uint8Array(buf), size = Math.round(Math.cbrt(bytes.length / 3));
    const data = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) data[i] = bytes[i] / 255;
    const t = { size, data };
    tables.set(id, t);
    tell("table");
    return t;
  }).catch(() => null);
  loading.set(id, p);
  return p;
}
