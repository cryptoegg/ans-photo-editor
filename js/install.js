// Installing the app (an icon on the dock / desktop; it opens in its own window and works
// offline): manifest.webmanifest + sw.js. Chrome / Edge offer it through "beforeinstallprompt":
// a small card in the corner once (Not now: two weeks quiet), and Install as an app in Settings.
// "?install" (the website's Install button) offers it straight away.
import { toast } from './ui/toast.js';

const KEY = "ans_photo_install"; // { notNow: time }
let offer = null;

export const isInstalled = () => matchMedia("(display-mode: standalone)").matches || !!navigator.standalone;
export const canOffer = () => !!offer;
const HOW_TO = "In Chrome or Edge: the install icon at the right of the address bar, or the ⋮ menu → Install.";

export async function installApp() {
  if (isInstalled()) { toast("The Photo Editor is already installed: open it from your Dock, Launchpad or Start menu."); return; }
  if (offer) { const e = offer; offer = null; e.prompt(); await e.userChoice.catch(() => null); return; }
  toast(HOW_TO);
}

export function initInstall() {
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* (no offline copy, that's all) */ });
  }
  const asked = new URLSearchParams(location.search).has("install");
  if (asked) history.replaceState(null, "", location.pathname + location.hash);
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // (our card instead of the browser's own bar)
    offer = e;
    if (isInstalled() || (resting() && !asked)) return;
    setTimeout(card, asked ? 300 : 4000);
  });
  window.addEventListener("appinstalled", () => document.querySelector(".install-card")?.remove());
}

const resting = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); return v.notNow && Date.now() - v.notNow < 14 * 86400e3; } catch (err) { return false; } };

function card() {
  if (document.querySelector(".install-card") || !offer) return;
  const box = document.createElement("div");
  box.className = "install-card";
  box.innerHTML = `<strong>Install the Photo Editor</strong><p>An icon on your dock or desktop. It opens in its own window, like any app, and works offline. Free.</p>`;
  const row = document.createElement("div");
  row.className = "actions";
  const later = Object.assign(document.createElement("button"), { className: "btn ghost small", textContent: "Not now" });
  later.onclick = () => { try { localStorage.setItem(KEY, JSON.stringify({ notNow: Date.now() })); } catch (err) { /* not kept */ } box.remove(); };
  const go = Object.assign(document.createElement("button"), { className: "btn primary small", textContent: "Install" });
  go.onclick = () => { box.remove(); installApp(); };
  row.append(later, go);
  box.append(row);
  document.body.append(box);
}
