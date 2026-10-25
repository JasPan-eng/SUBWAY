import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import corner from "../data/myrtle_corner.json";

// stationOffset: metres to the left of travel for the station house (one 22 x 19.5 m block), clear of the platforms.
// Platforms: generated 12 m modules (open / canopy) tiled for platformHalf metres either side of the stop, both sides
// of the track, track edge platformEdge m from the centreline, deck top platformDeck m above the rails (car floor).
export const HERO_DEFAULTS = {
  enabled: true, discard: true, groundY: -10.5, stationHeight: 14, stationLift: 1.2, stationOffset: 17,
  platforms: true, platformHalf: 75, canopyHalf: 30, platformEdge: 1.65, platformDeck: 1.1, moduleLength: 12, flipPlatforms: false,
};

/** Deck height and track side of a platform module, from its normalised geometry (long axis = x, bottom at y 0). */
function measurePlatform(geometry, size) {
  const pos = geometry.attributes.position, idx = geometry.index;
  const bins = new Float32Array(50);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  const tri = idx ? idx.count / 3 : pos.count / 3;
  for (let t = 0; t < tri; t++) {
    const i0 = idx ? idx.getX(3 * t) : 3 * t, i1 = idx ? idx.getX(3 * t + 1) : 3 * t + 1, i2 = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    const area = n.length() / 2;
    if (area <= 0 || Math.abs(n.y) / (2 * area) < 0.95) continue;
    const y = (a.y + b.y + c.y) / 3 / size.y;
    if (y < 0.75) bins[Math.min(49, Math.floor(y * 50))] += area;
  }
  let best = 0;
  for (let i = 1; i < 50; i++) if (bins[i] > bins[best]) best = i;
  const deckY = (best + 1) / 50 * size.y;
  // Fence, railing and bench stand at the back: the track edge is on the other side.
  let sum = 0, count = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) - deckY;
    if (y > 0.05 * size.y && y < 0.2 * size.y) { sum += pos.getZ(i); count++; }
  }
  return { deckY, trackSign: count && sum / count > 0 ? -1 : 1 };
}

function footprint(building) {
  let longest = 0, yaw = 0;
  const pts = building.pts;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
    const length = dx * dx + dy * dy;
    if (length > longest) { longest = length; yaw = Math.atan2(dy, dx); }
  }
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, y] of pts) {
    const along = x * c + y * s, across = -x * s + y * c;
    minX = Math.min(minX, along); maxX = Math.max(maxX, along);
    minZ = Math.min(minZ, across); maxZ = Math.max(maxZ, across);
  }
  return { ...building, yaw, length: maxX - minX, width: maxZ - minZ };
}

/** Lit landmarks in route metres; discard uniform objects belong to the city. */
export function createHero({ root, route, base, fogUniforms, tint, discardUniforms }) {
  const frame = new THREE.Group();
  frame.name = "myrtle-hero";
  frame.rotation.y = Math.PI;
  root.add(frame);
  let settings = { ...HERO_DEFAULTS }, disposed = false, pending = 5;
  const platformPoint = {};
  const color = new THREE.Color().copy(tint);
  const station = route.sample(route.stations["Myrtle Av-Broadway"].s);
  station.yaw = Math.atan2(station.dy, station.dx);
  const stationPoint = { x: station.x, y: station.y, yaw: station.yaw };
  const boxPoint = { x: station.x, y: station.y, yaw: station.yaw };
  const samples = [];
  for (let offset = -150; offset <= 150; offset += 5) samples.push(route.sample(station.s + offset));
  const fastfood = footprint(corner.buildings.find((b) => b.id === 250317334));
  // Nearest tenement footprints only: one model repeated 68 times reads as a pattern, and the discard
  // uniform holds 32 boxes (station + platforms + fast food + 29).
  const TENEMENT_RANGE = 80, TENEMENT_MAX = 29;
  const buildings = corner.buildings.filter((b) => b.id !== fastfood.id && b.dist <= TENEMENT_RANGE && b.height >= 8 && b.height <= 14
    && samples.every((p) => (b.x - p.x) ** 2 + (b.y - p.y) ** 2 > 144)).slice(0, TENEMENT_MAX).map(footprint);
  const assets = [];
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${base}draco/`);
  const loader = new GLTFLoader().setDRACOLoader(draco);

  function release(source) {
    const textures = new Set(), geometries = new Set(), materials = new Set();
    source.traverse((object) => {
      if (!object.isMesh) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  }

  function place(asset, point, sx, sy, sz, index) {
    position.set(point.x, settings.groundY + (asset.kind === "station" ? settings.stationLift : 0), -point.y);
    quaternion.setFromAxisAngle(up, point.yaw);
    scale.set(sx, sy, sz);
    matrix.compose(position, quaternion, scale);
    if (asset.mesh.isInstancedMesh) asset.mesh.setMatrixAt(index, matrix);
    else matrix.decompose(asset.mesh.position, asset.mesh.quaternion, asset.mesh.scale);
  }

  function layout() {
    frame.visible = settings.enabled;
    let count = 0;
    function box(point, length, width) {
      if (count >= discardUniforms.uHeroBoxes.value.length) return;
      discardUniforms.uHeroBoxes.value[count].set(-point.x, point.y, length / 2, width / 2);
      discardUniforms.uHeroRot.value[count].set(Math.cos(Math.PI + point.yaw), Math.sin(Math.PI + point.yaw));
      count++;
    }
    // Stable box order regardless of which network request completes first.
    for (const kind of ["station", "platforms", "fastfood", "tenement"]) {
      if (kind === "platforms") {
        layoutPlatforms(box);
        continue;
      }
      const asset = assets.find((a) => a.kind === kind);
      if (!asset) continue;
      if (kind === "station") {
        const k = settings.stationHeight / asset.size.y;
        stationPoint.x = station.x - Math.sin(station.yaw) * settings.stationOffset;
        stationPoint.y = station.y + Math.cos(station.yaw) * settings.stationOffset;
        place(asset, stationPoint, k, k, k, 0);
        // The discard box spans from the track to the far side of the deck: the Google tiles' torn
        // station/el slab goes with it and the instanced el bents carry the track through the gap.
        const half = settings.stationOffset / 2;
        boxPoint.x = station.x - Math.sin(station.yaw) * half;
        boxPoint.y = station.y + Math.cos(station.yaw) * half;
        boxPoint.yaw = station.yaw;
        box(boxPoint, asset.size.x * k + 10, asset.size.z * k + Math.abs(settings.stationOffset) + 6);
      } else {
        for (let i = 0; i < asset.points.length; i++) {
          const point = asset.points[i];
          // Match the footprint on both axes: a uniform scale pushed wide blocks across the track.
          const kAlong = point.length / asset.size.x, kAcross = point.width / asset.size.z;
          const height = THREE.MathUtils.clamp(asset.size.y * Math.min(kAlong, kAcross), point.height * 0.8, point.height * 1.3);
          place(asset, point, kAlong, height / asset.size.y, kAcross, i);
          box(point, point.length, point.width);
        }
      }
      if (asset.mesh.isInstancedMesh) {
        asset.mesh.instanceMatrix.needsUpdate = true;
        asset.mesh.computeBoundingBox();
        asset.mesh.computeBoundingSphere();
      }
      asset.mesh.updateMatrixWorld(true);
    }
    for (let i = count; i < discardUniforms.uHeroBoxes.value.length; i++) {
      discardUniforms.uHeroBoxes.value[i].set(0, 0, 0, 0);
      discardUniforms.uHeroRot.value[i].set(1, 0);
    }
    discardUniforms.uHeroCount.value = settings.enabled && settings.discard ? count : 0;
  }

  function layoutPlatforms(box) {
    const open = assets.find((a) => a.kind === "platform_open"), canopy = assets.find((a) => a.kind === "platform_canopy");
    if (!open || !canopy) return;
    const L = settings.moduleLength;
    let nOpen = 0, nCanopy = 0, widest = 0;
    if (settings.platforms) {
      for (let o = -settings.platformHalf + L / 2; o <= settings.platformHalf - L / 2 + 1e-6; o += L) {
        const asset = Math.abs(o) < settings.canopyHalf ? canopy : open;
        const k = L / asset.size.x, width = asset.size.z * k;
        widest = Math.max(widest, width);
        route.sample(station.s + o, platformPoint);
        const yaw = Math.atan2(platformPoint.dy, platformPoint.dx);
        for (const side of [1, -1]) { // +1 = left of travel
          const lateral = side * (settings.platformEdge + width / 2);
          // Local +z faces right of travel, so the left platform wants its track edge on +z.
          const want = side > 0 ? 1 : -1;
          const turn = (asset.trackSign === want) !== settings.flipPlatforms ? 0 : Math.PI;
          position.set(platformPoint.x - Math.sin(yaw) * lateral, settings.platformDeck - asset.deckY * k, -(platformPoint.y + Math.cos(yaw) * lateral));
          quaternion.setFromAxisAngle(up, yaw + turn);
          scale.set(k, k, k);
          matrix.compose(position, quaternion, scale);
          asset.mesh.setMatrixAt(asset === canopy ? nCanopy++ : nOpen++, matrix);
        }
      }
    }
    for (const [asset, n] of [[open, nOpen], [canopy, nCanopy]]) {
      asset.mesh.count = n;
      asset.mesh.instanceMatrix.needsUpdate = true;
      asset.mesh.computeBoundingBox();
      asset.mesh.computeBoundingSphere();
      asset.mesh.updateMatrixWorld(true);
    }
    if (settings.platforms) {
      boxPoint.x = station.x; boxPoint.y = station.y; boxPoint.yaw = station.yaw;
      box(boxPoint, 2 * settings.platformHalf + 4, 2 * (settings.platformEdge + widest) + 2);
    }
  }

  function load(kind, file, points) {
    loader.load(`${base}props/hero/${file}.glb`, (gltf) => {
      const source = gltf.scene;
      if (disposed) { release(source); return; }
      let geometry;
      try {
        source.updateMatrixWorld(true);
        let original;
        source.traverse((object) => { if (object.isMesh && !original) original = object; });
        if (!original || Array.isArray(original.material)) throw new Error("Expected one mesh and material");
        geometry = original.geometry.clone().applyMatrix4(original.matrixWorld);
        geometry.computeBoundingBox();
        const size = geometry.boundingBox.getSize(new THREE.Vector3());
        if (size.z > size.x) geometry.rotateY(Math.PI / 2);
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        bounds.getSize(size);
        if (![size.x, size.y, size.z].every((v) => Number.isFinite(v) && v > 0)) throw new Error("Invalid model bounds");
        geometry.translate(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        const measured = kind.startsWith("platform") ? measurePlatform(geometry, size) : null;
        const material = original.material;
        const originalColor = material.color.clone();
        const uFade = { value: 0 };
        material.color.copy(originalColor).multiply(color);
        material.fog = false;
        material.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, fogUniforms);
          shader.uniforms.uFade = uFade;
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying float vCityDepth;")
            .replace("#include <project_vertex>", "#include <project_vertex>\nvCityDepth = -mvPosition.z;");
          shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "#include <common>\nvarying float vCityDepth;\nuniform vec3 uCityFogColor;\nuniform float uCityFogDensity;\nuniform float uFade;")
            .replace("#include <dithering_fragment>", "#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uCityFogColor, 1.0 - exp(-uCityFogDensity * vCityDepth));\ngl_FragColor.rgb = mix(uCityFogColor, gl_FragColor.rgb, uFade);");
        };
        material.customProgramCacheKey = () => "city-hero-fog-v1";
        const capacity = measured ? 64 : points.length;
        const mesh = kind === "tenement" || measured ? new THREE.InstancedMesh(geometry, material, capacity) : new THREE.Mesh(geometry, material);
        if (measured) mesh.count = 0;
        mesh.name = file;
        frame.add(mesh);
        assets.push({ kind, points, mesh, source, size, originalColor, uFade, elapsed: 0, ...measured });
        layout();
      } catch (error) {
        geometry?.dispose();
        release(source);
        console.warn(`Myrtle hero ${file} failed:`, error);
      } finally {
        if (--pending === 0) draco.dispose();
      }
    }, undefined, (error) => {
      if (--pending === 0) draco.dispose();
      if (!disposed) console.warn(`Myrtle hero ${file} failed to load:`, error);
    });
  }
  load("station", "myrtle_station", [station]);
  load("platform_open", "platform_open", null);
  load("platform_canopy", "platform_canopy", null);
  load("fastfood", "corner_fastfood", [fastfood]);
  load("tenement", "bushwick_3storey", buildings);

  return {
    configure(p) {
      const next = p.hero;
      let changed = false;
      if (next) for (const key of Object.keys(HERO_DEFAULTS)) {
        if (next[key] !== undefined && next[key] !== settings[key]) { settings[key] = next[key]; changed = true; }
      }
      color.set(p.tint).multiplyScalar(p.brightness);
      for (const asset of assets) asset.mesh.material.color.copy(asset.originalColor).multiply(color);
      if (changed) layout();
    },
    update(dt) {
      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        asset.elapsed = Math.min(1, asset.elapsed + Math.max(0, dt) / 0.4);
        asset.uFade.value = 1 - (1 - asset.elapsed) * (1 - asset.elapsed);
      }
    },
    dispose() {
      disposed = true;
      root.remove(frame);
      discardUniforms.uHeroCount.value = 0;
      for (const asset of assets) {
        if (asset.mesh.isInstancedMesh) asset.mesh.dispose();
        asset.mesh.geometry.dispose();
        release(asset.source);
      }
      draco.dispose();
    },
  };
}
