# ans-photo-editor

A browser photo editor for social carousels: an **Instagram carousel**, a **TikTok photo post**
and a **YouTube post**. **One set, edited once** (Tom, 2026-11-18): `project.set = { ratio, items }`. The top bar's
Instagram | TikTok | YouTube only changes how it's shown (Phone view, Feed / Profile; `project.stage`), and each icon says
how well the set suits that app (`fitFor` in js/project.js): faded = it doesn't take the set's shape, a dot = something to
know (too many slides, videos left out), said in its hover box; TikTok shows a shape other than 9:16 inside its tall screen,
on black. What each app takes (checked Oct 2026, `STAGES`): Instagram 4:5 / 3:4 (app only since May 2025) / 1:1 / 1.91:1,
up to 20, videos; TikTok 9:16 / 4:5 / 1:1, up to 35, photos only; YouTube 1:1 / 4:5 / 16:9, up to 10, photos only. The
shape menu (`SHAPES`) names the apps each shape suits ("4:5 · all three", "9:16 · TikTok"). A new project starts on 4:5.
Older records (a set per platform, `project.stages`, or a "Linked" `project.items`) open with the set last edited; the
others, the post text and the TikTok fill are dropped (`tidyProject`). No "Same on every platform" switch, no Copy to,
no Post text (the post's words are written in Post). Laptop first; phone later.

**Live** (free, behind the site's login) at anewsong.club/photo-editor/ (the page, in ans-website) and
/photo-editor/app/ (this app, installable: `manifest.webmanifest`, `sw.js`, `js/install.js`).
ans-website's `deploy.sh` copies this folder in (left out: `.assetsignore`); GitHub Actions clones
the public repo github.com/cryptoegg/ans-photo-editor instead. So: commit and push here, then push
ans-website (or run its `./deploy.sh`) to put a change live.

Plain JavaScript ES modules, **no build step**: `index.html` loads `js/main.js`. Libraries load
from CDNs only when needed (heic-to for iPhone HEIC in browsers that can't read it, JSZip for the
zip export). Styles: `styles.css`. Run with any static server from this folder, e.g.
`python3 -m http.server 8765` (`.claude/launch.json` has it).

## How it fits together

- **Project record**: `js/project.js`. One object holds everything (set.items = the filmstrip). An **item** is one photo; a **panorama** is one item with `span` > 1
  (one photo across `span` squares). Crop = where the photo sits, free like the lyric app's
  pictures (zoom 1 = Fill; smaller shows the slide's `background`, white by default; Fit / Fill in
  `js/render.js`); look = filter preset + strength + Light / Colour; texts (align incl. justify,
  backgrounds incl. "Around the words" = `lines`, stroke (1 to start), rotation). **New settings go in the record, never in loose variables.**
- **State**: `js/state.js`: selection (item ids: what Filters / Adjust change), current item
  (what Crop / Text change), view, undo / redo (whole copies of the record; `commit()` = one
  step), `changed(what)` events ("project", "selection", "view", "look" mid-drag, "commit").
- **Storage**: `js/store.js` (IndexedDB "ans_photo": projects, media, meta). Auto-saved after
  every commit; File ▾ lists them. Photos: `js/media.js` keeps each original once and
  decodes a full + preview (1600 px) picture.
- **Layers** (several photos on one slide): the slide's own photo is layer 1 (item.mediaId / crop
  / look / style); more are `item.layers` [{ id, mediaId, crop, look, style }]. `item.layout.kind`:
  "single" / "free" (each moves, sizes, turns; later on top; style = corners, border, shadow, plus opacity
  and blend (`BLENDS` in render.js), set for the picked layer under the Layers list) or a
  grid from `LAYOUTS` (2h, 2v, 3h, 2x2, 1+2: layer i fills cell i, its crop placed in the cell;
  `gap`, `radius`; no template picker any more (Tom, 2026-11-11): new slides are free, a slide saved in a
  grid keeps it). Duplicate a photo: ⌘D with it picked, or right-click it (canvas or Layers row) →
  Duplicate (`duplicateLayer`; right-click menus: `js/ui/menu.js`). The Layers box (top of the panel, `buildLayersBox` in panel.js; drag a row or ↑ ↓ to reorder, `placeLayer`) picks a layer
  (`state.layerId`, `currentLayer()`), and Filters / Adjust / Crop then change just that one.
  Actions: `addLayerFiles`, `setLayout`, `moveLayer`, `removeLayer`. On a panorama (Tom, 2026-11-18) the photos sit anywhere across its slides: changing its slides keeps them the same size and place (`reframe` in actions.js), and Split apart gives each slide its own copy of the ones it shows. A video slide takes
  photo layers too: the video is the bottom layer and stays there (can't move, be removed or duplicated).
- **Adding**: new photos / videos go into the set after the current slide.
- **Video** (Instagram carousels only; the TikTok and YouTube icons warn, and their Phone view leaves them out): an
  item with `kind: "video"`, `trim` { start, end } (3 to 60 s), `cover` (seconds: its still),
  `muted`. `js/media.js` keeps a player (with sound), a seeker for stills (`stillAt`) and the
  file; `js/ui/videoBar.js` is the bar under the canvas (▶ / space, trim strip, ◆ cover, sound);
  `lookedFrame` (looks.js) puts the look on each frame; export: `js/video/mp4.js` (frames from
  `js/video/clipReader.js`, copied from the lyric app, else by seeking; H.264 30 fps + the clip's
  AAC sound; mp4-muxer and mp4box.js load from the CDN when first needed). No video panoramas.
- **Remove background** (Tom, 2026-11-18): `js/cutout.js` + `js/cutout-worker.js`. The button under Layers (or
  right-click a layer) cuts out the picked photo. The model is BiRefNet 512 (MIT licence; onnx-community/BiRefNet_512x512-ONNX, fp16, about 470 MB),
  run with Transformers.js in a worker: downloaded the first time (progress on the button), then kept by the browser,
  about 1 s a photo on the graphics card (WebGPU), about 40 s without one. The mask is a PNG in the media store; the layer
  gets `cutout: { maskId, on }` (the photo itself is never changed; on / off and undo as anything else). It's laid on
  after the look (`cutOut` in looks.js), shared with the same photo on every platform, saved in the project folder, and
  exported. Not for videos. Checked in Nov 2026: the smaller models (BiRefNet lite, BEN2) hit graphics-card limits, MODNet
  isn't good enough, and imgly / ISNet (AGPL) and BRIA RMBG (non-commercial) aren't allowed on a paid site. Later: an
  edge brush, and the desktop app shipping the model inside.
- **Tools** (Tom, 2026-11-18): its own Editor tab between Adjust and Crop (`state.tab` "tools"; `buildToolsBox` in panel.js, shown under Layers on that tab only; picking a brush anywhere opens it) for the picked photo: Remove
  background, then three brushes (`js/ui/brush.js`, painted on the canvas through stage.js; `state.tool`), covering
  Photoshop's healing tools with no mode pickers:
  - **Remove**: paint over anything; on letting go it's rebuilt (it flashes red / white until it's done). Small strokes: Content-Aware (PatchMatch, onion-peel
    start, `js/fill-worker.js`, no AI). Strokes over a tenth of the photo across: the AI fill, LaMa (Carve/LaMa-ONNX,
    Apache-2.0, 208 MB, downloaded the first time with progress on the button, kept in Cache "ans-models";
    `js/lama-worker.js`, onnxruntime-web 1.31.1 on WebGPU (about 0.3 s; 1.22 and older fail on its Add layer), else
    the processor (about 12 s)); if it can't run, the quick fill instead.
  - **Clone**: Alt-click the source, then paint (Aligned). Blend (default, like the Healing Brush: the edge's colour
    difference spread over the piece) or Exact copy (Clone Stamp).
  - **Eraser**: wipes the photo away (to the slide's background or the layers under it). It paints on the layer's
    mask: the cut-out's if one is on, else a new mask marked `cutout.hand` (Remove background then still runs the
    model and keeps what was erased; the Remove background button doesn't count a hand mask as a cut-out).
  - **Edge brush**: Erase / Restore the mask (a cut-out's or the Eraser's); the whole photo shows faintly meanwhile.
  The tools are icons (`TOOLS_LIST` / `toolIcons` in brush.js: Move (the usual pointer: no brush) · Remove (wand) ·
  Clone (stamp) · Eraser · Edge brush), the same in the canvas bar (first thing on it), the Tools fold (the settings of
  the one picked under them) and the right-click panel on a photo (`showBrushPanel`: the tools, then the brush's
  settings, or with no brush Duplicate / Remove from slide).
- **Shapes and trimmed sides** (Tom, 2026-11-18, like Canva): Crop has the photo's shape (`style.shape`, `PHOTO_SHAPES` /
  `shapePath` in render.js: Rectangle, Circle, Triangle, Diamond, Hexagon, Star, Heart, Arch; Corners only for Rectangle;
  Circle squares the part that shows). A picked photo has side handles on the canvas that trim it (`crop.trim` { l, t, r, b },
  shares of its box; `shownBox`): the part left is what's drawn in its shape, picked, moved, sized and turned; the
  trimmed-off part shows faintly while it's picked. Fit / Fill / Reset clear the trim. Not in a grid; on a panorama the shape runs across the slides (a star cut in half by the seam).
  
- **Skin** (Tom, 2026-11-18): Adjust → Skin (`js/effects/skin.js`, the slide's own `look.skin` { smooth, even, texture },
  run right after Light, before the filter): skin found by its colour (any skin tone), then an edge-keeping blur (Smooth),
  its finest detail laid back (Keep texture) and its colour evened from a wide blur (Even tone). Not in the Effects list.
- **Effect brush** (Tom, 2026-11-18, from his reference pictures): the `fx` tool icon paints an effect onto part of the
  photo. It's a Brush mask carrying `effect: { id, type, settings }` (`BRUSH_EFFECTS` in js/masks.js: Pixelate, Blur,
  Blocks (datamosh), Shards, Pull (stretch), Smear (liquify), Crumple, RGB stripes, Halftone, Black & white; Tom took
  out Tiles, Low poly and Glow), worked out on the whole photo and laid on through the painted mask (looks.js). Picking
  another effect in the Tools fold starts a new brush once this one is painted (one part pixelated, another crumpled);
  in Adjust → Masks the menu changes the picked one's effect. New effects for it in js/effects/ ("Break up"): pixelate,
  shards, crumple, stripes. Settings (`effectBrushControls` in panel.js) in the Tools fold while in hand and in Adjust → Masks.
  No red overlay for it: the effect shows as it's painted.
- **Masks** (Tom, 2026-11-18, like Lightroom's): fixes on part of a photo. Adjust → Masks: Brush · Fade · Round · Subject,
  then a row per mask (Invert, On / Off, ✕) and the picked one's Light and Colour sliders (Round: Feather too). The record
  is the layer's `masks` (`js/masks.js`: brush / subject keep a PNG `maskId`, Fade a `line`, Round a `round`); `state.maskId`
  is the picked one. Each mask's fix is worked out on the whole photo after its own Light / Colour card and laid on
  through the mask before the filter (looks.js). Subject reuses the Remove background model (`subjectMask` in cutout.js).
  Brush: the Mask brush (`state.tool` "mask", Add / Erase, Size / Hardness in the Masks fold), red shown only while
  painting. Fade and Round have handles on the canvas (`js/ui/masks.js`).
- **Notes** (`js/ui/toast.js`, Tom, 2026-11-18): a small dark bar at the top of the canvas, only for what can't be seen
  (a file that won't open, a full set, where an export went). No "done · Undo" notes: `toast(text, undoAction)` shows nothing.
- **Hover boxes** (Tom, 2026-11-18): `js/ui/tips.js` shows any `title` as a small dark box after a short wait (the
  title moves to `data-tip`, so the browser's own doesn't show too). Give every icon a title.
  Settings: Size (a gradual scale, 4 to 500 px, `sizeToSlider`) and Hardness (localStorage; pen pressure sizes the
  dab). As in Photoshop: [ ] size, Shift [ ] hardness, Control + Option drag
  = size (left / right) and hardness (up / down), Esc puts it down. Remove and Clone strokes are small pictures of just
  the part changed (`item.retouch = { tiles: [{ id, x, y, w, h }] }` in photo pixels, media kind "touch-up"; old
  `patchId` still drawn), laid over the photo before the look (`touchedUp` in looks.js); each stroke adds a tile, so
  undo just points back. "Clear touch-ups" takes them all off.
- **Looks**: `js/looks.js` runs Light / Colour then the filter's effect chain on the graphics
  card (`js/effects/gl.js`) and keeps the result, so moving / zooming never re-runs it.
- **Filters**: `js/filters.js`: the presets plus "Your filters" (saved in IndexedDB meta, every
  project). Picking one gives the slide its own copy (`look.chain`). Tiles: Filters · Adjust ·
  Tools · Crop · Captions (words on the slide; `state.tab` "text"). Filter tiles show their names, all in one grid (Original, Your filters, then the ready-made ones;
  no folds); a ☆ on each (on hover) stars it, and All | ★ Starred over the grid shows just the starred ones (localStorage
  `ans_photo_fav_filters` / `ans_photo_fav_only`). Strength floats at the top of Filters only (with a filter on). The presets row (Presets… menu, Save Preset, the dice) puts on
  any filter, saves the slide's look to Your filters (`saveThisFilter`), or a random one. Every setting is in **Adjust**
  (the picked tile's Edit badge goes there): Light ▸, Colour ▸, the filter's own Filter light ▸ /
  Filter colour ▸ (plus Filter curves / per colour / LUT / wheels when its chain has them), Effects ▸ (one fold opening to every effect (inside it), listed like the
  lyric app: tick box, name ▸, one slider, ↺), Background ▸ (one colour picker); an open fold's name floats at the top while its settings scroll (an open effect's just under Effects), then "Save this
  filter" (always there: saves the slide's Light, Colour, filter and effects to Your filters) and
  Reset filter. Switching an effect on with no filter makes the slide's own "custom".
- **Colour card** (Tom, 2026-11-18, copied from the Lyric Visualiser's one Colour card): Adjust → Colour = Presets…
  (`js/effects/colourPresets.js`: each sets Basic, Curves and the wheels, all still movable after) then tabs Basic ·
  Curves · Wheels · Mixer · LUT (`colourCard` in panel.js; the tab kept in localStorage `ans_photo_colour_tab`; ↺ resets
  all five). The slide's own settings are `look.colour`, `look.curves`, `look.grade`, `look.hsl`, `look.lut` (`tidyLook`
  in project.js), run in looks.js after Light: Curves, Colour, Mixer, LUT, Wheels. Curves (`curves.js`) and Colour
  Grading (`grade.js`, the three wheels + Luminance, Blending, Balance) are drawn by `js/ui/colourControls.js` (as in the
  Visualiser). **Mixer** (`hsl.js`, this app's own; "Per colour"): eight colour dots (Red, Orange, Yellow, Green, Aqua,
  Blue, Purple, Pink) and Hue / Saturation / Luminance for the picked one; each pixel shared between the two colours
  its hue sits between, greys untouched. LUT (`lut.js`, `lutStore.js`): your own .cube files ("Load a .cube file…"),
  kept in this browser (IndexedDB `ans_photo_luts`). **Colour tint is gone**: `tintIntoGrade` (`js/effects/oldTint.js`)
  turns any tint in the ready-made filters, Your filters and saved projects into the wheels (+ B&W for Monotone).
  Halation (`halation.js`, Light & blur) is in Effects. Your filters keep the whole Colour card.
- **Effects**: `js/effects/` is copied from ans-visual-text-generator (minus chain.js, chop,
  framerate). `lines.js` (Screen lines: fine
  bright lines over the photo, LED-wall look) is this app's own. `standalone.js` stands in for the song / lyrics the effects used to ask about.
  Filters = `effects/presets.js`, grouped in `js/ui/panel.js` (Everyday · A New Song · Creative).
- **Drawing**: `js/render.js` (`drawItem`, `drawSlides`, `composeTikTok`). Screen, phone view and
  export all draw through it, so **preview = export**.
- **Look: Style 2** (Tom, 2026-11-16), copied from the built Lyric Visualiser (../ans-visual-text-generator,
  `ans-vtg-styles.css` "Style 2"): paper panels flush with the window, thin lines between, Inter Tight, blue
  accent; tokens on `:root` in styles.css; one look, no skins (`skin.js` keeps `uiColour` only). Where the
  ans-UI-kit mock-up and the built Visualiser differ, follow the built app.
- **Smaller, compact** (Tom, 2026-11-17, as the Visualiser): the top bar, Media, the Editor, the canvas bar, the video
  bar and the strip's toolbar are drawn at `--ui-zoom: .85` (CSS `zoom`; the slide, phone and thumbnails never are).
  The Editor is compact: an effect's on / off a small dot by its name; sliders two to a row (in a fold its grid, else
  `pairSliders`); on / off settings small boxes lit when on; labels drop any "(…)" (full name on hover).
- **Layout**: the top bar (‹ Home · File · Export · Post (blue) | in the middle Edit | Phone,
  Instagram | TikTok | YouTube, Feed | Profile as icons (faint while editing), centred over the canvas | at the right the
  Editor's five tabs, spread over the Editor (`alignBar` in main.js); the name is the window title, "● Trial — Photo Editor"), then three
  columns, Media 320 | canvas | Editor 320 (each folds to a 44px strip with its blue arrow, remembered in
  localStorage), then the slides strip.
- **UI**: `js/ui/mediaColumn.js` (Media: Photos, Videos (3 across), Your filters with their dates;
  click a picture = its first slide), `js/ui/stage.js` (Edit view, behaving like the lyric app's mediaFrame: click a photo
  or text to pick it; dashed frame + corner squares on hover; drag inside = move, corner = size
  around the middle, just outside a corner or the ↻ knob = turn (Shift 15°, settles on quarter
  turns, double-click ↻ = upright); pinch anywhere zooms the view toward the pointer, never the photo, and zoomed in a two-finger scroll moves around, Fit resets; hold Space and drag (the hand, as in Photoshop; a tap of Space still plays a video) or drag the grey round the slide to move the view (Tom, 2026-11-18; `viewPan` in stage.js); faint photo past the edges;
  guides and Canva-style soft snapping, ⌘ = free; the faint photo past the edges shows only
  while the photo is picked; pinch / ⌘-scroll over the desk zooms the view; the slide on a dotted desk
  with a soft shadow; under it the floating canvas bar: ‹ Slide 3 of 7 ›, the shape menu, − Fit +,
  guides, snapping, background colour, Before (hold), `showCanvasBar` in main.js; it scrolls sideways in a narrow window, the mouse wheel too), `filmstrip.js`
  (the slides strip: toolbar with fold, Add (blue), trays of actions (Panorama, Tom 2026-11-18: makes the slide a
  panorama of 2, then a number with ▴ ▾ beside it takes it up to 10 slides or back to 1; Join as panorama with several
  picked; Split apart), "7 of 20"; slides numbered above,
  the current one ringed blue), `panel.js` (the Editor: Editor + undo / redo + fold arrow (its five tabs are in the top bar);
  presets row; Apply this slide | Apply all (7 slides) (Filters and Adjust only; greyed on the other tabs); Layers (count, +, Bottom / Top); then the tile's settings:
  sliders with a blue fill (`fillTrack`), switches, blue fold names after a chevron; "mixed"
  sliders; a note with Undo when a change hits several slides),
  `phone.js` (Phone view: just the screen, rounded, laid out at 393 × 852 (as the Visualiser's) and scaled to
  fit, ‹ › beside it, − Fit + floating under it and pinch / ⌘-scroll to zoom; dark-mode stand-ins for Instagram, TikTok and YouTube copied from real screenshots; flick
  through; Feed | Profile: Profile = the post first on your page, Instagram's and TikTok's 3-across
  grids of 3:4 tiles (the first slide cut to 3:4 from the middle) and YouTube's Posts tab,
  `buildProfile`; the video on the shown slide plays on a loop (`playShown`); the phone and the panel follow each other, so edits in Phone view go to the slide
  on the phone). File = `openFileMenu`: the name, New / Save / Save as / Open, Settings…, the projects in
  this browser; Post = the artist's Social Media Calendar in Identity. Opens on a blank project; `?open=<projectId>` (the
  Account page's link, anewsong.club/account/) reopens that one, then drops the param, Delete / Backspace removes the selected slides,
  `dialogs.js` (Export, Projects). Home (top left) goes back to Identity's home page, /identity/.
- **Main folder & saving**: `js/folder.js` (Chrome / Edge): a main folder chosen once (Settings
  or the first Save / Export); Save (⌘S) writes `<name> Project/<name>.ans` + Images/ + Backup/
  (last 5); Save as… (⇧⌘S) copies the project under a new name; Open project folder… reads a
  .ans and its Images/. Projects are also always auto-saved in this browser. Settings (File ▾ → Settings…, ⌘,) =
  `openSettings` in `js/ui/dialogs.js`: the main folder, what's saved where, keys.
  **Never use `confirm()` / `prompt()`**: the Claude app's pane answers No without showing them;
  use `ask()` in `js/ui/dialogs.js`.
- **Export**: `js/exporter.js`. One export (Tom, 2026-11-18): a JPEG per slide (MP4 for a video), numbered in swipe
  order, 1080 wide in the set's shape (4:5 = 1080 × 1350). Chrome / Edge: written into `<name> Project/Exports/` in a
  place chosen once.
  Other browsers and the Claude app's pane: one zip. Re-drawn on canvas, so no EXIF / GPS.

## Tom's choices

- Labels: a capital first letter, never all caps. Helvetica in the UI. New UI colours use a role.
- Several photos per slide: Layers box, Free or a grid, each layer its own look. Remove background
  (Tom, 2026-11-18, replacing "no background removal"). No sound (people add it in TikTok).
- Later: brand kit, video panoramas, text across panorama seams, "send to phone", direct
  posting (Instagram API / TikTok drafts; YouTube posts have no API).

## Keys

← → slides (or the phone) · ⇧-click / ⌘-click select · ⌘A all · ⌘C / ⌘V copy / paste a look ·
⌘D duplicate (the picked photo, else the slides) · hold \ before / after · ⌘Z / ⇧⌘Z · [ ] brush size · Shift [ ] hardness · right-click (brush in hand) brush panel · Alt-click Clone's source · Esc puts the brush down · Delete removes the picked text · ⌘-scroll
zooms the view.
