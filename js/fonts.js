// Fonts beyond the eight built in (Tom, 2026-11-26, for the brand kit): any Google Font by its name, or an artist's own
// font file (a caption keeps its `fontUrl`). Loaded the first time a caption needs one; the screen redraws once it's in.
const asked = new Set();
const listeners = new Set();
export const onFontsChange = (fn) => listeners.add(fn);
const tell = () => listeners.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } });

export function useFont(family, url = "", builtIn = false) {
  if (!family || builtIn || asked.has(family)) return;
  asked.add(family);
  if (url) {
    new FontFace(family, `url(${url})`).load().then((f) => { document.fonts.add(f); tell(); }).catch(() => {});
    return;
  }
  const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: `https://fonts.googleapis.com/css2?family=${family.trim().replace(/ /g, "+")}:wght@400;700&display=swap` });
  link.onload = () => document.fonts.load(`400 20px "${family}"`).then(tell, tell);
  document.head.append(link);
}
