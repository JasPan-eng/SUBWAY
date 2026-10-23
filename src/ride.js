/**
 * Ride camera: a dolly along the car's long axis driven by scroll (or an auto ride),
 * with pointer look. Works in sim space (the splat normalised to width 1, centred),
 * so it is independent of the capture's units.
 *
 * x = along the car, y = up, z = across. The dolly runs between xMin..xMax at eye
 * height; the pointer yaws/pitches the view around the travel direction.
 */
import * as THREE from "three";

export const RIDE_DEFAULTS = {
  progress: 0.15, // 0 = one end of the car, 1 = the other
  autoRide: true,
  speed: 0.012, // progress per second when autoRide is on
  bounce: true, // ping-pong at the ends instead of stopping
  eyeHeight: 0.56, // 0 = floor, 1 = ceiling
  lookYaw: 70, // degrees of yaw at the screen edge
  lookPitch: 28,
  lookEase: 4, // 1/s
  scrollGain: 0.00035, // progress per wheel pixel
  strokeDepth: 0.12, // sim units ahead of the camera for the stroke plane
  fov: 72,
  rock: 0.004, // carriage rock amplitude (sim units)
  rockRate: 1.1, // Hz
};

/**
 * @param {THREE.PerspectiveCamera} camera
 * @param {HTMLElement} surface  element receiving wheel events
 */
export function createRide(camera, surface) {
  let p = { ...RIDE_DEFAULTS };
  let box = new THREE.Box3(new THREE.Vector3(-0.5, -0.1, -0.1), new THREE.Vector3(0.5, 0.1, 0.1));
  let simToWorld = new THREE.Matrix4();
  let progress = p.progress;
  let direction = 1;
  const look = new THREE.Vector2(); // target yaw/pitch in -1..1
  const lookNow = new THREE.Vector2();
  const posSim = new THREE.Vector3();
  const posWorld = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const target = new THREE.Vector3();
  const strokeOrigin = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, "YXZ");

  surface.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      progress = THREE.MathUtils.clamp(progress + e.deltaY * p.scrollGain, 0, 1);
      p.progress = progress;
    },
    { passive: false },
  );

  return {
    get params() {
      return p;
    },
    get progress() {
      return progress;
    },
    get strokeOrigin() {
      return strokeOrigin;
    },
    configure(next) {
      const prev = p;
      p = { ...p, ...next };
      if (next.progress !== undefined && next.progress !== prev.progress) progress = next.progress;
      camera.fov = p.fov;
      camera.updateProjectionMatrix();
    },
    /** Sim-space bounding box of the splat and sim->world matrix. */
    setBounds(simBox, matrix) {
      box = simBox.clone();
      simToWorld = matrix;
    },
    /** Pointer in NDC, or null when it left the window. */
    setPointer(ndc) {
      if (ndc) look.set(ndc.x, ndc.y);
      else look.set(0, 0);
    },
    /** Advance; returns the camera's sim-space position. */
    update(dt, t) {
      if (p.autoRide) {
        progress += direction * p.speed * dt;
        if (progress > 1 || progress < 0) {
          if (p.bounce) {
            direction *= -1;
            progress = THREE.MathUtils.clamp(progress, 0, 1);
          } else progress = THREE.MathUtils.clamp(progress, 0, 1);
        }
        p.progress = progress;
      }
      const k = 1 - Math.exp(-p.lookEase * dt);
      lookNow.lerp(look, k);

      // Dolly path: keep clear of the end walls, eye height between floor and ceiling.
      const margin = (box.max.x - box.min.x) * 0.08;
      const x = THREE.MathUtils.lerp(box.min.x + margin, box.max.x - margin, progress);
      const y = THREE.MathUtils.lerp(box.min.y, box.max.y, p.eyeHeight) + Math.sin(t * p.rockRate * Math.PI * 2) * p.rock;
      const z = Math.sin(t * 0.37) * p.rock * 2;
      posSim.set(x, y, z);
      posWorld.copy(posSim).applyMatrix4(simToWorld);
      camera.position.copy(posWorld);

      // Look along +x (direction of travel), turned by the pointer.
      const yaw = THREE.MathUtils.degToRad(p.lookYaw) * -lookNow.x + (direction > 0 ? -Math.PI / 2 : Math.PI / 2);
      const pitch = THREE.MathUtils.degToRad(p.lookPitch) * lookNow.y;
      euler.set(pitch, yaw, 0);
      camera.quaternion.setFromEuler(euler);
      camera.updateMatrixWorld();

      camera.getWorldDirection(fwd);
      // Stroke plane sits a short way ahead, scaled by the splat's world size.
      const scale = new THREE.Vector3().setFromMatrixScale(simToWorld).x;
      strokeOrigin.copy(posWorld).addScaledVector(fwd, p.strokeDepth * scale);
      target.copy(strokeOrigin);
      return posSim;
    },
  };
}
