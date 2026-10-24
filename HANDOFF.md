# HANDOFF — SUBWAY / J line splat ride

Shared working file for the agents on this project (Fable in Claude Code, Codex CLI) and for the owner.
Read this first. Update the **Task queue** and **Status** when you finish something. Keep it short.

## Status (2026-10-25 02:00)

- Live: https://jaspan-eng.github.io/SUBWAY/ (GitHub Pages, deploys from `main` via `.github/workflows/pages.yml`).
- Latest commits: `5fdbfb3` the ride UI (station sign, route strip, captions), `2737d90` day mode (Krea-relit colour variant).
- Assets in git: `public/splats/subway.spz` (night car, 12.3 MB, 530,657 gaussians), `public/splats/subway_day.spz` (same
  gaussians, daylight colours, 8.9 MB). Both are allow-listed in `.gitignore`.
- Local-only, outside this repo (`E:\THESIS REVAMP\SUBWAY\Project Files\`): Cinema 4D scenes, Redshift renders, the
  gsplat trainer and the Krea batch tooling. See **Pipeline** below. Cinema 4D is rendering the physically lit day
  pass (`Splat\images_day`, ~1 frame/min, 502 total) and then an 800-view 1600x900 night set (`Splat\images_v2`).

## What the page is

A scroll-only ride through a graffiti-covered subway car on the elevated J line, Flushing Av -> Kosciuszko St.
One gesture boards; scrolling moves the train; five stops; night turns to day; Google 3D Tiles outside the windows.
Design principles (keep them): no setup, no visible controls, the camera is guided, New York in the type and sound,
moments instead of menus. Dev panel only with `?gui` or the H key. `?free` disables the story.

## Repo map

| file | role |
| --- | --- |
| `index.html` | all CSS: tokens (`--bg --fg --j`, 4px spacing scale, z-index scale), station sign, route strip, captions |
| `src/main.js` | wiring: renderer, Spark SplatMesh load, relight (day colours), city, story, GUI, frame loop |
| `src/story.js` | `STOPS` keyframes, station-sign loader (`setLoading/setReady`), boarding, route strip, captions |
| `src/ride.js` | dolly camera along the car + pointer look (`lookYaw/lookPitch` set in main.js settings) |
| `src/relight.js` | per-splat night->day colour crossfade (Spark objectModifier reading a day-colour texture), `setGain` |
| `src/city.js` | Google Photorealistic 3D Tiles along `data/route_j.json`; night/day presets; fog + sky dome |
| `src/flow.js` `sway.js` `morph.js` `plexus.js` `rings.js` `look.js` `blobs.js` | ALTM modules (spring sim, rock, grain/vignette/HUD) |
| `tools/ply2spz.mjs` | 3DGS .ply -> .spz via Spark's transcoder |

Run: `npm install && npm run dev` (port 5173). Needs `VITE_GOOGLE_MAPS_API_KEY` in `.env.local` for the city
(repo secret in CI). Verify in a browser; `?gui` shows the panel, status and HUD. Keep the dev server closed while
Redshift renders on this machine (same GPU).

## Pipeline (local machine only; not runnable from the cloud)

- Trainer: `Splat\train_splat.py` (gsplat 1.5.2, venv `Splat\.venv310`). Exact poses, no COLMAP.
- Day colour variant from Krea-relit frames (shipped):
  `python train_splat.py --data krea_day/full_data --init_splat train_01/subway_culled2.ply --freeze_geometry --freeze_opacity --reset_sh --mask_from_night images --out krea_day/train_full --iters 15000 --lr_sh0 0.01`
  then `node tools/ply2spz.mjs <ply> public/splats/subway_day.spz 0 0.02`. Same recipe for any themed variant.
- Redshift day pass (physically lit): when `Splat\images_day` has 502 frames, same command with
  `--data day --mask_bright 0.97` (no `--mask_from_night`), compare against the Krea result, ship the better one.
- v2 sharper car: when `Splat\images_v2` has 800 frames: `python train_splat.py --data v2 --iters 60000 --cap 3000000 --out train_v2`,
  then `cull_windows.py`, `ply2spz.mjs`, replace `subway.spz`, retrain the day colours against the new geometry.
- Krea: edits were submitted through the Krea MCP (OAuth, compute units). Batch tooling in `Splat\krea_day\`
  (`fetch_jobs.sh`, `align_check.py`, prompts in `Splat\prompts\`). An API token would bill a separate prepaid balance.

## Task queue

Each ticket is self-contained. Take one, do it on `main` in this folder, commit with a clear message, mark it here.
Do not take a ticket that touches files another agent is editing (see **Who is on what**).

- [ ] **T1 City tiles fade-in** (`src/city.js`). Tiles currently pop. On each `load-model` event start the tile's
  material at opacity 0 and ramp to 1 over ~400 ms (transform/opacity only, per-material `onBeforeCompile` already
  exists for fog: add a `uFade` uniform there). Acceptance: no visible pop when scrolling through Broadway; no console
  errors; frame rate unchanged.
- [ ] **T2 Passenger billboards scaffold** (new `src/passengers.js`, data `data/passengers.json`). Camera-facing image
  planes placed at seat and standing positions in sim space (car = 1 unit long, x along the car, y up, z across;
  seat cushion height ~0.1 of the box, benches at |z| ~0.5 of half width). Load PNGs with alpha from
  `public/passengers/`, fade in/out per stop via `story.state.stop` (crowd at Myrtle Av, a few elsewhere), no
  images yet: ship with an empty JSON and a `?passengers=debug` mode that shows grey silhouettes so placement can be
  checked. Acceptance: debug silhouettes sit on the seats at every stop; zero cost when the JSON is empty.
- [ ] **T3 Sound layer** (new `src/sound.js`). Tap-to-enable (a small `Sound` toggle in the station sign and bottom
  right), ambient track rumble loop + door chime at stations, volume ducking at stops. Assets go in `public/audio/`
  (none yet; use a synthesized Web Audio rumble as placeholder). Respect autoplay rules. Acceptance: silent until
  enabled, no errors when assets are missing.
- [ ] **T4 Door moment** (`src/story.js`, `src/main.js`). At a station stop (`station: true`) when `local` is near 0:
  brief brightness lift on the car via `relight`/`look` and a caption tick "Stand clear of the closing doors".
- [ ] **T5 Mobile pass** (`index.html`). Test at 375x812: strip, captions, sign. Touch scroll boards and rides.
- [ ] **T6 Day look** (`src/city.js`, `settings.city.dayGain`). dayGain 1.25 -> ~1.1; day sky/fog values tuned against
  the Krea day colours; keep night untouched.

Done:
- [x] Day mode (Krea-relit colour variant + relight modifier) — Fable, 2737d90
- [x] Ride UI: station sign, one-gesture boarding, route strip, captions, guided camera — Fable, 5fdbfb3

## Who is on what

- Codex: T1, then T2. Files: `src/city.js`, `src/passengers.js`, `data/passengers.json`, `src/main.js` (passenger wiring only).
- Fable: pipeline (renders, training, Krea), review of Codex commits in the browser, T6 after the Redshift day pass.
- Owner: references (Are.na), passenger image direction, audio assets.

## Working agreement (Fable + Codex)

- The queue above is the interface. Tickets carry files, intent and acceptance criteria; no ticket without them.
- Codex takes implementation tickets that are fully specified. Fable writes tickets, does MCP-only work (Cinema 4D,
  Krea, browser verification), reviews diffs and verifies in the browser before deploy.
- Never two agents on the same files at once. Commit per ticket, small messages, push when verified.
- Quota: Codex tokens go to implementation, not exploration; this file plus the repo map should remove the need to
  explore. Fable tokens go to direction and verification. If a ticket needs discovery, Fable does it and writes the
  findings into the ticket first.
