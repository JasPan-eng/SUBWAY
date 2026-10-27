import * as THREE from 'three';
import { insideHeroDiscard } from './layers.js';

function randomFor(id) {
  let seed = 2166136261;
  for (const c of id) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function bucketKey(x, y) { return `${Math.floor(x / 20)},${Math.floor(y / 20)}`; }
function bucketBounds(grid, item, minX, minY, maxX, maxY) {
  for (let x = Math.floor(minX / 20); x <= Math.floor(maxX / 20); x++) {
    for (let y = Math.floor(minY / 20); y <= Math.floor(maxY / 20); y++) {
      const key = `${x},${y}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(item);
    }
  }
}

function distanceSquared(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0;
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
}

function insideFootprint(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j], [bx, by] = pts[i];
    if (distanceSquared(x, y, ax, ay, bx, by) < 1e-12) return true;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

// Built once, lazily, only when the manifest actually contains street props.
export function createStreetPlanner(block, discard) {
  const footprints = new Map(), crossings = new Map();
  for (const building of block.buildings) {
    if (building.pts.length < 3) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of building.pts) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    bucketBounds(footprints, building.pts, minX, minY, maxX, maxY);
  }
  for (const way of block.streets) {
    const clearance = way.width / 2 + 1;
    for (let i = 1; i < way.pts.length; i++) {
      const [ax, ay] = way.pts[i - 1], [bx, by] = way.pts[i];
      bucketBounds(crossings, { way, ax, ay, bx, by, clearance },
        Math.min(ax, bx) - clearance, Math.min(ay, by) - clearance,
        Math.max(ax, bx) + clearance, Math.max(ay, by) + clearance);
    }
  }
  return (model) => {
    const p = model.placement, spots = [], accepted = new Map();
    if (!Array.isArray(p.kinds) || !Number.isFinite(p.spacing) || p.spacing <= 0 ||
        !Number.isFinite(p.height) || p.height <= 0 || !Number.isFinite(p.radius) || p.radius < 0 ||
        !Number.isInteger(p.max) || p.max < 0 || !Number.isFinite(p.setback) || p.setback < 0 ||
        !['both', 'alternate'].includes(p.sides) || !['street', 'along'].includes(p.face) ||
        (p.jitter != null && (!Number.isFinite(p.jitter) || p.jitter < 0))) throw new Error('Invalid street placement');
    if (!p.max) return spots;
    const random = randomFor(model.id), name = p.nameMatch?.toLowerCase();
    for (const way of block.streets) {
      if (!p.kinds.includes(way.kind) || (name && !(way.name ?? '').toLowerCase().includes(name))) continue;
      // One seeded phase offset per way; stations retain the requested spacing.
      let next = p.spacing / 2 + (random() * 2 - 1) * (p.jitter ?? 0);
      if (next < 0) next += Math.ceil(-next / p.spacing) * p.spacing;
      let travelled = 0, station = 0;
      for (let i = 1; i < way.pts.length; i++) {
        const [ax, ay] = way.pts[i - 1], [bx, by] = way.pts[i];
        const length = Math.hypot(bx - ax, by - ay);
        if (length < 1e-9) continue;
        const dx = (bx - ax) / length, dy = (by - ay) / length, nx = -dy, ny = dx;
        for (; next < travelled + length; next += p.spacing, station++) {
          const along = next - travelled, offset = way.width / 2 + p.setback;
          for (const side of p.sides === 'both' ? [1, -1] : [station % 2 ? -1 : 1]) {
            const x = ax + dx * along + nx * side * offset, y = ay + dy * along + ny * side * offset;
            if (x * x + y * y > p.radius * p.radius || insideHeroDiscard(x, y, discard)) continue;
            const key = bucketKey(x, y);
            if (footprints.get(key)?.some((pts) => insideFootprint(x, y, pts))) continue;
            if (crossings.get(key)?.some((s) => s.way !== way &&
              distanceSquared(x, y, s.ax, s.ay, s.bx, s.by) < s.clearance ** 2)) continue;
            let crowded = false;
            const gx = Math.floor(x / 20), gy = Math.floor(y / 20);
            for (let a = gx - 1; a <= gx + 1; a++) for (let b = gy - 1; b <= gy + 1; b++) {
              if (accepted.get(`${a},${b}`)?.some((s) => (s.x - x) ** 2 + (s.y - y) ** 2 < 36)) crowded = true;
            }
            if (crowded) continue;
            // In frame coordinates north is -Z: +Z faces (-nx*side, +ny*side).
            const spot = { x, y, yaw: p.face === 'street' ? Math.atan2(-nx * side, ny * side) : Math.atan2(dy, dx) };
            spots.push(spot);
            if (!accepted.has(key)) accepted.set(key, []);
            accepted.get(key).push(spot);
            if (spots.length >= p.max) return spots;
          }
        }
        travelled += length;
      }
    }
    return spots;
  };
}

export async function placeStreet(model, { store, frame, pickables, plan }) {
  const spots = plan(model);
  model.instanceCount = spots.length;
  if (!spots.length) return;
  const asset = await store.loadInstanced(model.file);
  const mesh = new THREE.InstancedMesh(asset.geometry, asset.material, spots.length);
  mesh.name = model.id;
  mesh.castShadow = ['streetlight', 'street_tree', 'bus_shelter'].includes(model.id);
  mesh.receiveShadow = true;
  mesh.userData.model = model;
  mesh.userData.instanceBoxes = [];
  const transform = new THREE.Object3D(), world = new THREE.Matrix4();
  transform.scale.setScalar(model.placement.height / asset.size.y);
  frame.add(mesh); mesh.updateWorldMatrix(true, false);
  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i];
    transform.position.set(spot.x, -10.5, -spot.y);
    transform.rotation.y = spot.yaw;
    transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
    world.multiplyMatrices(mesh.matrixWorld, transform.matrix);
    const box = asset.geometry.boundingBox.clone().applyMatrix4(world);
    mesh.userData.instanceBoxes.push(box); model.box.union(box);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox(); mesh.computeBoundingSphere();
  model.meshes.push(mesh); pickables.push(mesh);
}
