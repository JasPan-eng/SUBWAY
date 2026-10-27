import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createInspector({ renderer, store, base, navigation, onVisibility }) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#c9c9c7');
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enabled = false;
  controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 2; controls.maxDistance = 20;
  controls.maxPolarAngle = Math.PI / 2 - 0.02; controls.autoRotateSpeed = 0.6;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  controls.addEventListener('start', () => { controls.autoRotate = false; });
  scene.add(new THREE.HemisphereLight('#ffffff', '#888078', 2));
  const key = new THREE.DirectionalLight('#fff4e7', 3); key.position.set(-3, 7, 5);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = key.shadow.camera.bottom = -5;
  key.shadow.camera.right = key.shadow.camera.top = 5; key.shadow.camera.near = 0.1; key.shadow.camera.far = 20;
  key.shadow.bias = -0.0003; key.shadow.normalBias = 0.015; key.shadow.radius = 4; scene.add(key);
  const fill = new THREE.DirectionalLight('#e2edff', 1); fill.position.set(4, 3, -4); scene.add(fill);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.MeshStandardMaterial({ color: '#b4b4b2', roughness: 1 }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = -0.015; disc.receiveShadow = true; scene.add(disc);
  const overlay = document.querySelector('#inspect'), back = document.querySelector('#back');
  const reference = document.querySelector('#reference'), referenceToggle = document.querySelector('#reference-toggle');
  const status = document.querySelector('#inspect-status');
  let active = false, token = 0, modelObject = null, previousFocus;
  function removeModel() {
    if (!modelObject) return;
    scene.remove(modelObject);
    modelObject.traverse((node) => { if (node.isMesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose(); });
    modelObject = null;
  }
  async function open(model) {
    const request = ++token;
    previousFocus = document.activeElement; active = true; navigation.enabled = false; controls.enabled = true;
    controls.autoRotate = !reduced.matches;
    overlay.hidden = false; document.body.classList.add('inspecting'); onVisibility(true);
    document.querySelector('#inspect-name').textContent = model.name;
    document.querySelector('#inspect-description').textContent = model.description ?? '';
    document.querySelector('#inspect-size').textContent = model.bytes ? `${Math.round(model.bytes / 1024).toLocaleString()} KB` : 'Size unavailable';
    status.textContent = 'Loading model…'; reference.hidden = true; referenceToggle.hidden = !model.ref;
    referenceToggle.setAttribute('aria-expanded', 'false');
    if (model.ref) reference.src = `${base}${model.ref.replace(/^\/+/, '')}`; else reference.removeAttribute('src');
    removeModel(); back.focus();
    camera.position.set(5, 3, 6); controls.target.set(0, 1, 0); controls.update();
    try {
      const asset = await store.load(model.file);
      if (!active || request !== token) return;
      modelObject = asset.group.clone(true);
      const scale = 4 / Math.max(asset.size.x, asset.size.y, asset.size.z);
      modelObject.scale.setScalar(scale);
      modelObject.traverse((node) => {
        if (!node.isMesh) return;
        const plain = (material) => { const copy = material.clone(); copy.onBeforeCompile = () => {}; copy.customProgramCacheKey = () => 'explore-inspect-v1'; return copy; };
        node.material = Array.isArray(node.material) ? node.material.map(plain) : plain(node.material);
      });
      scene.add(modelObject); controls.target.y = asset.size.y * scale * 0.45; controls.update();
      renderer.shadowMap.needsUpdate = true;
      status.textContent = 'Drag to orbit · Scroll or pinch to zoom';
    } catch (error) {
      if (active && request === token) status.textContent = `Model unavailable: ${error.message}`;
    }
  }
  function close() {
    if (!active) return;
    active = false; token++; controls.enabled = false; navigation.enabled = true;
    overlay.hidden = true; document.body.classList.remove('inspecting'); onVisibility(false);
    removeModel(); previousFocus?.focus();
  }
  back.addEventListener('click', close);
  referenceToggle.addEventListener('click', () => { reference.hidden = !reference.hidden; referenceToggle.setAttribute('aria-expanded', String(!reference.hidden)); });
  reference.addEventListener('error', () => { reference.hidden = true; referenceToggle.hidden = true; });
  window.addEventListener('keydown', (event) => {
    if (!active) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const last = referenceToggle.hidden ? back : referenceToggle;
      if (event.shiftKey && document.activeElement === back) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); back.focus(); }
    }
  });
  return { open, get active() { return active; }, resize(width, height) { camera.aspect = width / height; camera.updateProjectionMatrix(); },
    render(dt) { controls.update(dt); renderer.render(scene, camera); },
  };
}
