// A right-click menu at the pointer: showMenu(e, [{ label, keys, action }]). One at a time; a
// click anywhere else, Escape or scrolling closes it.
let open = null;

export function showMenu(e, entries) {
  e.preventDefault();
  closeMenu();
  const menu = Object.assign(document.createElement("div"), { className: "popover context-menu" });
  entries.forEach(({ label, keys, action }) => {
    const row = Object.assign(document.createElement("div"), { className: "menu-item" });
    row.append(Object.assign(document.createElement("span"), { textContent: label }));
    if (keys) row.append(Object.assign(document.createElement("span"), { className: "meta", textContent: keys }));
    row.onclick = () => { closeMenu(); action(); };
    menu.append(row);
  });
  document.body.append(menu);
  // (kept inside the window)
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - r.width - 6)}px`;
  menu.style.top = `${Math.min(e.clientY, window.innerHeight - r.height - 6)}px`;
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
