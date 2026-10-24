# SUBWAY — J line splat

Reactive Gaussian-splat web experience of a graffiti-covered New York subway car,
built on the same stack and modules as the ALTM hay piece: Vite, Three.js, Spark
(`@sparkjsdev/spark`), lil-gui.

```bash
npm install
npm run dev
```

## Splat sources

- `public/splats/subway.spz` — the trained car (12 MB, committed). Loaded by default when present; `subway.ply` works too.
- `public/splats/subway_day.spz` — the same gaussians retrained under daylight (geometry and opacity frozen, so the
  splat order matches). Loaded hidden once; its colours feed the per-splat night→day crossfade (`src/relight.js`).
  `?fakeday` fakes it from the night colours for testing.
- Stand-in: `public/splats/standin_points.f32`, surface points sampled from the Cinema 4D mesh, built into small Gaussians at runtime (`src/subway.js`).
- `?splat=/splats/other.spz`, or drag a `.spz/.ply/.splat/.ksplat` onto the window.

## Controls

The page is a scroll story (`src/story.js`): five chapters from Flushing Av to Kosciuszko St drive the journey along the
route, the night-to-day blend, the dolly position and the sim strength. Move the pointer to look (almost all the way
round), drag to push the splats. `H` toggles the control panel; `?gui` opens it at start; `?free` disables the story
and gives the wheel to the journey directly.

## Modules

| file | role |
| --- | --- |
| `src/ride.js` | dolly camera along the car (auto ride), pointer look, stroke-plane origin |
| `src/story.js` | scroll timeline: chapters as keyframes, captions, hint |
| `src/relight.js` | per-splat colour crossfade night → day (Spark modifier reading a day-colour texture), driven by the story's `dayNight` |
| `src/city.js` | Google Photorealistic 3D Tiles outside the windows, following the J line centreline (`data/route_j.json`); night/day presets, fog, sky dome |
| `src/subway.js` | stand-in splat builder and car dimensions |
| `src/flow.js` | GPU spring simulation; pointer / blob strokes push splats (ALTM, plus `setStrokeOrigin`) |
| `src/sway.js` | gentle carriage rock as a splat modifier (ALTM wind sway) |
| `src/morph.js` | per-splat morph targets (ALTM) |
| `src/blobs.js` | webcam / WebSocket blob tracker for installations (ALTM) |
| `src/rings.js` | ring contour + grade patched into Spark's splat shader (ALTM) |
| `src/plexus.js` | scan dots / links following the sim (ALTM) |
| `src/look.js` | grain, vignette, HUD canvas (ALTM) |

Sim space is the splat normalised to its widest axis = 1 and centred, so the car is
1 unit long. Modifier order: relight → flow → sway. `lod: false` keeps splat indices stable.

## City outside the windows

`src/city.js` streams Google Photorealistic 3D Tiles with [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS).
The car stays at the origin; the city is mounted under one root scaled to sim units, rotated to the track heading and
slid along the J line centreline (`data/route_j.json`, built from OpenStreetMap's BMT Jamaica Line ways between
Flushing Av and Kosciuszko St, Myrtle Av-Broadway in the middle). The mouse wheel scrubs the journey; `auto` rides it.

It needs a Google Maps Platform key with the **Map Tiles API** enabled, restricted by HTTP referrer:

```
# .env.local (not committed)
VITE_GOOGLE_MAPS_API_KEY=...
```

The GitHub Pages workflow reads the same name from the repository secrets. Without a key the viewer still runs; the
windows just stay dark.

## Pipeline (outside this repo)

Scene and training assets live in `E:\THESIS REVAMP\SUBWAY\Project Files\` (`C4D\Setup_1\Setup_1_graffiti.c4d`,
`Splat\` with the camera rig, exact poses in `transforms.json` / COLMAP text, and the rendered training views).

Day variant: the same 502-view rig rendered with `Setup_1_graffiti_day.c4d` (RS sun + sky dome through the windows) into
`Splat\images_day`, poses exported to `Splat\day\transforms.json`, then a colour-only retrain from the night splat:

```
.venv310/Scripts/python train_splat.py --data day --init_splat train_01/subway_culled2.ply \
  --freeze_geometry --freeze_opacity --mask_bright 0.97 --out train_day --iters 8000
node tools/ply2spz.mjs ../Splat/train_day/subway_final.ply public/splats/subway_day.spz
```
