# HANDOFF — SUBWAY / J line splat ride

Shared working file for the agents on this project (Fable in Claude Code, Codex CLI) and for the owner.
Read this first. Update the **Task queue** and **Status** when you finish something. Keep it short.

## Status (2026-10-25 02:00)

- T7 implemented (uncommitted): instanced near-field el, shared city transform/tint/fog, 250 m window and fades. Browser acceptance pending: confirm GLB Y-up, longest horizontal axis follows rails, and bounding-box top is rail height.
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
  `python train_splat.py --data day --init_splat train_01/subway_culled2.ply --freeze_geometry --freeze_opacity --reset_sh --mask_from_night images --mask_bright 0.97 --out train_day_rs --iters 15000 --lr_sh0 0.01`
  (the shipped day variant: Redshift day pass in `Splat\images_day`; the earlier Krea variant used `--data krea_day/full_data`, kept in `Splatariants\`)
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

- [x] **T1 City tiles fade-in** (`src/city.js`). Tiles currently pop. On each `load-model` event start the tile's
  material at opacity 0 and ramp to 1 over ~400 ms (transform/opacity only, per-material `onBeforeCompile` already
  exists for fog: add a `uFade` uniform there). Acceptance: no visible pop when scrolling through Broadway; no console
  errors; frame rate unchanged.
- [x] **T2 Passengers** (new `src/passengers.js`; data `data/passengers.json` (exists, 6 seat slots, no images yet);
  wiring in `src/main.js`; images later in `public/passengers/`). T8 rank 9. Seated figures as image planes in the
  car frame with contact shadows, presence per stop, and a debug silhouette mode so placement can be checked before
  any photo exists. Everything below was measured by Fable from the splat; no exploration needed.
  - **Car frame** (metres; x along the car, y up, z across; same frame as `data/windows.json`, fitted exactly like
    `src/windows.js`: a `THREE.Group` in the scene, `fit(centre, scale)` → `position = -centre * scale`,
    `scale = scale`, called in `loadSplat` right after `interiorPracticals.fit(centre, scale)`; `clear()` next to
    `interiorPracticals.clear()`). Floor **y = 1.35**. Bench cushion top **y = 1.84**, cushion spans **|z| 0.70
    (front edge, aisle side) to 1.15 (wall)**, centre |z| = 0.88. Benches run **x = −4.5 … −0.9 and 0.75 … 4.3** on
    both sides (door gaps |x| < 0.7 and |x| > 4.4). Stanchions at **x = ±0.8, z = ±0.6** (bench ends by the centre
    doors) and end bulkheads at x = ±6.4. Ceiling 3.85.
  - **Data** `data/passengers.json`: `{ figures: [ { id, x, side: 1 | -1 (z sign: +1 = left bench), image: string |
    null, height: 1.25, yaw: 0, presence: { flushing, broadway, myrtle, daybreak, kosciuszko } } ] }`. `presence`
    values 0..1 per stop id (the ids in `STOPS` in `src/story.js`); `height` is the seated figure height in metres
    from the floor; `image` is a file name under `public/passengers/` (PNG with alpha, figure cut out, seated, facing
    the camera/aisle, feet at the bottom edge of the image) or `null`.
  - **Placement**: a `PlaneGeometry` per figure, width = height × image aspect (debug: 0.62), bottom edge at the
    floor (y = 1.35), centred at `x`, at **z = side × 0.78** (knees sit in front of the cushion), the plane facing the
    aisle (normal toward z = 0, i.e. rotation.y = side > 0 ? π : 0 for a plane whose front is +z), plus a limited
    yaw toward the camera each frame: compute the angle from the plane to the camera in the car's xz plane and
    apply `clamp(angle, −0.35, 0.35)` rad on top of the base facing. No free billboarding (the ticket in T8 asks for
    fixed seat-facing planes with limited yaw). Contact shadow: a second plane 0.70 × 0.55 m lying flat at
    **y = 1.845** under each figure, centred at (x, side × 0.88), `MeshBasicMaterial` black, `transparent`,
    `depthWrite: false`, opacity 0.2 × presence, with a radial-gradient alpha texture (canvas, 64 px) so it feathers.
  - **Materials**: `MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    toneMapped: false })`, `alphaTest: 0.02`, `renderOrder = 1002` (after glass 1000 and tubes 1001). Texture
    `colorSpace = THREE.SRGBColorSpace`. Tint with day/night: `color` = lerp((0.78, 0.82, 0.95), (1, 1, 1), dayNight)
    (fluorescent at night, neutral by day). Depth test stays on so the stanchions occlude figures if the splat
    renderer writes depth; Fable verifies that in the browser.
  - **Presence**: use `story.state.t` (continuous stop index 0..4) and `story.stops[i].id`: presence(t) = lerp of the
    neighbouring stops' values with `THREE.MathUtils.smoothstep(t − i, 0, 1)`; material.opacity = presence; skip the
    draw (`visible = false`) when presence < 0.01. Both `story` and the figures' `update(state, camera, dayNight)` are
    called from the animation loop in main.js right after `interiorPracticals.update(...)`. Zero cost when
    `figures` is empty: create no meshes, `update` returns at once.
  - **Debug** `?passengers=debug` (`params.has("passengers")` style like `?gui`): every figure with `image: null`
    gets a procedurally drawn grey seated silhouette (canvas 256 × 512: head circle, shoulders, torso to the seat,
    thighs forward, shins down to the bottom edge, fill `rgba(170,170,180,0.85)`), so slots show without photos.
    Without the flag, figures with `image: null` are skipped. Image loading: `THREE.TextureLoader` from
    `${base}passengers/${image}`; on error warn once and fall back to the silhouette only in debug mode.
  - **GUI** (`src/main.js`): folder `passengers` with `enabled`, `shadow` (0..0.5, default 0.2), `yawLimit`
    (0..0.8, default 0.35), `tintNight` colour; `settings.passengers = { ...PASSENGER_DEFAULTS }`.
  - Acceptance: with `?gui&passengers=debug`, at every stop the silhouettes sit on the benches with feet on the floor
    and hips on the cushion line, shadows under them, the Myrtle stop shows all six and Kosciuszko one; the planes
    turn only slightly as the camera looks around; nothing renders and no warnings appear when the JSON has no
    figures or the flag is absent. No console errors. Fable verifies in the browser.
- [ ] **T3 Sound layer** (new `src/sound.js`). Tap-to-enable (a small `Sound` toggle in the station sign and bottom
  right), ambient track rumble loop + door chime at stations, volume ducking at stops. Assets go in `public/audio/`
  (none yet; use a synthesized Web Audio rumble as placeholder). Respect autoplay rules. Acceptance: silent until
  enabled, no errors when assets are missing.
- [ ] **T4 Door moment** (`src/story.js`, `src/main.js`). At a station stop (`station: true`) when `local` is near 0:
  brief brightness lift on the car via `relight`/`look` and a caption tick "Stand clear of the closing doors".
- [ ] **T5 Mobile pass** (`index.html`). Test at 375x812: strip, captions, sign. Touch scroll boards and rides.
- [ ] **T6 Day look** (`src/city.js`, `settings.city.dayGain`). dayGain 1.25 -> ~1.1; day sky/fog values tuned against
  the Krea day colours; keep night untouched.
- [x] **T7 Near-field elevated structure** (implemented; browser verification pending) (new `src/structure.js`, assets in `public/props/`). The Google tiles are
  far-field only; the steel el under and beside the car is what sells the ride. Fable generates a repeating "bent" of
  the Broadway el with Hunyuan3D (`public/props/el_bent.glb`, PBR, reference image in
  `E:\THESIS REVAMP\SUBWAY\Project Files\Refs\krea3d\el_girder_ref.png`). Codex: (1) optimise the GLB for the web
  with `npx @gltf-transform/cli optimize in.glb out.glb --texture-compress webp --texture-size 2048 --simplify-error 0.001`
  (keep under ~8 MB); (2) load it with GLTFLoader (+DRACOLoader from `public/draco/` if compressed); (3) instance it along
  `data/route_j.json` with `InstancedMesh`, one bent every real bent spacing (about 15 m; derive the section length from
  the GLB bounding box and scale the mesh so its width across the tracks is ~10.5 m), oriented to the route tangent,
  deck top at rail height (the car floor is `floorAboveRail` 1.1 m above rail: see how `city.js` places the tiles root,
  reuse the same root/transform so the structure moves with the journey); (4) use the same night/day tint + fog
  treatment as the tiles (`nightMaterial` in city.js, or share its uniforms) so it matches; (5) frustum-cull: only
  instances within ~250 m of the car are drawn. Acceptance: from inside the car the girders and columns pass under the
  windows at the right scale at every stop, no pop, frame rate within 10% of before, GLB cached by the browser.
- [ ] **T8 Realism review** (no code). Fable captures 6 screenshots of the ride (night, el, Myrtle, dawn, day, end) into
  `E:\THESIS REVAMP\SUBWAY\Project Files\Refs
eview\` plus 6 reference frames from `Refs\jline\`. Codex reviews them
  side by side (`codex --image`) and writes a ranked list of the 10 things that most break realism, each with a concrete
  fix (values, files), appended to this queue as tickets. Codex acts as the realism supervisor for the following tickets.
- [ ] **T9 Reference library** (running, Codex): public YouTube J-line window footage frames + Wikimedia/NYPL/LoC stills
  into `Web\subway-splat\refs\jline\ (git-ignored)`, with `refs.md` and a contact sheet.

- [ ] **T10 Restore exterior depth in the windows** (`src/city.js`, `data/route_j.json`, `src/structure.js`). T8 rank 1:
  verify tile readiness and route/height registration before grading; probe trackHeight offsets +/-1 m then +/-3 m
  from -2.5, keeping floorAboveRail 1.1. Try errorTarget 6 -> 3 after alignment. Add visible trackside catwalk/railing
  detail on the shared root (initial railing height 1.0-1.2 m); do not lift the undercar el into view artificially.
  Acceptance: all five review cameras show near structure plus farther buildings in side windows; correct occlusion,
  distinct near/far parallax during scroll, no pop, frame rate within 10% of baseline. See `refs/review/review.md`.
- [ ] **T11 Repair day-car surface continuity** (`public/splats/subway.spz`, `public/splats/subway_day.spz`,
  `src/relight.js`, `src/main.js`; source training per Pipeline, Fable). T8 rank 2: isolate First light's beige floor
  patch at day mix 0/0.5/1 with floor helper off before assigning its cause. Use pending 800-view base retrain
  (initial 60k iterations / 3M cap) and physically lit day renders; retrain day colours on the new geometry and
  preserve identical Gaussian identity/order through both exports, not just count. Acceptance: floor remains solid,
  pole bases and seats stay attached, doors/rails retain coherent silhouettes at S3-S5 and between them; no ghosting
  or filled windows through the crossfade. Deliver paired assets, not a day file against the old base.
  Part 1 done 2026-10-25: the Redshift day pass is rendered (502) and its colour-only retrain replaced `subway_day.spz` (dayGain 1.0). Part 2 (v2 geometry + paired day colours) waits for `images_v2` (800 frames, rendering).
- [ ] **T12 Recover daylight tonal separation** (`src/city.js`, `src/main.js`, `src/relight.js`; coordinate T6).
  T8 rank 3: try dayGain 1.25 -> 1.05-1.10; CITY_DAY brightness 1.0, fogDensity 0.0006-0.0009,
  skyZenith #668ab4, skyHorizon #c8d4df. Compare after T11 or retune when its assets land; city settings do not
  repair baked interior lighting. Acceptance: matched S4/S5 captures retain shaded recesses and distinct metal,
  blue seats and floor; exterior remains brighter than shaded interior, no broad clipped patches, night unchanged.
- [x] **T13 Add restrained window glass cues** (new `src/windows.js`, wiring `src/main.js`). T8 rank 4:
  fit planes to car apertures with subtle dirt and a view-dependent interior reflection proxy. Start Fresnel F0 0.04,
  dirt opacity 0.02-0.05, reflection strength 0.08-0.15 night / 0.02-0.05 day; disable transparent depth writes and
  verify Spark/mesh compositing explicitly. Acceptance: reflections shift with view and stay inside openings,
  poles/benches occlude glass correctly, no sorting flashes at all five stops; exterior remains readable.
- [x] **T14 Give night lighting visible sources** (new `src/practicals.js`; wiring in `src/city.js` (exterior) and
  `src/main.js` (interior fit + GUI)). T8 rank 5. Web side only: emissive meshes where the light already is in the
  baked splat, plus sparse exterior lamps. (Baking matching spill into the training renders is a separate Fable job.)
  Everything below was measured by Fable; no exploration needed.
  - **Interior fixtures (car frame).** The trained car frame is metres, x along the car, y up, z across (same frame as
    `data/windows.json`). The two fluorescent rows are continuous bright strips in the splat at **z = +0.75 and
    z = −0.75, y = 3.75, x from −6.2 to +6.3** (ceiling is at y ≈ 3.85; the second pair of bright lines at z = ±1.1,
    y = 3.53 is the chrome cove above the ad panels, not a light). Build each row as tubes 1.2 m long, 0.10 m wide,
    0.1 m gap, as one `InstancedMesh` of a thin box (0.03 m tall) or plane facing down, centred on the row, with a
    `MeshBasicMaterial` (`toneMapped: false`, `fog: false`, `depthWrite: false`, `transparent: false`), colour
    4000 K ≈ (1.0, 0.93, 0.80) × `interiorIntensity` (default 1.6, clamp display to ≤ 1 per channel after the
    multiply so it reads as a hot white, not clipped colour). Follow `src/windows.js` exactly for the frame: a
    `THREE.Group` added to the scene, `fit(centre, scale)` sets `position = -centre * scale`, `scale = scale`, called
    from `loadSplat` in main.js right after `windowGlass.fit(centre, scale)`; `clear()` from where
    `windowGlass.clear()` is called. `renderOrder = 1001` (after the glass). Keep interior tubes on in daylight at 70 %
    (car lights stay on); do not add halos inside the car.
  - **Exterior sources (route frame).** Create `createPracticals({ root, route })` in `createCity` right after
    `createHero`; `practicals.configure(p)` from `applyLook` (reads `p.dayNight`), `practicals.update(dt, distance)`
    from `update` next to `structure.update(dt, journey * route.total)`, `practicals.dispose()` from `dispose`. Copy
    `src/structure.js` for the frame (a `THREE.Group` with `rotation.y = Math.PI` under `root`, positions
    `(x, y, -y_route)` from `route.sample(s)`, yaw `atan2(dy, dx)`) and for the ±250 m instancing window keyed on
    route distance. Rail height is y = 0 in `root`; the street is at y ≈ −10.5 (Myrtle, measured), use that constant.
    Three kinds, each an `InstancedMesh` with `instanceColor`:
    1. **Street lamps** under the el: every 35 m along the route, alternating sides, lateral offset ±11 m from the
       track centreline (sidewalk line), y = −2.5 (8 m above the street), sodium 2200 K ≈ (1.0, 0.62, 0.25).
    2. **Platform lights** at the three stations (`route.stations[name].s`: Flushing Av 138.8, Myrtle Av-Broadway
       810.9, Kosciuszko St 1526.1): every 6 m for ±75 m around each s, both sides at lateral ±7 m, y = +3.2, cool
       4500 K ≈ (1.0, 0.95, 0.88).
    3. **Signals**: every 180 m, right-hand side only, lateral +6 m, y = +1.5, green (0.25, 1.0, 0.35); every third
       one red (1.0, 0.2, 0.15).
    Each source = a small emitter (icosahedron radius 0.12 m, `MeshBasicMaterial`, `toneMapped: false`) and a halo:
    a 1.4 m camera-facing quad per instance drawn with a `ShaderMaterial` (billboard in the vertex shader from the
    instance position + camera right/up from `modelViewMatrix`), radial falloff `pow(1 - r, 3)`, additive blending,
    `depthWrite: false`, `transparent: true`, alpha ≤ 0.35 × `halo` (default 1.0). Halos must stay small: no screen
    bloom, no fog-sized glow. Multiply exterior intensity by `(1 - dayNight)` (off in daylight); emitters themselves
    stay but drop to 25 % in daylight. Keep allocation out of `update`.
  - **GUI** (`src/main.js`): folder `practicals (lights)` with `enabled`, `interiorIntensity` (0..4),
    `exteriorIntensity` (0..4, default 2.0), `halo` (0..3), `lampSpacing` (20..60, default 35);
    `settings.practicals = { ...PRACTICALS_DEFAULTS }` exported from practicals.js, passed to the interior object's
    `configure` and through `city.configure({ practicals: settings.practicals })` to the exterior one. Changing a
    value re-lays the instances immediately.
  - Acceptance: at night (`?gui`, Flushing or Broadway stops) the ceiling rows read as the source of the existing
    silver ceiling highlights, out of the windows there are sparse amber lamps below and ahead with visible depth
    (nearer = larger halo), platform lights at the stops, an occasional signal; no uniform glow wash; by daylight
    (Kosciuszko) nothing luminous remains outside and the interior tubes are faint. No console errors. Fable verifies
    in the browser.
- [x] **T15 Myrtle Av hero zone** (new `src/hero.js`; wiring in `src/city.js`; a GUI folder in `src/main.js`).
  Everything below was measured by Fable; no exploration needed.
  - Data: `data/myrtle_corner.json` = `{ origin, buildings[], pois[] }`. `buildings[i]` = `{ id, x, y, dist, height,
    levels, name, building, pts: [[x,y],...] (closed ring), businesses[] }`, route-local metres, x east, y north,
    origin = the Myrtle Av-Broadway route point (`route.stations["Myrtle Av-Broadway"].s` = 810.9 m; `route.sample(s)`
    gives `x,y,dx,dy` in the same frame; the route heading there is −31.5° from east). Sorted by `dist`.
  - Assets (Draco + WebP, one mesh each, Y-up, arbitrary native scale; load with GLTFLoader + DRACOLoader from
    `${base}draco/` exactly like `src/structure.js`): `public/props/hero/myrtle_station.glb` (whole station: platform
    deck with railings on top, mezzanine under it, glass-block elevator tower and stair down to the street; long axis =
    the platforms), `public/props/hero/corner_fastfood.glb` (one-storey corner block with roof units),
    `public/props/hero/bushwick_3storey.glb` (brick 3-storey corner tenement with a shop at street level).
  - Frame: the tiles' root (`root` in city.js) is at rail height, metres, east = −X, north = +Z. Follow structure.js:
    one `THREE.Group` with `rotation.y = Math.PI` under `root`, then place in route coordinates as
    `position.set(x, groundY, -y)` and yaw with `quaternion.setFromAxisAngle(up, atan2(dy, dx))`.
  - Ground: the street around Myrtle sits at **y = −10.5 m** in the root frame (measured from the tile vertices:
    5th percentile −8.4, minimum −11.2, rail deck at 0). Make it a setting `groundY` (default −10.5).
  - Placement rules: (1) station house: centre on the Myrtle route point, long horizontal axis along the route heading,
    scale uniformly so its total height = `stationHeight` (default 14 m), bottom at `groundY`; expose `stationLift`
    (default 0 m) to nudge it up/down. (2) `corner_fastfood.glb` on footprint id 250317334 (centroid (20.7, −72.3),
    OSM height 4.2 m). (3) `bushwick_3storey.glb` on every other footprint with `dist <= 120`, `height` between 8 and 14
    m, and whose centroid is more than 12 m from the route centreline (sample the route every 5 m from s−150 to s+150
    and take the min distance; this skips the odd OSM polygons mapped under the el, e.g. id 250408680 at 3.5 m).
    For (2) and (3): take the footprint's longest edge as heading, the oriented extents along/across that edge as the
    target size, scale the model uniformly so its longer horizontal extent matches the footprint's longer extent
    (clamp the model height to 0.8–1.3 × OSM `height` by a second, vertical-only scale if needed), rotate to the edge
    heading, place bottom at `groundY`, centre at the centroid. Share one geometry/material per GLB (`InstancedMesh`
    for the 3-storey copies).
  - Look: clone the tiles' treatment. `createHero({ root, route, base, fogUniforms, tint })` is created in
    `createCity` right after `createStructure`; `hero.configure(p)` from `applyLook` (tint × brightness, like
    `structure.configure`), `hero.update(dt)` from `update`, `hero.dispose()` from `dispose`. Use the same
    onBeforeCompile fog/fade patch as structure.js (fade in over 400 ms once loaded) with its own
    `customProgramCacheKey` (`"city-hero-fog-v1"`). Materials are lit (keep the GLB's MeshStandardMaterial) so the
    structure's hemisphere/sun light them; the tiles stay unlit.
  - Tile discard: hero meshes must replace, not overlap, the Google blobs. In `nightMaterial` add uniforms
    `uHeroCount` (int), `uHeroBoxes[8]` (vec4: centre x, centre z, half length, half width, in ROOT frame, i.e. after
    the π flip: x = −east, z = north) and `uHeroYaw[8]` (float, the box rotation about Y in the root frame), plus
    `uRootInverse` (mat4, `root.matrixWorld` inverted, refreshed every frame in `update`). Vertex: `vRootPos =
    (uRootInverse * modelMatrix * vec4(position,1)).xyz`. Fragment, before the fog lines: rotate `vRootPos.xz − centre`
    by −yaw, `discard` when both |components| < half extents + 1.0 m and `vRootPos.y < 40.0`. Set the boxes from
    hero.js once the footprints are known (station: length = scaled model length + 10 m, width = scaled model width
    + 6 m; buildings: their oriented extents). Expose `discard` (bool, default true) on the hero settings.
  - GUI (`src/main.js`): folder `hero (Myrtle Av)` with `enabled`, `discard`, `groundY` (−20..0), `stationHeight`
    (8..20), `stationLift` (−5..5); `settings.hero = { enabled: true, discard: true, groundY: -10.5, stationHeight: 14,
    stationLift: 0 }` passed through `city.configure({ hero: settings.hero })` → `hero.configure`.
  - Acceptance: at the Myrtle stop (`?gui`, scroll to the third viewport, or `settings.city.journey = 0.5`) the station
    deck, railings and tower are visible outside the windows at true scale, the fast-food block and the 3-storey
    tenements stand on their footprints with the Google blobs gone underneath (no z-fighting), tint/fog follow
    day/night, no console errors, frame rate within 10 % of before. Fable verifies in the browser.

Done:
- [x] T2: passengers — Codex. Seated planes on the measured bench geometry, presence per stop, limited yaw, contact
  shadows, `?passengers=debug` silhouettes (verified at Myrtle: six, Kosciuszko: one). Needs the owner's cut-outs in
  `public/passengers/` (PNG alpha, seated, feet at the bottom edge) named in `data/passengers.json`; Fable can draft
  candidates with Krea from references. Not verified: stanchions occluding figures (depends on splat depth).
- [x] T14: practicals — Codex + Fable. Interior tubes on the measured fixture rows, route-anchored lamps/platform
  lights/signals with billboard halos, off in daylight. Fable thinned platform lights to every 12 m (6 m read as an
  airstrip). Still to do on the render side: bake matching interior spill into the training renders (Redshift) so
  the splat's own highlights agree with the tubes; retune `interiorIntensity` after that.
- [x] T15: Myrtle Av hero zone — Codex + Fable. Fable's changes on top of the Codex pass: 32 discard boxes with
  precomputed (cos, sin) (`uHeroRot`), tenements capped at the nearest 30 within 80 m, buildings scaled to the
  footprint on both axes (a uniform scale pushed wide blocks across the track), `stationOffset` 12 m (the generated
  station is one 22 x 19.5 m block; centred on the track its deck swallowed the car) and `stationLift` 1.2 so the deck
  top is at platform height, station discard box widened across the track (removes the torn Google slab there).
  Unverified: frame rate (Redshift was saturating the GPU: 2-3 fps with the hero on or off). Follow-ups: hero
  materials look flat dark grey from outside at night (lighting/tint for lit materials), a longer station model
  (the real platforms are ~150 m), per-window exterior framing at the stop (camera look toward the platform).
- [x] T13: window glass planes (Fresnel + dirt) — Codex, e6e1e12
- [x] T1: Fade city tiles in over 400 ms toward fog colour
- [x] Day mode (Krea-relit colour variant + relight modifier) — Fable, 2737d90
- [x] Ride UI: station sign, one-gesture boarding, route strip, captions, guided camera — Fable, 5fdbfb3

## Who is on what

- Codex: free. Next candidates: T3 sound, T4 door moment, T5 mobile. Fable: T11 after the v2 render; passenger images with the owner.
- Fable: pipeline (renders, training, Krea 3D/2D generation), review of Codex commits in the browser, screenshots for T8, T6 after the Redshift day pass. Bounce fix done (7552696).
- Owner: references (Are.na), passenger image direction, audio assets.

## Working agreement (Fable + Codex)

- The queue above is the interface. Tickets carry files, intent and acceptance criteria; no ticket without them.
- Codex takes implementation tickets that are fully specified. Fable writes tickets, does MCP-only work (Cinema 4D,
  Krea, browser verification), reviews diffs and verifies in the browser before deploy.
- Never two agents on the same files at once. Commit per ticket, small messages, push when verified.
- Quota: Codex tokens go to implementation, not exploration; this file plus the repo map should remove the need to
  explore. Fable tokens go to direction and verification. If a ticket needs discovery, Fable does it and writes the
  findings into the ticket first.
