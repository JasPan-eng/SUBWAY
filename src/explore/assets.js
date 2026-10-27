import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { alignPlan } from '../align.js';

export function patchFog(material, fogUniforms) {
  material.fog = false;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fogUniforms);
    shader.uniforms.uFade = { value: 1 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCityDepth;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCityDepth = -mvPosition.z;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCityDepth;\nuniform vec3 uCityFogColor;\nuniform float uCityFogDensity;\nuniform float uFade;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uCityFogColor, 1.0 - exp(-uCityFogDensity * vCityDepth));\ngl_FragColor.rgb = mix(uCityFogColor, gl_FragColor.rgb, uFade);');
  };
  material.customProgramCacheKey = () => 'explore-krea-fog-v1';
  return material;
}

// Bake node transforms once, retaining all GLB meshes and sharing their geometry across placements.
export function createAssetStore(base, fogUniforms) {
  const draco = new DRACOLoader(THREE.DefaultLoadingManager).setDecoderPath(`${base}draco/`);
  const loader = new GLTFLoader(THREE.DefaultLoadingManager).setDRACOLoader(draco);
  const cache = new Map();
  function load(file) {
    if (!file) return Promise.reject(new Error('No published GLB is available.'));
    if (cache.has(file)) return cache.get(file);
    const promise = loader.loadAsync(`${base}${file.replace(/^\/+/, '')}`).then(({ scene }) => {
      scene.updateMatrixWorld(true);
      const group = new THREE.Group();
      scene.traverse((node) => {
        if (!node.isMesh) return;
        const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
        const convert = (original) => {
          const material = original.isMeshStandardMaterial ? original.clone() : new THREE.MeshStandardMaterial({
            map: original.map, color: original.color, vertexColors: original.vertexColors,
            transparent: original.transparent, opacity: original.opacity, side: original.side,
          });
          return patchFog(material, fogUniforms);
        };
        const mesh = new THREE.Mesh(geometry, Array.isArray(node.material) ? node.material.map(convert) : convert(node.material));
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
      });
      if (!group.children.length) throw new Error('This GLB has no mesh.');
      // Generated models keep the 3/4 angle of their reference image: square them up in plan first.
      if (group.children.length === 1) alignPlan(group.children[0].geometry);
      const box = new THREE.Box3().setFromObject(group), size = box.getSize(new THREE.Vector3());
      if (size.z > size.x) {
        for (const mesh of group.children) mesh.geometry.rotateY(Math.PI / 2);
        box.setFromObject(group); box.getSize(size);
      }
      if (![size.x, size.y, size.z].every((n) => Number.isFinite(n) && n > 0)) throw new Error('Invalid model dimensions.');
      const x = -(box.min.x + box.max.x) / 2, y = -box.min.y, z = -(box.min.z + box.max.z) / 2;
      for (const mesh of group.children) {
        mesh.geometry.translate(x, y, z);
        mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
      }
      // Original geometry/materials are no longer used; textures remain shared by the clones.
      const geometries = new Set(), materials = new Set();
      scene.traverse((node) => { if (node.isMesh) { geometries.add(node.geometry); for (const m of Array.isArray(node.material) ? node.material : [node.material]) materials.add(m); } });
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      return { group, size };
    }).catch((error) => { cache.delete(file); throw error; });
    cache.set(file, promise);
    return promise;
  }
  async function loadInstanced(file) {
    const asset = await load(file);
    if (asset.instanced) return asset.instanced;
    const meshes = asset.group.children;
    if (meshes.length === 1) {
      asset.instanced = { geometry: meshes[0].geometry, material: meshes[0].material, size: asset.size };
      return asset.instanced;
    }
    // A multi-node GLB still gets one InstancedMesh. Cache the combined geometry
    // alongside the loader asset, preserving its lit, fog-patched materials.
    const parts = meshes.map((mesh) => mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone());
    const attributes = new Map();
    for (const part of parts) for (const [name, attr] of Object.entries(part.attributes)) {
      if (attributes.has(name) && attributes.get(name) !== attr.itemSize) {
        for (const geometry of parts) geometry.dispose();
        throw new Error('Incompatible model attributes');
      }
      attributes.set(name, attr.itemSize);
    }
    const materials = [], groups = [];
    let offset = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i], count = part.attributes.position.count;
      // Normalise attribute storage so indexed/non-indexed GLB primitives can merge.
      for (const [name, itemSize] of attributes) {
        const source = part.getAttribute(name), values = new Float32Array(count * itemSize);
        for (let vertex = 0; vertex < count; vertex++) for (let c = 0; c < itemSize; c++) {
          values[vertex * itemSize + c] = source ? source.getComponent(vertex, c) : name === 'color' ? 1 : 0;
        }
        part.setAttribute(name, new THREE.BufferAttribute(values, itemSize));
      }
      const material = meshes[i].material, first = materials.length;
      materials.push(...(Array.isArray(material) ? material : [material]));
      if (Array.isArray(material)) {
        for (const group of part.groups) groups.push({ start: offset + group.start, count: group.count, materialIndex: first + group.materialIndex });
      } else groups.push({ start: offset, count, materialIndex: first });
      part.clearGroups(); offset += count;
    }
    const geometry = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!geometry) throw new Error('Could not combine street prop geometry');
    for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    asset.instanced = { geometry, material: materials, size: asset.size };
    return asset.instanced;
  }
  return { load, loadInstanced };
}

export function footprint(building) {
  let longest = 0, yaw = 0;
  for (let i = 1; i < building.pts.length; i++) {
    const dx = building.pts[i][0] - building.pts[i - 1][0], dy = building.pts[i][1] - building.pts[i - 1][1];
    if (dx * dx + dy * dy > longest) { longest = dx * dx + dy * dy; yaw = Math.atan2(dy, dx); }
  }
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, y] of building.pts) {
    const a = x * c + y * s, b = -x * s + y * c;
    minX = Math.min(minX, a); maxX = Math.max(maxX, a); minZ = Math.min(minZ, b); maxZ = Math.max(maxZ, b);
  }
  const a = (minX + maxX) / 2, b = (minZ + maxZ) / 2;
  return { yaw, x: a * c - b * s, y: a * s + b * c, length: maxX - minX, width: maxZ - minZ };
}

export async function placeExtra(model, { store, frame, route, buildings, covered, pickables }) {
  const placement = model.placement;
  if (!placement || !['footprints', 'route'].includes(placement.type)) return;
  const asset = await store.load(model.file);
  const instances = [];
  if (placement.type === 'footprints') {
    for (const id of placement.ids ?? []) {
      const building = buildings.get(String(id));
      if (!building || covered.has(String(id))) continue;
      const fp = footprint(building), object = asset.group.clone(true);
      const sx = fp.length / asset.size.x, sz = fp.width / asset.size.z;
      const height = THREE.MathUtils.clamp(asset.size.y * Math.min(sx, sz), building.height * 0.8, building.height * 1.3);
      object.scale.set(sx, height / asset.size.y, sz);
      object.position.set(fp.x, -10.5, -fp.y); object.rotation.y = fp.yaw;
      instances.push(object); covered.add(String(id));
    }
  } else {
    const p = route.sample(placement.s), heading = Math.atan2(p.dy, p.dx), lateral = placement.lateral ?? 0;
    const object = asset.group.clone(true);
    object.scale.setScalar((placement.length ?? 12) / Math.max(asset.size.x, asset.size.z));
    object.position.set(p.x - Math.sin(heading) * lateral, -10.5, -(p.y + Math.cos(heading) * lateral));
    object.rotation.y = heading + THREE.MathUtils.degToRad(placement.yawDeg ?? 0);
    instances.push(object);
  }
  for (const object of instances) {
    frame.add(object); object.updateWorldMatrix(true, true);
    model.box.union(new THREE.Box3().setFromObject(object));
    object.traverse((node) => {
      if (!node.isMesh) return;
      node.userData.model = model; model.meshes.push(node); pickables.push(node);
    });
  }
}
