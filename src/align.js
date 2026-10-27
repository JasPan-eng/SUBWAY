/**
 * Hunyuan3D keeps the three-quarter angle of its reference image, so a generated building or platform section
 * is usually turned 20-45 degrees about Y inside its own bounding box. Fitting such a box to a footprint or a
 * track stretches and skews the model. This finds the minimum-area rectangle around the mesh in plan (rotating
 * calipers over the convex hull of the xz positions) and returns the Y rotation that makes it axis-aligned.
 */
export function planAlignmentAngle(geometry, maxSamples = 20000) {
  const pos = geometry.attributes.position;
  const step = Math.max(1, Math.floor(pos.count / maxSamples));
  const pts = [];
  for (let i = 0; i < pos.count; i += step) pts.push([pos.getX(i), pos.getZ(i)]);
  if (pts.length < 3) return 0;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let bestArea = Infinity, bestAngle = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(angle), s = Math.sin(angle);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) { bestArea = area; bestAngle = angle; }
  }
  return bestAngle;
}

/** Rotate a geometry about Y so its minimum-area plan rectangle is axis-aligned (in place). */
export function alignPlan(geometry) {
  const angle = planAlignmentAngle(geometry);
  // A point at plan angle `angle` must land on +x: rotateY(+t) maps (x, z) to (x cos t + z sin t, -x sin t + z cos t).
  if (Math.abs(angle) > 1e-4) geometry.rotateY(angle);
  return angle;
}

