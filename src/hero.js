import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import corner from "../data/myrtle_corner.json";

// stationOffset: metres to the left of travel; the generated station is one 22 x 19.5 m block whose platform deck
// would otherwise sit across the track. stationLift puts the deck top at platform height (rail + 1.2 m).
export const HERO_DEFAULTS = { enabled: true, discard: true, groundY: -10.5, stationHeight: 14, stationLift: 1.2, stationOffset: 12 };

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
  let settings = { ...HERO_DEFAULTS }, disposed = false, pending = 3;
  const color = new THREE.Color().copy(tint);
  const station = route.sample(route.stations["Myrtle Av-Broadway"].s);
  station.yaw = Math.atan2(station.dy, station.dx);
  const stationPoint = { x: station.x, y: station.y, yaw: station.yaw };
  const boxPoint = { x: station.x, y: station.y, yaw: station.yaw };
  const samples = [];
  for (let offset = -150; offset <= 150; offset += 5) samples.push(route.sample(station.s + offset));
  const fastfood = footprint(corner.buildings.find((b) => b.id === 250317334));
  // Nearest tenement footprints only: one model repeated 68 times reads as a pattern, and the discard
  // uniform holds 32 boxes (station + fast food + 30).
  const TENEMENT_RANGE = 80, TENEMENT_MAX = 30;
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
    for (const kind of ["station", "fastfood", "tenement"]) {
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
        const mesh = kind === "tenement" ? new THREE.InstancedMesh(geometry, material, points.length) : new THREE.Mesh(geometry, material);
        mesh.name = file;
        frame.add(mesh);
        assets.push({ kind, points, mesh, source, size, originalColor, uFade, elapsed: 0 });
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
