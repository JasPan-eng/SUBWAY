import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import routeJ from '../../data/route_j.json';
import block from '../../data/myrtle_block.json';
import { createRoute } from '../city.js';
import { createHero, HERO_DEFAULTS } from '../hero.js';
import { createStructure } from '../structure.js';
import { createAssetStore, placeExtra } from './assets.js';
import { createMapLayers } from './layers.js';
import { createStreetPlanner, placeStreet } from './props.js';
import { createNavigation } from './navigation.js';
import { createInspector } from './inspect.js';
import { createPanel } from './panel.js';

const base = import.meta.env.BASE_URL;
const scene = new THREE.Scene(), root = new THREE.Group(), frame = new THREE.Group();
root.position.y = 10.5; scene.add(root); frame.rotation.y = Math.PI; root.add(frame);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', '3D map. Arrows or WASD pan, Q and E rotate, plus and minus zoom, R resets.');
document.querySelector('#map').append(renderer.domElement);
const labelRenderer = new CSS2DRenderer(); document.querySelector('#labels').append(labelRenderer.domElement);
labelRenderer.domElement.style.pointerEvents = 'none';
const sky = document.createElement('canvas'); sky.width = 2; sky.height = 256;
const skyContext = sky.getContext('2d'), gradient = skyContext.createLinearGradient(0, 0, 0, 256);
gradient.addColorStop(0, '#9fb4cc'); gradient.addColorStop(1, '#e1e7ec'); skyContext.fillStyle = gradient; skyContext.fillRect(0, 0, 2, 256);
const skyTexture = new THREE.CanvasTexture(sky); skyTexture.colorSpace = THREE.SRGBColorSpace; scene.background = skyTexture;
scene.add(new THREE.HemisphereLight('#dbe7f5', '#b7aa96', 1.1));
const sun = new THREE.DirectionalLight('#fff3dd', 2.2);
// Southwest in root/world coordinates: west +X, south -Z.
sun.position.set(150, Math.tan(THREE.MathUtils.degToRad(50)) * Math.hypot(150, 150), -150);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -180;
sun.shadow.camera.right = sun.shadow.camera.top = 180;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 700;
sun.shadow.bias = -0.00015; sun.shadow.normalBias = 0.06; sun.shadow.radius = 2;
scene.add(sun, sun.target);
const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 3000);
const route = createRoute(routeJ), station = route.sample(810.9);
const stationTarget = new THREE.Vector3(-station.x, 0, station.y);
sun.position.add(stationTarget); sun.target.position.copy(stationTarget);
const navigation = createNavigation(camera, renderer.domElement, stationTarget, Math.atan2(station.dy, station.dx));
const fogUniforms = { uCityFogColor: { value: new THREE.Color('#c8d4df') }, uCityFogDensity: { value: 0.0006 } };
const discardUniforms = {
  uHeroCount: { value: 0 },
  uHeroBoxes: { value: Array.from({ length: 32 }, () => new THREE.Vector4()) },
  uHeroRot: { value: Array.from({ length: 32 }, () => new THREE.Vector2(1, 0)) },
  uRootInverse: { value: new THREE.Matrix4() },
};
const progress = document.querySelector('#progress'), notice = document.querySelector('#notice');
function notify(message) { notice.textContent = message; notice.hidden = !message; }
let needsSync = false;
THREE.DefaultLoadingManager.onStart = () => { progress.hidden = false; };
THREE.DefaultLoadingManager.onProgress = (_url, loaded, total) => {
  progress.style.transform = `scaleX(${loaded / total})`; progress.setAttribute('aria-valuenow', String(Math.round(100 * loaded / total))); needsSync = true;
};
THREE.DefaultLoadingManager.onLoad = () => { progress.hidden = true; needsSync = true; };
THREE.DefaultLoadingManager.onError = () => { notify('Some model assets could not load. Available models remain browsable.'); needsSync = true; };
const hero = createHero({ root, route, base, fogUniforms, tint: new THREE.Color(1, 1, 1), discardUniforms });
hero.configure({ hero: { ...HERO_DEFAULTS }, tint: '#ffffff', brightness: 1.0 });
let resolveHeroReady;
const heroReady = new Promise((resolve) => { resolveHeroReady = resolve; });
if (new URLSearchParams(location.search).has('debug')) window.__explore = { THREE, scene, root, hero, route };
const structure = createStructure({ root, route, base, scene, fogUniforms });
structure.configure({ tint: '#ffffff', brightness: 1.0, skyZenith: '#9fb4cc', fogColor: '#c8d4df', enabled: true });
const covered = new Set(), pickables = [], knownMeshes = new WeakSet();
const layers = createMapLayers(frame, block); layers.rebuildClay(covered, discardUniforms);
const store = createAssetStore(base, fogUniforms);
const tooltip = document.querySelector('#tooltip');
const inspector = createInspector({ renderer, store, base, navigation, onVisibility(value) {
  renderer.shadowMap.needsUpdate = true;
  tooltip.hidden = true; renderer.domElement.style.cursor = ''; document.querySelector('#map').setAttribute('aria-label', value ? 'Model turntable' : 'Brooklyn 3D map');
} });
let models = [], extrasReady = false, clayFinal = false;
const pulses = [];
let pulseStarted = 0;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
function clearPulse() {
  for (const entry of pulses) { entry.material.emissive.copy(entry.color); entry.material.emissiveIntensity = entry.intensity; }
  pulses.length = 0;
}
function select(model, box = model.box) {
  if (model.placement?.type === 'street' && box === model.box) {
    let nearest = Infinity;
    for (const mesh of model.meshes) for (const candidate of mesh.userData.instanceBoxes ?? []) {
      candidate.getCenter(selectionCenter);
      const distance = selectionCenter.distanceToSquared(navigation.controls.target);
      if (distance < nearest) { nearest = distance; box = candidate; }
    }
  }
  if (box.isEmpty()) { inspector.open(model); return; }
  navigation.flyTo(box); clearPulse();
  const materials = new Set();
  for (const mesh of model.meshes) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  for (const material of materials) {
    if (!material.emissive) continue;
    pulses.push({ material, color: material.emissive.clone(), intensity: material.emissiveIntensity });
    material.emissive.set('#b98b42'); material.emissiveIntensity = 0.5;
  }
  pulseStarted = performance.now();
}
const panel = createPanel({ base, select, inspect: (model) => inspector.open(model) });
const rootBox = new THREE.Box3(), instanceMatrix = new THREE.Matrix4(), worldMatrix = new THREE.Matrix4();
const selectionCenter = new THREE.Vector3();
function syncModels() {
  renderer.shadowMap.needsUpdate = true;
  root.updateWorldMatrix(true, true);
  const placements = hero.placements();
  for (const entry of placements) if (entry.footprintId != null) covered.add(String(entry.footprintId));
  for (const model of models) {
    if (model.placement?.type !== 'hero') continue;
    model.box.makeEmpty(); model.meshes.length = 0;
    const filename = model.file?.split('/').pop()?.replace(/\.glb$/i, '');
    const el = model.id === 'el_bent' || filename === 'el_bent';
    root.traverse((mesh) => {
      if (!mesh.isMesh || !(el ? mesh.parent?.name === 'elevated-structure' : mesh.parent?.name === 'myrtle-hero' && (mesh.name === model.id || mesh.name === filename))) return;
      mesh.castShadow = mesh.receiveShadow = true; mesh.userData.model = model; model.meshes.push(mesh);
      if (!knownMeshes.has(mesh)) { knownMeshes.add(mesh); pickables.push(mesh); }
      mesh.userData.instanceBoxes = [];
      if (el) {
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, instanceMatrix); worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
          const box = new THREE.Box3().copy(mesh.geometry.boundingBox).applyMatrix4(worldMatrix);
          mesh.userData.instanceBoxes.push(box); model.box.union(box);
        }
      } else {
        for (const entry of placements) {
          if (entry.name !== mesh.name) continue;
          rootBox.copy(entry.box).applyMatrix4(root.matrixWorld);
          model.box.union(rootBox); mesh.userData.instanceBoxes.push(rootBox.clone());
        }
      }
    });
  }
  // Even if a manifest has renamed an entry, all streamed hero meshes still receive shadows.
  root.traverse((mesh) => { if (mesh.isMesh && (mesh.parent?.name === 'myrtle-hero' || mesh.parent?.name === 'elevated-structure')) mesh.castShadow = mesh.receiveShadow = true; });
  panel.refresh();
}
async function loadManifest() {
  let manifest;
  try {
    const response = await fetch(`${base}props/krea/manifest.json`);
    if (!response.ok) throw new Error('Manifest unavailable');
    manifest = await response.json();
    if (!Array.isArray(manifest.models)) throw new Error('Invalid manifest');
  } catch {
    manifest = (await import('../../data/krea_catalog.json')).default;
  }
  models = manifest.models.map((model) => ({ ...model, file: model.file ?? model.published, box: new THREE.Box3(), meshes: [] }));
  panel.setModels(models); syncModels();
  const buildings = new Map(block.buildings.map((building) => [String(building.id), building]));
  await Promise.all(models.map(async (model) => {
    try { await placeExtra(model, { store, frame, route, buildings, covered, pickables }); }
    catch { notify(`Could not place ${model.name}. You can retry it in Inspect.`); }
  }));
  const streetModels = models.filter((model) => model.placement?.type === 'street');
  if (streetModels.length) {
    await heroReady;
    const plan = createStreetPlanner(block, discardUniforms);
    await Promise.all(streetModels.map(async (model) => {
      try { await placeStreet(model, { store, frame, pickables, plan }); }
      catch { notify(`Could not place ${model.name}. You can retry it in Inspect.`); }
    }));
  }
  extrasReady = true; needsSync = true;
}
loadManifest().catch(() => { extrasReady = true; notify('The model catalog could not load. The block map is still available.'); });

document.querySelector('#compass').addEventListener('click', navigation.compass);
document.querySelector('#tilt').addEventListener('click', navigation.toggleTilt);
document.querySelector('#zoom-in').addEventListener('click', () => navigation.zoom(0.8));
document.querySelector('#zoom-out').addEventListener('click', () => navigation.zoom(1.25));
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), hits = [];
let downX = 0, downY = 0, pointerDown = false;
function pick(event) {
  if (inspector.active) return null;
  pointer.set(event.clientX / innerWidth * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera); hits.length = 0; raycaster.intersectObjects(pickables, false, hits);
  return hits[0] ?? null;
}
renderer.domElement.addEventListener('pointerdown', (event) => { downX = event.clientX; downY = event.clientY; pointerDown = true; tooltip.hidden = true; });
renderer.domElement.addEventListener('pointermove', (event) => {
  if (pointerDown || event.pointerType === 'touch') return;
  const hit = pick(event), model = hit?.object.userData.model;
  tooltip.hidden = !model; renderer.domElement.style.cursor = model ? 'pointer' : '';
  if (model) { tooltip.textContent = model.name; tooltip.style.left = `${Math.max(8, Math.min(event.clientX + 12, innerWidth - 250))}px`; tooltip.style.top = `${Math.max(8, event.clientY - 36)}px`; }
});
renderer.domElement.addEventListener('pointerup', (event) => {
  pointerDown = false;
  if (Math.hypot(event.clientX - downX, event.clientY - downY) > 5 || event.button !== 0) return;
  const hit = pick(event), model = hit?.object.userData.model;
  if (model) select(model, hit.object.userData.instanceBoxes?.[hit.instanceId ?? 0] ?? model.box);
});
renderer.domElement.addEventListener('pointercancel', () => { pointerDown = false; });
renderer.domElement.addEventListener('pointerleave', () => { tooltip.hidden = true; });
navigation.controls.addEventListener('start', () => { tooltip.hidden = true; });
function resize() {
  const width = innerWidth, height = innerHeight;
  renderer.setSize(width, height); labelRenderer.setSize(width, height);
  camera.aspect = width / height; camera.updateProjectionMatrix(); inspector.resize(width, height);
}
window.addEventListener('resize', resize); resize();
const needle = document.querySelector('#needle'), tiltButton = document.querySelector('#tilt');
let previous = performance.now(), headingValue = Infinity, topDown = false, heroFinished = false;
function animate(now) {
  const dt = Math.min(0.05, (now - previous) / 1000); previous = now;
  hero.update(dt); structure.update(dt, 810.9);
  if (hero.ready && !heroFinished) { heroFinished = true; needsSync = true; resolveHeroReady(); }
  if (needsSync) { needsSync = false; syncModels(); }
  if (heroFinished && extrasReady && !clayFinal) {
    clayFinal = true; layers.rebuildClay(covered, discardUniforms); renderer.shadowMap.needsUpdate = true;
  }
  if (pulses.length) {
    const t = (now - pulseStarted) / 1200;
    if (t >= 1) clearPulse();
    else for (let i = 0; i < pulses.length; i++) pulses[i].material.emissiveIntensity = reduced.matches ? 0.35 : 0.2 + Math.sin(t * Math.PI) * 0.6;
  }
  if (inspector.active) inspector.render(dt);
  else {
    navigation.update(dt, now); layers.updateLabels(camera);
    const heading = Math.round(THREE.MathUtils.radToDeg(navigation.controls.getAzimuthalAngle() - Math.PI));
    if (heading !== headingValue) { headingValue = heading; needle.style.transform = `rotate(${heading}deg)`; }
    const nextTopDown = navigation.controls.getPolarAngle() < 0.1;
    if (nextTopDown !== topDown) {
      topDown = nextTopDown; tiltButton.textContent = topDown ? '3D' : '2D';
      tiltButton.setAttribute('aria-label', topDown ? 'Switch to tilted 3D view' : 'Switch to top-down view');
    }
    renderer.render(scene, camera); labelRenderer.render(scene, camera);
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
