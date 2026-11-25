// A right-click menu at the pointer: showMenu(e, [{ icon, label, keys, extra, on, action }]). One at a time; a
// click anywhere else, Escape or scrolling closes it. extra: an element after the label (e.g. app icons); on: lit.
// opts.above: an element the menu opens above (a button in a bar at the bottom).
let open = null;

export function showMenu(e, entries, opts = {}) {
  e.preventDefault();
  closeMenu();
  const menu = Object.assign(document.createElement("div"), { className: "popover context-menu" });
  entries.forEach(({ icon, label, keys, extra, on, action }) => {
    const row = Object.assign(document.createElement("div"), { className: "menu-item" + (on ? " on" : "") });
    if (icon) row.append(icon); // (an element before the label, e.g. a ratio's shape)
    row.append(Object.assign(document.createElement("span"), { textContent: label }));
    if (extra) row.append(extra);
    if (keys) row.append(Object.assign(document.createElement("span"), { className: "meta", textContent: keys }));
    row.onclick = () => { closeMenu(); action(); };
    menu.append(row);
  });
  document.body.append(menu);
  // (kept inside the window)
  const r = menu.getBoundingClientRect();
  const b = opts.above && opts.above.getBoundingClientRect();
  menu.style.left = `${Math.max(6, Math.min(b ? b.left : e.clientX, window.innerWidth - r.width - 6))}px`;
  menu.style.top = `${b ? Math.max(6, b.top - r.height - 6) : Math.min(e.clientY, window.innerHeight - r.height - 6)}px`;
  const away = (ev) => { if (ev.type === "keydown" && ev.key !== "Escape") return; if (!menu.contains(ev.target) || ev.type !== "pointerdown") closeMenu(); };
  open = { menu, away };
  setTimeout(() => { if (open && open.menu === menu) { document.addEventListener("pointerdown", away, true); document.addEventListener("keydown", away, true); window.addEventListener("wheel", away, true); } }, 0);
}

export function closeMenu() {
  if (!open) return;
  document.removeEventListener("pointerdown", open.away, true);
  document.removeEventListener("keydown", open.away, true);
  window.removeEventListener("wheel", open.away, true);
  open.menu.remove();
  open = null;
}
