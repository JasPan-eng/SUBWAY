import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// Route-local east/north to the hero boxes' rotated root frame.
export function insideHeroDiscard(x, y, discard) {
  for (let i = 0; i < discard.uHeroCount.value; i++) {
    const b = discard.uHeroBoxes.value[i], r = discard.uHeroRot.value[i];
    const dx = -x - b.x, dz = y - b.y;
    if (Math.abs(r.x * dx - r.y * dz) < b.z + 1 && Math.abs(r.y * dx + r.x * dz) < b.w + 1) return true;
  }
  return false;
}

function shape(pts) {
  const result = new THREE.Shape();
  pts.forEach(([x, y], i) => i ? result.lineTo(x, y) : result.moveTo(x, y));
  result.closePath();
  return result;
}
function merge(parts) {
  if (!parts.length) return new THREE.BufferGeometry();
  const result = mergeGeometries(parts, false);
  for (const geometry of parts) geometry.dispose();
  return result;
}

export function createMapLayers(frame, block) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ color: '#d9d6cf', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -10.5; ground.receiveShadow = true; frame.add(ground);
  const roadColors = { primary: '#8d8f94', secondary: '#8d8f94', tertiary: '#9da0a5', residential: '#9da0a5', unclassified: '#9da0a5', service: '#b0b2b5', footway: '#c9c6bf', pedestrian: '#c9c6bf' };
  const positions = [], colors = [], color = new THREE.Color();
  const named = new Map();
  for (const road of block.streets) {
    color.set(roadColors[road.kind] ?? '#b0b2b5');
    let length = 0;
    for (let i = 1; i < road.pts.length; i++) {
      const [ax, ay] = road.pts[i - 1], [bx, by] = road.pts[i];
      const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy); length += d;
      if (d < 0.001) continue;
      const nx = -dy / d * road.width / 2, ny = dx / d * road.width / 2;
      const corners = [[ax + nx, ay + ny], [ax - nx, ay - ny], [bx + nx, by + ny], [bx - nx, by - ny]];
      for (const index of [0, 1, 2, 2, 1, 3]) {
        positions.push(corners[index][0], -10.47, -corners[index][1]); colors.push(color.r, color.g, color.b);
      }
    }
    if (road.name && ['primary', 'secondary', 'tertiary'].includes(road.kind) && length > (named.get(road.name)?.length ?? 0)) named.set(road.name, { road, length });
  }
  const ribbons = new THREE.BufferGeometry();
  ribbons.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  ribbons.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); ribbons.computeVertexNormals();
  const streets = new THREE.Mesh(ribbons, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  streets.receiveShadow = true; frame.add(streets);
  const parkParts = block.parks.filter((p) => p.pts.length >= 3).map((p) => new THREE.ShapeGeometry(shape(p.pts)).rotateX(-Math.PI / 2).translate(0, -10.48, 0));
  const parks = new THREE.Mesh(merge(parkParts), new THREE.MeshStandardMaterial({ color: '#a9c49a', roughness: 1, side: THREE.DoubleSide }));
  parks.receiveShadow = true; frame.add(parks);
  const labels = [];
  for (const [name, { road, length }] of named) {
    let remaining = length / 2;
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (remaining > d) { remaining -= d; continue; }
      const t = d ? remaining / d : 0;
      const element = document.createElement('span'); element.className = 'street-label'; element.textContent = name;
      const label = new CSS2DObject(element); label.position.set(a[0] + (b[0] - a[0]) * t, -10.35, -(a[1] + (b[1] - a[1]) * t));
      frame.add(label); labels.push({ object: label, world: new THREE.Vector3(), element, opacity: -1 }); break;
    }
  }
  frame.updateWorldMatrix(true, true);
  for (const label of labels) label.object.getWorldPosition(label.world);
  let clay;
  function rebuildClay(covered, discard) {
    const parts = [];
    for (const building of block.buildings) {
      if (covered.has(String(building.id)) || building.pts.length < 3) continue;
      if (insideHeroDiscard(building.x, building.y, discard)) continue;
      parts.push(new THREE.ExtrudeGeometry(shape(building.pts), { depth: Math.max(1, building.height), bevelEnabled: false, steps: 1, curveSegments: 1 }).rotateX(-Math.PI / 2).translate(0, -10.5, 0));
    }
    const geometry = merge(parts);
    if (clay) { clay.geometry.dispose(); clay.geometry = geometry; }
    else {
      clay = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#e4e1da', roughness: 0.95, flatShading: true }));
      clay.castShadow = clay.receiveShadow = true; frame.add(clay);
    }
  }
  return { rebuildClay, updateLabels(camera) {
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i], distance = camera.position.distanceTo(label.world);
      const opacity = Math.round(THREE.MathUtils.clamp((400 - distance) / 100, 0, 1) * 20) / 20;
      if (opacity !== label.opacity) { label.opacity = opacity; label.object.visible = opacity > 0; label.element.style.opacity = opacity; }
    }
  } };
}
