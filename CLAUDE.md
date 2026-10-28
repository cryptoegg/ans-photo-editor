# ans-photo-editor

A browser photo editor for social carousels: an **Instagram carousel**, a **TikTok photo post**
and a **YouTube post**. **Linked · 1:1** (the start): one square set suits all three (at most 10
slides). **Separate sets** (Linked off, top bar): each platform is its own stage with its own shape
(checked Oct 2026, `STAGES` in js/project.js: Instagram 4:5 / 1:1 / 1.91:1 / 3:4 (app only since
May 2025), up to 20; TikTok 9:16, or 4:5 / 1:1 exported on a 9:16 frame with the fill, up to 35;
YouTube 1:1 / 4:5 / 16:9, up to 10), slides, crops, panoramas and texts; made from the square set the first time, kept
when you switch back. Looks (filter + adjustments) stay shared across platforms by `lookGroup`
(`shareLooks` in `js/state.js`) unless a slide has its own (`ownLook`, "Same look on every
platform" tick box). Laptop first; phone later. Will be plugged into the website (ans-website) once it's working well.

**Live** (free, no login) at anewsong.club/photo-editor/ (the page, in ans-website) and
/photo-editor/app/ (this app, installable: `manifest.webmanifest`, `sw.js`, `js/install.js`).
ans-website's `deploy.sh` copies this folder in (left out: `.assetsignore`); GitHub Actions clones
the public repo github.com/cryptoegg/ans-photo-editor instead. So: commit and push here, then push
ans-website (or run its `./deploy.sh`) to put a change live.

Plain JavaScript ES modules, **no build step**: `index.html` loads `js/main.js`. Libraries load
from CDNs only when needed (heic2any for iPhone HEIC in browsers that can't read it, JSZip for the
zip export). Styles: `styles.css`. Run with any static server from this folder, e.g.
`python3 -m http.server 8765` (`.claude/launch.json` has it).

## How it fits together

- **Project record**: `js/project.js`. One object holds everything (items = the filmstrip,
  captions, TikTok fill). An **item** is one photo; a **panorama** is one item with `span` > 1
  (one photo across `span` squares). Crop = where the photo sits, free like the lyric app's
  pictures (zoom 1 = Fill; smaller shows the slide's `background`, white by default; Fit / Fill in
  `js/render.js`); look = filter preset + strength + Light / Colour; texts (align incl. justify,
  backgrounds incl. "Around the words" = `lines`, stroke, rotation). **New settings go in the record, never in loose variables.**
- **State**: `js/state.js`: selection (item ids: what Filters / Adjust change), current item
  (what Crop / Text change), view, undo / redo (whole copies of the record; `commit()` = one
  step), `changed(what)` events ("project", "selection", "view", "look" mid-drag, "commit").
- **Storage**: `js/store.js` (IndexedDB "ans_photo": projects, media, meta). Auto-saved after
  every commit; the Projects menu lists them. Photos: `js/media.js` keeps each original once and
  decodes a full + preview (1600 px) picture.
- **Layers** (several photos on one slide): the slide's own photo is layer 1 (item.mediaId / crop
  / look / style); more are `item.layers` [{ id, mediaId, crop, look, style }]. `item.layout.kind`:
  "single" / "free" (each moves, sizes, turns; later on top; style = corners, border, shadow) or a
  grid from `LAYOUTS` (2h, 2v, 3h, 2x2, 1+2: layer i fills cell i, its crop placed in the cell;
  `gap`, `radius`). The Layers box (top of the panel, `buildLayersBox` in panel.js) picks a layer
  (`state.layerId`, `currentLayer()`), and Filters / Adjust / Crop then change just that one.
  Actions: `addLayerFiles`, `setLayout`, `moveLayer`, `removeLayer`. Not for videos or panoramas.
- **Adding**: new photos / videos go into the set being edited and, with separate sets, every
  other platform's set too (fitted to its shape, as far as it has room); Remove only takes them
  out of the platform you're on; Copy to ▾ (filmstrip) copies selected slides to another platform.
- **Video** (Instagram carousels; Linked too, where TikTok / YouTube get the cover still): an
  item with `kind: "video"`, `trim` { start, end } (3 to 60 s), `cover` (seconds: its still),
  `muted`. `js/media.js` keeps a player (with sound), a seeker for stills (`stillAt`) and the
  file; `js/ui/videoBar.js` is the bar under the canvas (▶ / space, trim strip, ◆ cover, sound);
  `lookedFrame` (looks.js) puts the look on each frame; export: `js/video/mp4.js` (frames from
  `js/video/clipReader.js`, copied from the lyric app, else by seeking; H.264 30 fps + the clip's
  AAC sound; mp4-muxer and mp4box.js load from the CDN when first needed). No video panoramas.
- **Looks**: `js/looks.js` runs Light / Colour then the filter's effect chain on the graphics
  card (`js/effects/gl.js`) and keeps the result, so moving / zooming never re-runs it.
- **Filters**: `js/filters.js`: the presets plus "Your filters" (saved in IndexedDB meta, every
  project). Picking one gives the slide its own copy (`look.chain`). Tabs: Filters · Adjust ·
  Crop · Text overlay · Captions. Filters act like presets: no names shown once picked; Strength
  floats at the top of Filters and Adjust (only with a filter on). Every setting is in **Adjust**
  (the picked tile's Edit badge goes there): Light ▸, Colour ▸, the filter's own Filter light ▸ /
  Filter colour ▸ / Colour tint ▸, Effects ▸ (one fold opening to every effect, listed like the
  lyric app: tick box, name ▸, one slider, ↺), Background ▸ (one colour picker), then "Save this
  filter" (always there: saves the slide's Light, Colour, filter and effects to Your filters) and
  Reset filter. Switching an effect on with no filter makes the slide's own "custom".
- **Effects**: `js/effects/` is copied from ans-visual-text-generator (minus chain.js, chop,
  framerate). `standalone.js` stands in for the song / lyrics the effects used to ask about.
  Filters = `effects/presets.js`, grouped in `js/ui/panel.js` (Everyday · A New Song · Creative).
- **Drawing**: `js/render.js` (`drawItem`, `drawSlides`, `composeTikTok`). Screen, phone view and
  export all draw through it, so **preview = export**.
- **UI**: `js/ui/stage.js` (Edit view, behaving like the lyric app's mediaFrame: click a photo
  or text to pick it; dashed frame + corner squares on hover; drag inside = move, corner = size
  around the middle, just outside a corner or the ↻ knob = turn (Shift 15°, settles on quarter
  turns, double-click ↻ = upright); scroll / pinch zooms the photo; faint photo past the edges;
  guides ▦ and Canva-style soft snapping 🧲, ⌘ = free; the faint photo past the edges shows only
  while the photo is picked; pinch / ⌘-scroll over the grey zooms the view), `filmstrip.js`,
  `panel.js` (scope header "Editing all 7 slides", This slide / All; tabs Filters · Adjust
  (+ Background colour, follows the selection) · Crop · Text overlay · Captions; "mixed"
  sliders; a note with Undo when a change hits several slides),
  `phone.js` (Phone view: no phone outline, just the screen, laid out at 390 × 845 and scaled to
  fit, − Fit + and pinch / ⌘-scroll to zoom; dark-mode stand-ins for Instagram, TikTok and YouTube copied from real screenshots; flick
  through), the top bar, one row (A New Song — Photo Editor · Linked | Instagram | TikTok | YouTube · shape (greyed while Linked)
  · Edit | Phone · ⚙ · Projects ▾ · Export), undo / redo to the right of the "Editing slide…" header, Delete / Backspace removes the selected slides,
  fold-out cards (Light ▸, Colour ▸, Background ▸; the filter editor lists every effect like the
  lyric app: tick box, name ▸, one slider (`vibe`), ↺),
  `dialogs.js` (Export, Projects), `skin.js` (same skins as the lyric app).
- **Main folder & saving**: `js/folder.js` (Chrome / Edge): a main folder chosen once (Settings ⚙
  or the first Save / Export); Save (⌘S) writes `<name> Project/<name>.ans` + Images/ + Backup/
  (last 5); Save as… (⇧⌘S) copies the project under a new name; Open project folder… reads a
  .ans and its Images/. Projects are also always auto-saved in this browser. Settings (⚙, ⌘,) =
  `openSettings` in `js/ui/dialogs.js`: the main folder, what's saved where, skin, keys.
  **Never use `confirm()` / `prompt()`**: the Claude app's pane answers No without showing them;
  use `ask()` in `js/ui/dialogs.js`.
- **Export**: `js/exporter.js`. JPEG per slide, numbered in swipe order: Instagram and YouTube
  1080², TikTok 1080×1920 (the square plus the fill: blurred photo or a colour, plus an optional
  title). Chrome / Edge: written into `<name> Project/Exports/<Platform>/` in a place chosen once.
  Other browsers and the Claude app's pane: one zip. Re-drawn on canvas, so no EXIF / GPS.

## Tom's choices

- Labels: a capital first letter, never all caps. Helvetica in the UI. New UI colours use a role.
- Several photos per slide: Layers box, Free or a grid, each layer its own look. No background
  removal. No sound (people add it in TikTok).
- Later: brand kit, separate stages per platform (Linked off: own ratio / crops per platform),
  video (Instagram only; video panoramas), text across panorama seams, "send to phone", direct
  posting (Instagram API / TikTok drafts; YouTube posts have no API).

## Keys

← → slides (or the phone) · ⇧-click / ⌘-click select · ⌘A all · ⌘C / ⌘V copy / paste a look ·
⌘D duplicate · hold \ before / after · ⌘Z / ⇧⌘Z · Delete removes the picked text · ⌘-scroll
zooms the view.
