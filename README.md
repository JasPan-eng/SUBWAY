# SUBWAY — J line splat

Reactive Gaussian-splat web experience of a graffiti-covered New York subway car,
built on the same stack and modules as the ALTM hay piece: Vite, Three.js, Spark
(`@sparkjsdev/spark`), lil-gui.

```bash
npm install
npm run dev
```

## Splat sources

- `public/splats/subway.spz` — the trained car (not in git; drop it in locally). Loaded by default when present.
- Stand-in: `public/splats/standin_points.f32`, surface points sampled from the Cinema 4D mesh, built into small Gaussians at runtime (`src/subway.js`).
- `?splat=/splats/other.spz`, or drag a `.spz/.ply/.splat/.ksplat` onto the window.

## Modules

| file | role |
| --- | --- |
| `src/ride.js` | dolly camera along the car (scroll / auto ride), pointer look, stroke-plane origin |
| `src/subway.js` | stand-in splat builder and car dimensions |
| `src/flow.js` | GPU spring simulation; pointer / blob strokes push splats (ALTM, plus `setStrokeOrigin`) |
| `src/sway.js` | gentle carriage rock as a splat modifier (ALTM wind sway) |
| `src/morph.js` | per-splat morph targets (ALTM) |
| `src/blobs.js` | webcam / WebSocket blob tracker for installations (ALTM) |
| `src/rings.js` | ring contour + grade patched into Spark's splat shader (ALTM) |
| `src/plexus.js` | scan dots / links following the sim (ALTM) |
| `src/look.js` | grain, vignette, HUD canvas (ALTM) |

Sim space is the splat normalised to its widest axis = 1 and centred, so the car is
1 unit long. Modifier order: morph → flow → sway. `lod: false` keeps splat indices stable.

## Pipeline (outside this repo)

Scene and training assets live in `E:\THESIS REVAMP\SUBWAY\Project Files\` (`C4D\Setup_1\Setup_1_graffiti.c4d`,
`Splat\` with the camera rig, exact poses in `transforms.json` / COLMAP text, and the rendered training views).
