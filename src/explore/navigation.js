import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';

export function createNavigation(camera, canvas, target, routeHeading) {
  const controls = new MapControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.zoomToCursor = true; controls.screenSpacePanning = false;
  controls.minDistance = 8; controls.maxDistance = 900; controls.maxPolarAngle = 1.35;
  controls.target.copy(target);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const tilt = THREE.MathUtils.degToRad(50), startHeading = Math.PI + routeHeading + Math.PI / 4;
  const offset = new THREE.Vector3(), right = new THREE.Vector3(), forward = new THREE.Vector3(), pan = new THREE.Vector3();
  const spherical = new THREE.Spherical(220, tilt, startHeading);
  camera.position.copy(target).add(offset.setFromSpherical(spherical)); controls.update();
  const fromTarget = new THREE.Vector3(), toTarget = new THREE.Vector3();
  const fromSpherical = new THREE.Spherical(), toSpherical = new THREE.Spherical();
  const center = new THREE.Vector3(), size = new THREE.Vector3();
  let started = -1, duration = 0, active = true;
  const keys = new Set();
  function turn(nextTarget, radius, phi, theta, ms) {
    controls.update();
    fromTarget.copy(controls.target); toTarget.copy(nextTarget);
    fromSpherical.setFromVector3(offset.subVectors(camera.position, controls.target));
    const delta = Math.atan2(Math.sin(theta - fromSpherical.theta), Math.cos(theta - fromSpherical.theta));
    toSpherical.set(THREE.MathUtils.clamp(radius, 8, 900), THREE.MathUtils.clamp(phi, 0.001, 1.35), fromSpherical.theta + delta);
    started = performance.now(); duration = reduced.matches ? 0 : ms;
  }
  controls.addEventListener('start', () => { started = -1; });
  // Keep the focus point on the mapped neighbourhood (like Google Maps bounds): zoom-to-cursor while zooming
  // out otherwise walks the target off the 450 m data radius and the view ends up on bare ground.
  const BOUND = 500, excess = new THREE.Vector3();
  controls.addEventListener('change', () => {
    const t = controls.target;
    const r = Math.hypot(t.x - target.x, t.z - target.z);
    const dy = t.y - target.y;
    if (r <= BOUND && Math.abs(dy) < 1e-6) return;
    excess.set(r > BOUND ? (t.x - target.x) * (1 - BOUND / r) : 0, dy, r > BOUND ? (t.z - target.z) * (1 - BOUND / r) : 0);
    t.sub(excess);
    camera.position.sub(excess);
  });
  function reset() { turn(target, 220, tilt, startHeading, 700); }
  function zoom(factor) {
    spherical.setFromVector3(offset.subVectors(camera.position, controls.target));
    turn(controls.target, spherical.radius * factor, spherical.phi, spherical.theta, 200);
  }
  function compass() {
    spherical.setFromVector3(offset.subVectors(camera.position, controls.target));
    // North is +Z; viewing it from the south puts east (-X) on screen-right.
    turn(controls.target, spherical.radius, spherical.phi, Math.PI, 400);
  }
  function toggleTilt() {
    spherical.setFromVector3(offset.subVectors(camera.position, controls.target));
    turn(controls.target, spherical.radius, spherical.phi < 0.1 ? tilt : 0.001, spherical.theta, 400);
  }
  function flyTo(box) {
    if (box.isEmpty()) return;
    box.getCenter(center); box.getSize(size);
    const fov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const limitingFov = Math.min(fov, Math.atan(Math.tan(fov) * camera.aspect));
    const distance = size.length() * 0.6 / Math.sin(limitingFov);
    turn(center, distance, Math.PI / 4, controls.getAzimuthalAngle(), 700);
  }
  // Shortcuts keep working after a panel button was clicked; only text fields swallow them.
  function typing(event) { return event.target.closest('input, textarea, select, [contenteditable]'); }
  window.addEventListener('keydown', (event) => {
    if (!active || typing(event) || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (!['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'q', 'e', '+', '=', '-', '_', 'r'].includes(key)) return;
    event.preventDefault();
    if (key === 'r') { if (!event.repeat) reset(); return; }
    keys.add(key); started = -1;
  });
  window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  return { controls, reset, zoom, compass, toggleTilt, flyTo,
    set enabled(value) { active = value; controls.enabled = value; keys.clear(); },
    update(dt, now) {
      if (!active) return;
      if (started >= 0) {
        let t = duration ? Math.min(1, (now - started) / duration) : 1;
        t = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
        controls.target.lerpVectors(fromTarget, toTarget, t);
        spherical.set(THREE.MathUtils.lerp(fromSpherical.radius, toSpherical.radius, t), THREE.MathUtils.lerp(fromSpherical.phi, toSpherical.phi, t), THREE.MathUtils.lerp(fromSpherical.theta, toSpherical.theta, t));
        camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
        if (t === 1) started = -1;
      } else if (keys.size) {
        spherical.setFromVector3(offset.subVectors(camera.position, controls.target));
        right.setFromMatrixColumn(camera.matrix, 0); right.y = 0; right.normalize();
        forward.set(right.z, 0, -right.x);
        const horizontal = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
        const vertical = Number(keys.has('w') || keys.has('arrowup')) - Number(keys.has('s') || keys.has('arrowdown'));
        pan.copy(right).multiplyScalar(horizontal).addScaledVector(forward, vertical).multiplyScalar(dt * spherical.radius * 0.6);
        controls.target.add(pan);
        spherical.theta += (Number(keys.has('q')) - Number(keys.has('e'))) * dt;
        const zoomDirection = Number(keys.has('-') || keys.has('_')) - Number(keys.has('+') || keys.has('='));
        spherical.radius = THREE.MathUtils.clamp(spherical.radius * Math.exp(zoomDirection * dt), 8, 900);
        camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
      }
      controls.update();
    },
  };
}
