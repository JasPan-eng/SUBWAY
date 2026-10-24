import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

const RANGE = 250;
const FADE_START = 200;

/** Repeating el sections in route metres, sharing the city's rail-height root. */
export function createStructure({ root, route, base, scene, fogUniforms }) {
  // Route coordinates (east +X, north -Z) -> the tiles' east -X, north +Z.
  const frame = new THREE.Group();
  frame.name = "elevated-structure";
  frame.rotation.y = Math.PI;
  root.add(frame);

  let hemisphere, sun;
  scene.traverse((object) => {
    if (object.isHemisphereLight) hemisphere = object;
    if (object.isDirectionalLight) sun = object;
  });
  const ownHemisphere = !hemisphere;
  const ownSun = !sun;
  if (ownHemisphere) {
    hemisphere = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.8);
    scene.add(hemisphere);
  }
  if (ownSun) {
    sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(3, 5, 2);
    scene.add(sun);
  }

  const draco = new DRACOLoader();
  draco.setDecoderPath(`${base}draco/`);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const tint = new THREE.Color();
  const originalColor = new THREE.Color();
  const uFade = { value: 0 };
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const unitScale = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const point = {};
  let mesh, source, fades, progress, spacing, lastBent;
  let first = 0, last = -1, previousDistance = NaN, elapsed = 0;
  let disposed = false;

  function releaseSource() {
    if (!source) return;
    const textures = new Set();
    source.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        material.dispose();
      }
    });
    for (const texture of textures) texture.dispose();
    source = null;
  }

  loader.load(`${base}props/el_bent.glb`, (gltf) => {
    source = gltf.scene;
    if (disposed) {
      releaseSource();
      return;
    }
    source.updateMatrixWorld(true);
    let bent;
    source.traverse((object) => { if (object.isMesh && !bent) bent = object; });
    if (!bent) {
      console.warn("Elevated structure: GLB contains no mesh.");
      releaseSource();
      draco.dispose();
      return;
    }
    const geometry = bent.geometry.clone().applyMatrix4(bent.matrixWorld);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    // Assumption: glTF is Y-up and rails follow the longer horizontal extent.
    // Canonical section runs along +X; yaw then maps +X to (dx, 0, -dy).
    if (size.z > size.x) geometry.rotateY(Math.PI / 2);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const metres = 10.5 / (box.max.z - box.min.z);
    spacing = (box.max.x - box.min.x) * metres;
    if (!Number.isFinite(spacing) || spacing <= 0) {
      console.warn("Elevated structure: invalid horizontal bounds.");
      geometry.dispose();
      releaseSource();
      draco.dispose();
      return;
    }
    geometry.translate(-(box.min.x + box.max.x) / 2, -box.max.y, -(box.min.z + box.max.z) / 2);
    geometry.scale(metres, metres, metres);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material = bent.material.clone();
    originalColor.copy(material.color);
    material.color.copy(originalColor).multiply(tint);
    material.fog = false;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, fogUniforms);
      shader.uniforms.uFade = uFade;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float structureFade;\nvarying float vStructureFade;\nvarying float vCityDepth;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvCityDepth = -mvPosition.z;\nvStructureFade = structureFade;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vStructureFade;\nvarying float vCityDepth;\nuniform vec3 uCityFogColor;\nuniform float uCityFogDensity;\nuniform float uFade;")
        .replace("#include <dithering_fragment>", "#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uCityFogColor, 1.0 - exp(-uCityFogDensity * vCityDepth));\ngl_FragColor.rgb = mix(uCityFogColor, gl_FragColor.rgb, uFade * vStructureFade);");
    };
    material.customProgramCacheKey = () => "city-structure-fog-v1";
    lastBent = Math.floor(route.total / spacing);
    const capacity = Math.min(lastBent + 1, Math.ceil(2 * RANGE / spacing) + 1);
    progress = new Float32Array(lastBent + 1);
    fades = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    fades.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("structureFade", fades);
    mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    // Explicit route-distance culling avoids stale bounds as the window moves.
    mesh.frustumCulled = false;
    frame.add(mesh);
    draco.dispose();
  }, undefined, (error) => {
    draco.dispose();
    if (!disposed) console.warn("Elevated structure failed to load:", error);
  });

  return {
    configure(p) {
      tint.set(p.tint).multiplyScalar(p.brightness);
      if (mesh) mesh.material.color.copy(originalColor).multiply(tint);
      if (ownHemisphere) {
        hemisphere.color.set(p.skyZenith);
        hemisphere.groundColor.set(p.fogColor);
        hemisphere.visible = p.enabled;
      }
      if (ownSun) sun.visible = p.enabled;
    },
    update(dt, distance) {
      if (!mesh) return;
      const step = Math.max(0, dt) / 0.4;
      elapsed = Math.min(1, elapsed + step);
      uFade.value = 1 - (1 - elapsed) * (1 - elapsed);
      if (distance !== previousDistance) {
        const nextFirst = Math.max(0, Math.ceil((distance - RANGE) / spacing));
        const nextLast = Math.min(lastBent, Math.floor((distance + RANGE) / spacing));
        let index = 0;
        for (let k = nextFirst; k <= nextLast; k++, index++) {
          if (k < first || k > last) progress[k] = 0;
          route.sample(k * spacing, point);
          position.set(point.x, 0, -point.y);
          quaternion.setFromAxisAngle(up, Math.atan2(point.dy, point.dx));
          matrix.compose(position, quaternion, unitScale);
          mesh.setMatrixAt(index, matrix);
        }
        first = nextFirst;
        last = nextLast;
        mesh.count = index;
        mesh.instanceMatrix.needsUpdate = true;
        previousDistance = distance;
      }
      for (let k = first, index = 0; k <= last; k++, index++) {
        progress[k] = Math.min(1, progress[k] + step);
        const edge = THREE.MathUtils.clamp((RANGE - Math.abs(k * spacing - distance)) / (RANGE - FADE_START), 0, 1);
        fades.array[index] = (1 - (1 - progress[k]) ** 2) * edge * edge * (3 - 2 * edge);
      }
      fades.needsUpdate = true;
    },
    dispose() {
      disposed = true;
      root.remove(frame);
      if (mesh) {
        mesh.dispose();
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      releaseSource();
      draco.dispose();
      if (ownHemisphere) { scene.remove(hemisphere); hemisphere.dispose(); }
      if (ownSun) { scene.remove(sun); sun.dispose(); }
    },
  };
}
