/**
 * Subway car content: the stand-in splat used until the trained Gaussian splat exists.
 *
 * The stand-in is built from surface points sampled on the Cinema 4D car mesh
 * (public/splats/standin_points.f32, xyz float32 triples in metres, right-handed,
 * Y up, car length along X). Each point becomes a small Gaussian tinted by what it
 * most likely is: floor, bench, wall or ceiling. It is only a placeholder for the
 * camera, sim and look work; the trained splat replaces it with the real surfaces.
 */
import * as THREE from "three";

export const SUBWAY_DEFAULTS = {
  pointsUrl: "/splats/standin_points.f32",
  splatSize: 0.03, // metres
  opacity: 0.85,
  seed: 5,
};

/** Fetch the stand-in point cloud. Returns a Float32Array of xyz triples (metres). */
export async function loadStandInPoints(url = SUBWAY_DEFAULTS.pointsUrl) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`stand-in points: HTTP ${res.status} for ${url}`);
  return new Float32Array(await res.arrayBuffer());
}

/** Car extents in metres (from the C4D scene): floor y=1.38, ceiling y~3.56, walls z=±1.24. */
export const CAR = {
  floorY: 1.38,
  ceilingY: 3.56,
  halfWidth: 1.24,
  halfLength: 6.47,
  benchTopY: 1.38 + 0.45,
  benchDepthZ: 0.6,
};

function hash(i) {
  let h = Math.imul(i + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca77);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967295;
}

/**
 * Spark `constructSplats` callback: push one Gaussian per sampled point.
 * @param {{ pushSplat: Function }} splats
 * @param {Float32Array} xyz
 */
export function buildStandIn(splats, xyz, o = SUBWAY_DEFAULTS) {
  const centre = new THREE.Vector3();
  const scales = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const col = new THREE.Color();
  const n = xyz.length / 3;
  for (let i = 0; i < n; i++) {
    const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
    const r = hash(i + o.seed * 7919);
    centre.set(x, y, z);
    const s = o.splatSize * (0.7 + 0.6 * r);
    scales.set(s, s, s * 0.4);
    // Orient the flat axis roughly with the nearest surface: walls face Z, floor/ceiling face Y.
    const nearWall = Math.abs(z) > CAR.halfWidth - 0.15;
    if (nearWall) quat.set(0, 0, 0, 1);
    else quat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const tint = 0.85 + 0.3 * (r - 0.5);
    if (y < CAR.floorY + 0.08) col.setRGB(0.09 * tint, 0.09 * tint, 0.1 * tint); // floor
    else if (y < CAR.benchTopY + 0.3 && Math.abs(z) > CAR.halfWidth - CAR.benchDepthZ - 0.1) col.setRGB(0.42 * tint, 0.5 * tint, 0.72 * tint); // bench
    else if (y > CAR.ceilingY - 0.25) col.setRGB(0.55 * tint, 0.58 * tint, 0.6 * tint); // ceiling
    else {
      // walls: grey steel with graffiti-coloured patches
      const g = hash(Math.floor(x * 1.7) * 131 + Math.floor(y * 2.3) * 17 + (z > 0 ? 1 : 0));
      if (g > 0.55) col.setHSL(hash(i * 3) , 0.85, 0.55);
      else col.setRGB(0.62 * tint, 0.64 * tint, 0.66 * tint);
    }
    splats.pushSplat(centre, scales, quat, o.opacity, col);
  }
}
