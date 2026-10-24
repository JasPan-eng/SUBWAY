import * as THREE from "three";

export const PRACTICALS_DEFAULTS = {
  enabled: true,
  interiorIntensity: 1.6,
  exteriorIntensity: 2.0,
  halo: 1.0,
  lampSpacing: 35,
};

const RANGE = 250;
const STREET_Y = -10.5;

/** Fixtures in the trained car's metre frame, fitted exactly like window glass. */
export function createInteriorPracticals(settings) {
  const object = new THREE.Group();
  object.name = "interior practicals";
  object.visible = false;
  const material = new THREE.MeshBasicMaterial({
    toneMapped: false, fog: false, depthWrite: false, transparent: false,
  });
  const tubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.03, 0.10), material, 18);
  tubes.renderOrder = 1001;
  const matrix = new THREE.Matrix4();
  // Nine complete tubes per row: 11.6 m overall, centred in [-6.2, 6.3].
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 9; i++) {
      matrix.makeTranslation(0.05 + (i - 4) * 1.3, 3.75, row ? -0.75 : 0.75);
      tubes.setMatrixAt(row * 9 + i, matrix);
    }
  }
  object.add(tubes);
  let fitted = false;
  let dayNight = 0;
  function update(t) {
    dayNight = THREE.MathUtils.clamp(t, 0, 1);
    object.visible = fitted && settings.enabled;
    // Clamp the hot-white display colour first, then dim it for daylight.
    const intensity = THREE.MathUtils.clamp(settings.interiorIntensity, 0, 4);
    const dim = 1 - 0.3 * dayNight;
    material.color.setRGB(Math.min(1, intensity) * dim, Math.min(1, 0.93 * intensity) * dim, Math.min(1, 0.80 * intensity) * dim);
  }
  update(0);
  return {
    object,
    configure(next) { settings = next; update(dayNight); },
    fit(centre, scale) {
      object.position.copy(centre).multiplyScalar(-scale);
      object.scale.setScalar(scale);
      fitted = true;
      update(dayNight);
    },
    clear() { fitted = false; object.visible = false; },
    update,
    dispose() {
      object.removeFromParent();
      tubes.dispose();
      tubes.geometry.dispose();
      material.dispose();
    },
  };
}

/** Sparse sources in route metres; all update scratch space and GPU buffers are reused. */
export function createPracticals({ root, route }) {
  const frame = new THREE.Group();
  frame.name = "exterior practicals";
  frame.rotation.y = Math.PI;
  root.add(frame);
  const emitterGeometry = new THREE.IcosahedronGeometry(0.12, 1);
  const haloGeometry = new THREE.PlaneGeometry(1.4, 1.4);
  const emitterMaterial = new THREE.MeshBasicMaterial({ toneMapped: false, fog: false });
  const haloMaterial = new THREE.ShaderMaterial({
    uniforms: { uIntensity: { value: 2 }, uAlpha: { value: 0.35 } },
    toneMapped: false, fog: false, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        vUv = uv;
        vColor = instanceColor;
        vec3 centre = instanceMatrix[3].xyz;
        // Rows of modelViewMatrix give camera right/up in the route frame.
        // Normalising preserves the parent's metre-to-sim scale on projection.
        vec3 right = normalize(vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]));
        vec3 up = normalize(vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]));
        vec3 billboard = centre + right * position.x + up * position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(billboard, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uIntensity, uAlpha;
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        float r = length(vUv * 2.0 - 1.0);
        float falloff = pow(max(0.0, 1.0 - r), 3.0);
        gl_FragColor = vec4(vColor * uIntensity, uAlpha * falloff);
        #include <colorspace_fragment>
      }
    `,
  });
  function kind(name, capacity) {
    const emitter = new THREE.InstancedMesh(emitterGeometry, emitterMaterial, capacity);
    const halo = new THREE.InstancedMesh(haloGeometry, haloMaterial, capacity);
    for (const mesh of [emitter, halo]) {
      mesh.name = `${name} ${mesh === halo ? "halos" : "emitters"}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      frame.add(mesh);
    }
    return { emitter, halo };
  }
  const lamps = kind("street lamps", 26); // 500 m / minimum 20 m + inclusive endpoint
  const platforms = kind("platform lights", 78); // three stations, 13 positions, two sides
  const signals = kind("signals", 3);
  const kinds = [lamps, platforms, signals];
  const stations = Object.values(route.stations).map(station => station.s);
  const point = {};
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const unit = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const matrix = new THREE.Matrix4();
  const amber = new THREE.Color(1, 0.62, 0.25);
  const cool = new THREE.Color(1, 0.95, 0.88);
  const green = new THREE.Color(0.25, 1, 0.35);
  const red = new THREE.Color(1, 0.2, 0.15);
  let spacing = 35;
  let distance = 0;
  let previousDistance = NaN;
  let enabled, intensity, haloAmount;

  function place(kind, s, lateral, height, color) {
    if (s < 0 || s > route.total || Math.abs(s - distance) > RANGE) return;
    route.sample(s, point);
    const yaw = Math.atan2(point.dy, point.dx);
    // Local +Z is the right-hand side of the +X route tangent.
    position.set(point.x + Math.sin(yaw) * lateral, height, -point.y + Math.cos(yaw) * lateral);
    quaternion.setFromAxisAngle(up, yaw);
    matrix.compose(position, quaternion, unit);
    const index = kind.emitter.count++;
    kind.halo.count++;
    kind.emitter.setMatrixAt(index, matrix);
    kind.halo.setMatrixAt(index, matrix);
    kind.emitter.setColorAt(index, color);
    kind.halo.setColorAt(index, color);
  }
  function layout() {
    for (let i = 0; i < kinds.length; i++) {
      kinds[i].emitter.count = kinds[i].halo.count = 0;
    }
    const firstLamp = Math.max(0, Math.ceil((distance - RANGE) / spacing));
    const lastLamp = Math.min(Math.floor(route.total / spacing), Math.floor((distance + RANGE) / spacing));
    for (let k = firstLamp; k <= lastLamp; k++) place(lamps, k * spacing, k % 2 ? -11 : 11, STREET_Y + 8, amber);
    for (let i = 0; i < stations.length; i++) {
      // Every 12 m: at 6 m the two rows read as an airstrip from the car.
      for (let k = 0; k <= 12; k++) {
        const s = stations[i] - 72 + k * 12;
        place(platforms, s, -7, 3.2, cool);
        place(platforms, s, 7, 3.2, cool);
      }
    }
    const firstSignal = Math.max(0, Math.ceil((distance - RANGE) / 180));
    const lastSignal = Math.min(Math.floor(route.total / 180), Math.floor((distance + RANGE) / 180));
    for (let k = firstSignal; k <= lastSignal; k++) place(signals, k * 180, 6, 1.5, k % 3 === 2 ? red : green);
    for (let i = 0; i < kinds.length; i++) {
      kinds[i].emitter.instanceMatrix.needsUpdate = kinds[i].halo.instanceMatrix.needsUpdate = true;
      kinds[i].emitter.instanceColor.needsUpdate = kinds[i].halo.instanceColor.needsUpdate = true;
    }
    previousDistance = distance;
  }
  return {
    configure(p) {
      const settings = p.practicals ?? PRACTICALS_DEFAULTS;
      const nextSpacing = THREE.MathUtils.clamp(settings.lampSpacing, 20, 60);
      const dirty = spacing !== nextSpacing || enabled !== settings.enabled || intensity !== settings.exteriorIntensity || haloAmount !== settings.halo;
      spacing = nextSpacing;
      enabled = settings.enabled;
      intensity = THREE.MathUtils.clamp(settings.exteriorIntensity, 0, 4);
      haloAmount = THREE.MathUtils.clamp(settings.halo, 0, 3);
      const night = 1 - THREE.MathUtils.clamp(p.dayNight, 0, 1);
      frame.visible = enabled;
      emitterMaterial.color.setScalar(intensity * (0.25 + 0.75 * night));
      haloMaterial.uniforms.uIntensity.value = intensity * night;
      haloMaterial.uniforms.uAlpha.value = 0.35 * haloAmount;
      for (let i = 0; i < kinds.length; i++) kinds[i].halo.visible = night > 0 && intensity > 0 && haloAmount > 0;
      if (dirty || Number.isNaN(previousDistance)) layout();
    },
    update(dt, nextDistance) {
      distance = nextDistance;
      if (distance !== previousDistance) layout();
    },
    dispose() {
      root.remove(frame);
      for (let i = 0; i < kinds.length; i++) {
        kinds[i].emitter.dispose();
        kinds[i].halo.dispose();
      }
      emitterGeometry.dispose();
      haloGeometry.dispose();
      emitterMaterial.dispose();
      haloMaterial.dispose();
    },
  };
}
