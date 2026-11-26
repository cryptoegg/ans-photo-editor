// The brand kit (Tom, 2026-11-26): the artist's colours and fonts, read from their Visual Profiles in Identity (nothing
// typed twice: GET /api/identity/artist, the same login), plus logos added here. A Visual Profile's colours are its 5
// by role (Neutral light, Neutral dark, Signature, Support, Accent); its fonts its 3 by role (Display, Brand text,
// Social): the one picked, else its font style's own (/identity/data/fonts.js), or the artist's own font file.
// Logos are kept in this browser for now (IndexedDB meta "brand-logos:<artist>"; the files in the media store).
import { postArtist } from './ui/post.js';
import { dbGet, dbPut } from './store.js';
import { newId } from './project.js';

const ROLES = [["light", "Neutral light"], ["dark", "Neutral dark"], ["signature", "Signature"], ["support", "Support"], ["accent", "Accent"]];
const FONT_ROLES = [["display", "Display"], ["text", "Brand text"], ["social", "Social"]];

let kit = null, asking = null;
export const brandNow = () => kit; // { artist, name, looks: [{ id, name, colours, fonts }] } once read, or null
export const brandArtist = () => postArtist();

function looksOf(found, styles) {
  return (found.visual || []).map((v) => {
    const d = v.data || {};
    const colours = d.colours ? ROLES.filter(([k]) => d.colours[k]).map(([k, name]) => ({ role: k, name, hex: d.colours[k] })) : [];
    const own = (d.ownFonts || []).filter(Boolean);
    const fonts = FONT_ROLES.map(([role, name]) => {
      const pick = d.fontPick && d.fontPick[role];
      if (pick && pick.startsWith("own:")) {
        const f = own.find((x) => `own:${x.n}` === pick);
        if (f) return { role, name, family: `own-${v.id}-${f.n}`, label: f.name || "Your font", url: `/api/identity/visual/font?visual=${encodeURIComponent(v.id)}&n=${f.n}&v=${f.at || 0}` };
      }
      if (pick && !pick.startsWith("own:")) return { role, name, family: pick, label: pick };
      const style = styles.find((s) => s.id === ((d.fonts || {})[role] || "grotesk"));
      const family = (style && style.sample) || "Inter Tight";
      return { role, name, family, label: family };
    });
    return { id: v.id, name: v.name || "Visual Profile", whole: d.for === "brand", colours, fonts };
  }).sort((a, b) => b.whole - a.whole); // (the whole brand's first)
}

// Read (once a session, or again with fresh)
export function loadBrand(fresh = false) {
  const artist = postArtist();
  if (!artist) return Promise.resolve(null);
  if (kit && kit.artist === artist && !fresh) return Promise.resolve(kit);
  if (asking && !fresh) return asking;
  asking = (async () => {
    let found = window.__brandStandIn || null; // (tests: a stand-in artist)
    if (!found) {
      try {
        const r = await fetch(`/api/identity/artist?id=${encodeURIComponent(artist)}`, { credentials: "same-origin" });
        found = r.ok ? await r.json() : null;
      } catch { found = null; }
    }
    let styles = [];
    try { styles = (await import("/identity/data/fonts.js")).FONT_STYLES || []; } catch { /* (not on this server) */ }
    kit = found ? { artist, name: (found.artist && found.artist.name) || "", looks: looksOf(found, styles) } : { artist, name: "", looks: [] };
    return kit;
  })().finally(() => { asking = null; });
  return asking;
}

// ---- Logos (this browser)
const logoKey = () => `brand-logos:${postArtist() || "none"}`;
export async function brandLogos() {
  try { return (await dbGet("meta", logoKey())) || []; } catch { return []; }
}
export async function addLogo(file) {
  const id = newId("m");
  const bitmap = await createImageBitmap(file);
  await dbPut("media", { id, projectId: "brand-kit", kind: "gif", name: file.name.replace(/\.[^.]+$/, ""), type: file.type, blob: file, width: bitmap.width, height: bitmap.height, added: Date.now() });
  const list = [...(await brandLogos()), { mediaId: id, name: file.name.replace(/\.[^.]+$/, ""), width: bitmap.width, height: bitmap.height }];
  bitmap.close();
  await dbPut("meta", list, logoKey());
  return list;
}
export async function removeLogo(mediaId) {
  const list = (await brandLogos()).filter((l) => l.mediaId !== mediaId);
  await dbPut("meta", list, logoKey());
  return list;
}
