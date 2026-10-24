/**
 * SUBWAY — J line splat viewer.
 *
 * Three.js + Spark. Loads the trained subway car splat (public/splats/subway.spz)
 * or a procedural stand-in built from the car mesh, rides a dolly camera along the
 * car (src/ride.js), and runs the ALTM spring simulation driven by pointer strokes
 * (src/flow.js) plus a gentle carriage rock (src/sway.js) as Spark objectModifiers.
 *
 * Splat sources:
 *   - GUI "source": subway (trained .spz when present), standin (mesh points)
 *   - drop a .spz / .ply / .splat / .ksplat on the window
 *   - ?splat=/splats/file.spz  (files in public/splats/)
 */
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import GUI from "lil-gui";
import { createSwayModifier } from "./sway.js";
import { createFlowSim, createFlowModifier, FLOW_DEFAULTS } from "./flow.js";
import { createMorphModifier } from "./morph.js";
import { createBlobLayer, BLOB_DEFAULTS } from "./blobs.js";
import { patchSparkMaterial, RING_DEFAULTS } from "./rings.js";
import { createPlexus, PLEXUS_DEFAULTS } from "./plexus.js";
import { createLook, LOOK_DEFAULTS } from "./look.js";
import { createRide, RIDE_DEFAULTS } from "./ride.js";
import { loadStandInPoints, buildStandIn, SUBWAY_DEFAULTS } from "./subway.js";

/** Trained car, first one found wins (not in git; drop it into public/splats/). */
const BASE = import.meta.env.BASE_URL; // "/" in dev, "/<repo>/" on GitHub Pages
const TRAINED_SPLATS = [`${BASE}splats/subway.spz`, `${BASE}splats/subway.ply`];

const app = document.getElementById("app");
const status = document.getElementById("status");
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setClearColor(new THREE.Color(LOOK_DEFAULTS.background), 1);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Interior: near plane tight, the whole car is ~1 sim unit long.
const camera = new THREE.PerspectiveCamera(RIDE_DEFAULTS.fov, 1, 0.002, 50);

const spark = new SparkRenderer({ renderer, autoUpdate: true });
scene.add(spark);

let rings = null;
try {
  rings = patchSparkMaterial(spark);
} catch (err) {
  console.warn("Ring contour patch disabled:", err);
}

// ---------------------------------------------------------------- modifiers + rigs
const sway = createSwayModifier();
sway.uniforms.swayAmplitude.value = 0.004;
sway.uniforms.swayFrequency.value = 1.1;

const flow = createFlowSim(renderer);
const flowMod = createFlowModifier(flow);
const morphMod = createMorphModifier();

const plexus = createPlexus(flow, morphMod);
scene.add(plexus.object);
const look = createLook(document.body);
const ride = createRide(camera, renderer.domElement);

let simBox = null;
let restSim = null;
let splatLabel = "";
let splatCount = 0;
let pointerOver = false;
/** @type {ReturnType<typeof createBlobLayer> | null} */
let blobLayer = null;

const blobParam = params.get("blobs"); // ?blobs=webcam or ?blobs=ws://host:9980
const settings = {
  source: params.get("splat") ? "url" : "subway",
  ride: { ...RIDE_DEFAULTS },
  flow: { ...FLOW_DEFAULTS, limit: 0.03, brushRadius: 140, force: 2.5 },
  sway: { enabled: true, amplitude: sway.uniforms.swayAmplitude.value, frequency: sway.uniforms.swayFrequency.value, tilt: 0.2 },
  standin: { ...SUBWAY_DEFAULTS },
  blobs: {
    ...BLOB_DEFAULTS,
    source: blobParam === "webcam" ? "webcam" : blobParam?.startsWith("ws") ? "websocket" : "none",
    wsUrl: blobParam?.startsWith("ws") ? blobParam : BLOB_DEFAULTS.wsUrl,
  },
  look: { ...LOOK_DEFAULTS, title: "SUBWAY — J LINE", background: "#07090c", floor: false },
  rings: { ...RING_DEFAULTS },
  plexus: { ...PLEXUS_DEFAULTS },
  resetSim: () => flow.reset(),
};

// ---------------------------------------------------------------- GUI
const gui = new GUI({ title: "SUBWAY" });
gui.add(settings, "source", ["subway", "standin"]).onChange(loadSource);

const gRide = gui.addFolder("ride (dolly)");
gRide.add(settings.ride, "progress", 0, 1, 0.001).listen().onChange(applyRide);
gRide.add(settings.ride, "autoRide").onChange(applyRide);
gRide.add(settings.ride, "speed", 0, 0.1, 0.001).onChange(applyRide);
gRide.add(settings.ride, "bounce").onChange(applyRide);
gRide.add(settings.ride, "eyeHeight", 0.2, 0.9, 0.01).onChange(applyRide);
gRide.add(settings.ride, "fov", 40, 110, 1).onChange(applyRide);
gRide.add(settings.ride, "lookYaw", 0, 120, 1).onChange(applyRide);
gRide.add(settings.ride, "lookPitch", 0, 60, 1).onChange(applyRide);
gRide.add(settings.ride, "strokeDepth", 0.02, 0.4, 0.005).onChange(applyRide);
gRide.add(settings.ride, "rock", 0, 0.02, 0.0005).onChange(applyRide);

const gFlow = gui.addFolder("flow (spring sim)");
gFlow.add(settings.flow, "enabled").onChange(applyFlow);
gFlow.add(settings.flow, "force", 0, 10, 0.1).onChange(applyFlow);
gFlow.add(settings.flow, "stiffness", 1, 60, 0.5).onChange(applyFlow);
gFlow.add(settings.flow, "damping", 0, 20, 0.1).onChange(applyFlow);
gFlow.add(settings.flow, "curl", 0, 3, 0.01).onChange(applyFlow);
gFlow.add(settings.flow, "limit", 0.005, 0.3, 0.005).onChange(applyFlow);
gFlow.add(settings.flow, "variation", 0, 1, 0.01).onChange(applyFlow);
gFlow.add(settings.flow, "brushRadius", 10, 500, 1).onChange(applyFlow);
gFlow.add(settings, "resetSim");
const gAlign = gFlow.addFolder("alignment + streaks");
gAlign.add(settings.flow, "alignment", 0, 1, 0.01).onChange(applyFlow);
gAlign.add(settings.flow, "alignDirect").onChange(applyFlow);
gAlign.add(settings.flow, "alignSpeed", 0.01, 2, 0.01).onChange(applyFlow);
gAlign.add(settings.flow, "alignFollow", 0, 30, 0.1).onChange(applyFlow);
gAlign.add(settings.flow, "alignReturn", 0.1, 20, 0.1).onChange(applyFlow);
gAlign.add(settings.flow, "streakAmount", 0, 1, 0.01).onChange(applyFlow);
gAlign.add(settings.flow, "streakSize", 0.1, 3, 0.01).onChange(applyFlow);
gAlign.add(settings.flow, "streakThickness", 0.01, 1, 0.01).onChange(applyFlow);
gAlign.close();

const gLook = gui.addFolder("look");
gLook.addColor(settings.look, "background").onChange(applyLook);
gLook.add(settings.look, "grain").onChange(applyLook);
gLook.add(settings.look, "grainOpacity", 0, 0.6, 0.01).onChange(applyLook);
gLook.add(settings.look, "grainSize", 0.5, 4, 0.05).onChange(applyLook);
gLook.add(settings.look, "vignette").onChange(applyLook);
gLook.add(settings.look, "vignetteAmount", 0, 1, 0.01).onChange(applyLook);
gLook.add(settings.look, "vignetteStart", 0, 100, 1).onChange(applyLook);
gLook.add(settings.look, "hud").onChange(applyLook);
gLook.addColor(settings.look, "hudColor").onChange(applyLook);
gLook.add(settings.look, "hudOpacity", 0, 1, 0.01).onChange(applyLook);
gLook.add(settings.look, "title").onFinishChange(applyLook);
const gRings = gLook.addFolder("ring contours + grade");
gRings.add(settings.rings, "enabled").onChange(applyRings);
gRings.add(settings.rings, "amount", 0, 1, 0.01).onChange(applyRings);
gRings.add(settings.rings, "radius", 0.1, 2, 0.01).onChange(applyRings);
gRings.add(settings.rings, "width", 0.2, 3, 0.01).onChange(applyRings);
gRings.add(settings.rings, "strength", 0, 1, 0.01).onChange(applyRings);
gRings.add(settings.rings, "fill", 0, 1, 0.01).onChange(applyRings);
gRings.add(settings.rings, "stretch", 1, 200, 1).onChange(applyRings);
gRings.add(settings.rings, "colorMix", 0, 1, 0.01).onChange(applyRings);
gRings.addColor(settings.rings, "color").onChange(applyRings);
gRings.add(settings.rings, "saturation", 0, 2, 0.01).onChange(applyRings);
gRings.add(settings.rings, "brightness", 0, 2, 0.01).onChange(applyRings);
gRings.add(settings.rings, "contrast", 0.5, 2, 0.01).onChange(applyRings);
gRings.close();
const gPlexus = gLook.addFolder("plexus / scan");
gPlexus.add(settings.plexus, "enabled").onChange(applyPlexus);
gPlexus.add(settings.plexus, "points", 100, 6000, 50).onFinishChange(applyPlexus);
gPlexus.add(settings.plexus, "linkRadius", 0.01, 0.3, 0.005).onFinishChange(applyPlexus);
gPlexus.add(settings.plexus, "maxLinks", 0, 8, 1).onFinishChange(applyPlexus);
gPlexus.add(settings.plexus, "dotSize", 0.5, 8, 0.1).onChange(applyPlexus);
gPlexus.add(settings.plexus, "opacity", 0, 1, 0.01).onChange(applyPlexus);
gPlexus.add(settings.plexus, "lineOpacity", 0, 1, 0.01).onChange(applyPlexus);
gPlexus.add(settings.plexus, "stretchFade", 1.05, 5, 0.05).onChange(applyPlexus);
gPlexus.addColor(settings.plexus, "color").onChange(applyPlexus);
gPlexus.close();
gLook.close();

const gBlobs = gui.addFolder("blobs (tracking)");
gBlobs.add(settings.blobs, "source", ["none", "webcam", "websocket"]).onChange(applyBlobs);
gBlobs.add(settings.blobs, "threshold", 4, 120, 1).onChange(applyBlobs);
gBlobs.add(settings.blobs, "learning", 0, 0.2, 0.001).onChange(applyBlobs);
gBlobs.add(settings.blobs, "minArea", 1, 200, 1).onChange(applyBlobs);
gBlobs.add(settings.blobs, "maxBlobs", 1, 8, 1).onChange(applyBlobs);
gBlobs.add(settings.blobs, "smoothing", 0, 0.95, 0.01).onChange(applyBlobs);
gBlobs.add(settings.blobs, "mirror").onChange(applyBlobs);
gBlobs.add(settings.blobs, "debug").onChange(applyBlobs);
gBlobs.add(settings.blobs, "wsUrl").onFinishChange(applyBlobs);
gBlobs.close();

const gSway = gui.addFolder("rock (carriage)");
gSway.add(settings.sway, "enabled").onChange(applyModifiers);
gSway.add(settings.sway, "amplitude", 0, 0.03, 0.0005).onChange((v) => (sway.uniforms.swayAmplitude.value = v));
gSway.add(settings.sway, "frequency", 0, 6, 0.01).onChange((v) => (sway.uniforms.swayFrequency.value = v));
gSway.add(settings.sway, "tilt", 0, 1, 0.01).onChange((v) => (sway.uniforms.swayTilt.value = v));
gSway.close();

const gStand = gui.addFolder("stand-in (rebuild)");
gStand.add(settings.standin, "splatSize", 0.005, 0.1, 0.001);
gStand.add(settings.standin, "opacity", 0.1, 1, 0.01);
gStand.add(settings.standin, "seed", 1, 99, 1);
gStand.add({ rebuild: () => loadSource("standin") }, "rebuild");
gStand.close();

function applyRide() {
  ride.configure(settings.ride);
}
function applyLook() {
  look.configure(settings.look);
  renderer.setClearColor(new THREE.Color(settings.look.background), 1);
}
function applyRings() {
  rings?.configure(settings.rings, renderer.getPixelRatio());
}
function applyPlexus() {
  const rebuild = plexus.configure(settings.plexus, renderer.getPixelRatio());
  if (rebuild && restSim) plexus.build(restSim, splatCount);
}
function applyBlobs() {
  blobLayer?.configure(settings.blobs);
}
function applyFlow() {
  flow.configure(settings.flow);
  flowMod.configure(settings.flow);
  applyModifiers();
}

// ---------------------------------------------------------------- splat state
/** @type {SplatMesh | null} */
let mesh = null;
/** sim space -> world. Sim space = splat centred and scaled to width 1. */
const simToWorld = new THREE.Matrix4();
const simToObject = new THREE.Matrix4();
const simToObject3 = new THREE.Matrix3();

function setStatus(text) {
  status.textContent = text;
}

/** Percentile bounding box of the active rest positions (sim space). */
function robustBox(rest, count, lo = 0.02, hi = 0.98) {
  const box = new THREE.Box3();
  const step = Math.max(1, Math.floor(count / 200000));
  for (let axis = 0; axis < 3; axis++) {
    const vals = [];
    for (let i = 0; i < count; i += step) if (rest[i * 4 + 3] > 0.5) vals.push(rest[i * 4 + axis]);
    vals.sort((a, b) => a - b);
    if (!vals.length) return box.set(new THREE.Vector3(-0.5, -0.1, -0.1), new THREE.Vector3(0.5, 0.1, 0.1));
    box.min.setComponent(axis, vals[Math.floor(lo * (vals.length - 1))]);
    box.max.setComponent(axis, vals[Math.floor(hi * (vals.length - 1))]);
  }
  return box;
}

function applyModifiers() {
  if (!mesh) return;
  const list = [];
  if (settings.flow.enabled) list.push(flowMod.modifier);
  if (settings.sway.enabled) list.push(sway.modifier);
  mesh.objectModifiers = list.length ? list : undefined;
  mesh.updateGenerator();
}

async function findTrainedSplat() {
  for (const url of TRAINED_SPLATS) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok && !(res.headers.get("content-type") || "").includes("text/html")) return url;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

async function loadSource(source) {
  if (source === "subway") {
    const url = await findTrainedSplat();
    if (url) return loadSplat({ url, label: `subway car (trained, ${url.split(".").pop()})` });
    setStatus("no trained splat at public/splats/subway.spz yet — building the stand-in…");
    source = "standin";
  }
  if (source === "standin") {
    const xyz = await loadStandInPoints(settings.standin.pointsUrl);
    const o = { ...settings.standin };
    return loadSplat({
      label: `stand-in car (${(xyz.length / 3).toLocaleString()} mesh points)`,
      maxSplats: xyz.length / 3,
      constructSplats: (splats) => buildStandIn(splats, xyz, o),
    });
  }
  if (source === "url") return loadSplat({ url: params.get("splat") });
}

async function loadSplat(source) {
  if (mesh) {
    scene.remove(mesh);
    mesh.dispose();
    mesh = null;
  }
  const { label: givenLabel, ...options } = source;
  const label = givenLabel ?? source.fileName ?? source.url;
  setStatus(`loading ${label}…`);

  const next = new SplatMesh({
    ...options,
    raycastable: false,
    lod: false, // keep gsplat.index == original index (the sim texel lookup relies on it)
    onProgress: (e) => {
      if (e.lengthComputable) setStatus(`loading ${label}  ${Math.round((100 * e.loaded) / e.total)}%`);
    },
  });

  try {
    await next.initialized;
  } catch (err) {
    console.error(err);
    setStatus(`failed to load ${label}\n${err?.message ?? err}`);
    next.dispose();
    return;
  }

  mesh = next;
  scene.add(mesh);

  // Placement: centre the splat and scale its widest axis (the car's length) to 1 unit.
  const box = mesh.getBoundingBox(true);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const scale = 1 / Math.max(size.x, size.y, size.z, 1e-6);
  mesh.scale.setScalar(scale);
  mesh.position.copy(centre).multiplyScalar(-scale);
  mesh.updateMatrixWorld(true);

  simToObject.makeTranslation(centre.x, centre.y, centre.z).multiply(new THREE.Matrix4().makeScale(1 / scale, 1 / scale, 1 / scale));
  simToWorld.multiplyMatrices(mesh.matrixWorld, simToObject);
  simToObject3.setFromMatrix4(simToObject);
  flowMod.setToObject(simToObject3);

  const count = mesh.packedSplats?.numSplats ?? 0;
  const rest = new Float32Array(count * 4);
  const objToSim = simToObject.clone().invert();
  const v = new THREE.Vector3();
  mesh.forEachSplat((index, center, _scales, _quat, opacity) => {
    v.copy(center).applyMatrix4(objToSim);
    const o = index * 4;
    rest[o] = v.x;
    rest[o + 1] = v.y;
    rest[o + 2] = v.z;
    rest[o + 3] = opacity > 0.03 ? 1 : 0;
  });
  flow.setRest(rest, count);

  restSim = rest;
  splatCount = count;
  splatLabel = label;
  simBox = box.clone().applyMatrix4(objToSim);
  // The dolly uses a robust box (2nd..98th percentile per axis) so stray gaussians
  // outside the car cannot push the eye line or the path off.
  ride.setBounds(robustBox(rest, count), simToWorld);
  plexus.setTransform(simToWorld);
  plexus.setMorphEnabled(false);
  applyPlexus();
  plexus.build(rest, count);
  applyRings();
  applyLook();
  applyRide();

  sway.fitTo(box);
  applyFlow();

  setStatus(`${label}\n${count.toLocaleString()} splats · ${flow.rows} sim rows · scroll to ride · move the pointer to look and push · drop a file to replace`);
}

// ---------------------------------------------------------------- pointer -> look + strokes
const pointerNdc = new THREE.Vector2();
function toNdc(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointerNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
  return pointerNdc;
}
let touchDown = false;
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch") touchDown = true;
});
window.addEventListener("pointermove", (e) => {
  const p = toNdc(e);
  const active = e.pointerType !== "touch" || touchDown;
  pointerOver = Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
  ride.setPointer(pointerOver ? p : null);
  flow.point(p.x, p.y, active);
});
const endPointer = () => {
  touchDown = false;
  pointerOver = false;
  ride.setPointer(null);
  flow.point(pointerNdc.x, pointerNdc.y, false);
};
renderer.domElement.addEventListener("pointerup", endPointer);
renderer.domElement.addEventListener("pointercancel", endPointer);
document.documentElement.addEventListener("pointerleave", endPointer);
window.addEventListener("blur", () => flow.release());

// ---------------------------------------------------------------- drag & drop
let dragDepth = 0;
window.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; document.body.classList.add("dragging"); });
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("dragging"); } });
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  loadSplat({ fileBytes, fileName: file.name });
});

// ---------------------------------------------------------------- resize + loop
function resize() {
  const w = app.clientWidth;
  const h = app.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(app);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  const t = clock.elapsedTime;
  ride.update(dt, t);
  flow.setStrokeOrigin(ride.strokeOrigin);
  if (mesh) {
    let dirty = false;
    if (blobLayer) for (const s of blobLayer.consumeSegments()) flow.stroke(s.ax, s.ay, s.bx, s.by);
    if (settings.flow.enabled) {
      const r = renderer.domElement.getBoundingClientRect();
      dirty = flow.step(dt, camera, simToWorld, r.width, r.height) || dirty;
    }
    if (settings.sway.enabled) {
      sway.tick(t);
      dirty = true;
    }
    if (dirty) mesh.updateVersion();
  }
  renderer.render(scene, camera);
  if (settings.look.hud) {
    const r = renderer.domElement.getBoundingClientRect();
    look.update({
      camera,
      box: simBox,
      simToWorld,
      pointer: pointerOver ? pointerNdc : null,
      size: { width: r.width, height: r.height },
      dpr: Math.min(devicePixelRatio, 2),
      info: {
        source: splatLabel.slice(0, 28),
        splats: splatCount.toLocaleString(),
        ride: `${(ride.progress * 100).toFixed(0)}%`,
        sim: flow.awake ? "live" : "idle",
        blobs: blobLayer?.source === "none" ? "off" : `${blobLayer?.blobs.length ?? 0} ${blobLayer?.source ?? ""}`,
      },
    });
  }
});

blobLayer = createBlobLayer(document.body, settings.blobs);
blobLayer.configure(settings.blobs);

loadSource(settings.source);

Object.assign(window, { scene, camera, renderer, spark, sway, flow, flowMod, ride, blobLayer, rings, plexus, look, getMesh: () => mesh, settings });
