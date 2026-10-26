// Storage in this browser (IndexedDB): projects (the records), media (each photo's original
// file, once) and a little "meta" (the last project open, the export folder). Every project is
// saved by itself shortly after each change, so nothing is lost; the Projects menu lists them.
const NAME = "ans_photo";
const VERSION = 1;
let opening = null;

function open() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

function run(store, mode, work) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = work(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const dbGet = (store, key) => run(store, "readonly", (s) => s.get(key));
export const dbPut = (store, value, key) => run(store, "readwrite", (s) => (key === undefined ? s.put(value) : s.put(value, key)));
export const dbDelete = (store, key) => run(store, "readwrite", (s) => s.delete(key));
export const dbAll = (store) => run(store, "readonly", (s) => s.getAll());

export const saveProject = (p) => dbPut("projects", JSON.parse(JSON.stringify(p))).then(() => dbPut("meta", p.id, "last"));
export const loadProject = (id) => dbGet("projects", id);
export const lastProjectId = () => dbGet("meta", "last").catch(() => null);

// Every project, newest first: [{ id, name, updated, slides }]
export async function listProjects() {
  const all = await dbAll("projects").catch(() => []);
  return all
    .map((p) => ({ id: p.id, name: p.name, updated: p.updated || 0, slides: (p.items || []).reduce((n, i) => n + (i.span || 1), 0), cover: p.items && p.items[0] ? p.items[0].mediaId : null }))
    .sort((a, b) => b.updated - a.updated);
}

// A project and the photos only it uses
export async function deleteProject(id) {
  const all = await dbAll("projects").catch(() => []);
  const doomed = all.find((p) => p.id === id);
  if (!doomed) return;
  const lists = (p) => [p.items || [], ...(p.stages ? Object.values(p.stages).map((s) => s.items || []) : [])].flat();
  const usedElsewhere = new Set(all.filter((p) => p.id !== id).flatMap((p) => lists(p).map((i) => i.mediaId)));
  const mine = await dbAll("media").catch(() => []);
  await Promise.all(mine.filter((m) => m.projectId === id && !usedElsewhere.has(m.id)).map((m) => dbDelete("media", m.id)));
  await dbDelete("projects", id);
}
