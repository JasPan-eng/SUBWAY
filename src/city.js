/**
 * The city outside the windows: Google Photorealistic 3D Tiles streamed through
 * 3d-tiles-renderer, following the elevated J line over Broadway.
 *
 * The car never moves. The whole city is mounted under one root that is scaled
 * to sim units (car length = 1), rotated so the track heading lines up with the
 * car's +X, and translated so the current route point sits at the car. Scrubbing
 * the journey slides the city past the windows.
 *
 * Tile materials are replaced by unlit, tinted materials: there are no lights in
 * the splat scene and the capture is a daytime one, so the tint turns it into night.
 */
import * as THREE from "three";
import { TilesRenderer } from "3d-tiles-renderer";
import { GoogleCloudAuthPlugin } from "3d-tiles-renderer/plugins";
import { GLTFExtensionsPlugin, ReorientationPlugin } from "3d-tiles-renderer/plugins";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

export const CITY_DEFAULTS = {
  enabled: true,
  journey: 0.45, // 0 = Flushing Av end, 1 = Kosciuszko St end
  auto: true,
  speedMps: 6, // train speed along the route when auto
  bounce: true,
  trackHeight: -2.5, // ellipsoid height (m) of the rails at Myrtle Av; the tile mesh under the station reads ~ -1.5 m there
  floorAboveRail: 1.1, // car floor height above the rails (m)
  lateral: 0, // sideways offset of the car from the track centreline (m)
  dayNight: 0, // 0 = night preset, 1 = day preset (the look fields below are the result)
  tint: "#5a6f9a",
  brightness: 0.9,
  fog: true,
  fogColor: "#0a1020",
  fogDensity: 0.006, // per metre (converted to sim units internally)
  sky: true,
  skyZenith: "#0a0f1e",
  skyHorizon: "#2c3a63",
  errorTarget: 6, // screen-space error in px; lower = finer tiles, more downloads
  maxDepth: 40,
};

/** Look presets blended by `dayNight`. */
export const CITY_NIGHT = { tint: "#5a6f9a", brightness: 0.9, fogColor: "#0a1020", fogDensity: 0.006, skyZenith: "#0a0f1e", skyHorizon: "#2c3a63" };
export const CITY_DAY = { tint: "#ffffff", brightness: 1.05, fogColor: "#c7d3e6", fogDensity: 0.0012, skyZenith: "#4f86d6", skyHorizon: "#d6e4f5" };

/** Blend two look presets (colours in sRGB hex) by t. */
export function blendLook(t) {
  const c = (a, b) => "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
  return {
    tint: c(CITY_NIGHT.tint, CITY_DAY.tint),
    brightness: THREE.MathUtils.lerp(CITY_NIGHT.brightness, CITY_DAY.brightness, t),
    fogColor: c(CITY_NIGHT.fogColor, CITY_DAY.fogColor),
    fogDensity: THREE.MathUtils.lerp(CITY_NIGHT.fogDensity, CITY_DAY.fogDensity, t),
    skyZenith: c(CITY_NIGHT.skyZenith, CITY_DAY.skyZenith),
    skyHorizon: c(CITY_NIGHT.skyHorizon, CITY_DAY.skyHorizon),
  };
}

/** Piecewise-linear route sampler over data/route_j.json (x east, y north, metres). */
export function createRoute(route) {
  const pts = route.points;
  const total = pts[pts.length - 1].s;
  const out = { total, stations: route.stations, origin: route.origin };
  out.sample = (s, target = {}) => {
    const sc = THREE.MathUtils.clamp(s, 0, total);
    let i = 1;
    while (i < pts.length - 1 && pts[i].s < sc) i++;
    const a = pts[i - 1], b = pts[i];
    const t = (sc - a.s) / Math.max(1e-6, b.s - a.s);
    target.x = THREE.MathUtils.lerp(a.x, b.x, t);
    target.y = THREE.MathUtils.lerp(a.y, b.y, t);
    // heading: average of the neighbouring segments for smoothness
    const a0 = pts[Math.max(0, i - 2)], b0 = pts[Math.min(pts.length - 1, i + 1)];
    target.dx = b0.x - a0.x;
    target.dy = b0.y - a0.y;
    target.s = sc;
    return target;
  };
  out.nearestStation = (s) => {
    let best = null;
    for (const [name, st] of Object.entries(route.stations)) {
      const d = st.s - s;
      if (!best || Math.abs(d) < Math.abs(best.d)) best = { name, d };
    }
    return best;
  };
  return out;
}

/**
 * @param {{ renderer: THREE.WebGLRenderer, scene: THREE.Scene, apiKey: string, route: object, carLengthMetres: number, base: string }} o
 */
export function createCity(o) {
  let p = { ...CITY_DEFAULTS };
  const route = createRoute(o.route);
  const scale = 1 / o.carLengthMetres; // metres -> sim units
  const root = new THREE.Group();
  root.name = "city";
  o.scene.add(root);

  const draco = new DRACOLoader();
  draco.setDecoderPath(`${o.base}draco/`);

  const tiles = new TilesRenderer();
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: o.apiKey, autoRefreshToken: true }));
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
  const reorient = new ReorientationPlugin({
    lat: THREE.MathUtils.degToRad(route.origin.lat),
    lon: THREE.MathUtils.degToRad(route.origin.lon),
    height: p.trackHeight,
    recenter: true,
  });
  tiles.registerPlugin(reorient);
  tiles.errorTarget = p.errorTarget;
  tiles.maxDepth = p.maxDepth;
  root.add(tiles.group);

  // Night look: unlit tinted materials, optional fog.
  const tint = new THREE.Color(p.tint);
  const materials = new Set();
  // Own exponential fog on the tile materials: a global scene.fog would also reach
  // Spark's splat shader, which does not support it and renders nothing.
  const fogUniforms = { uCityFogColor: { value: new THREE.Color(p.fogColor) }, uCityFogDensity: { value: 0 } };
  function nightMaterial(mat) {
    const m = new THREE.MeshBasicMaterial({ map: mat.map ?? null, color: tint.clone().multiplyScalar(p.brightness), fog: false });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, fogUniforms);
      const V = "varying float vCityDepth;";
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${V}`)
        .replace("#include <project_vertex>", "#include <project_vertex>\nvCityDepth = -mvPosition.z;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${V}\nuniform vec3 uCityFogColor;\nuniform float uCityFogDensity;`)
        .replace(
          "#include <dithering_fragment>",
          "#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uCityFogColor, 1.0 - exp(-uCityFogDensity * vCityDepth));",
        );
    };
    m.userData.city = true;
    materials.add(m);
    return m;
  }
  tiles.addEventListener("load-model", ({ scene }) => {
    scene.traverse((obj) => {
      if (obj.isMesh && obj.material && !obj.material.userData?.city) {
        const old = obj.material;
        obj.material = nightMaterial(old);
        old.dispose?.();
      }
    });
  });
  tiles.addEventListener("dispose-model", ({ scene }) => {
    scene.traverse((obj) => {
      if (obj.isMesh && obj.material?.userData?.city) {
        materials.delete(obj.material);
        obj.material.dispose();
      }
    });
  });


  // Night sky: a camera-following dome with a horizon glow (the tiles carry no sky).
  const skyUniforms = { uZenith: { value: new THREE.Color(p.skyZenith) }, uHorizon: { value: new THREE.Color(p.skyHorizon) } };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(30, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: "varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "uniform vec3 uZenith; uniform vec3 uHorizon; varying vec3 vDir; void main() { float h = clamp(vDir.y, -0.05, 1.0); float t = pow(1.0 - h, 1.6); gl_FragColor = vec4(mix(uZenith, uHorizon, t), 1.0); }",
    }),
  );
  sky.name = "sky";
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  o.scene.add(sky);

  let journey = p.journey;
  let direction = 1;
  const pt = {};
  const P = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const plusX = new THREE.Vector3(1, 0, 0);
  const sideways = new THREE.Vector3();

  function applyLook() {
    tint.set(p.tint);
    for (const m of materials) m.color.copy(tint).multiplyScalar(p.brightness);
    fogUniforms.uCityFogColor.value.set(p.fogColor);
    // density is per metre; depth in the shader is in sim units (metres * scale)
    fogUniforms.uCityFogDensity.value = p.fog ? p.fogDensity / scale : 0;
    skyUniforms.uZenith.value.set(p.skyZenith);
    skyUniforms.uHorizon.value.set(p.skyHorizon);
    sky.visible = p.sky && p.enabled;
  }
  applyLook();

  return {
    tiles,
    root,
    route,
    get params() {
      return p;
    },
    get journey() {
      return journey;
    },
    get distance() {
      return journey * route.total;
    },
    configure(next) {
      const prev = p;
      p = { ...p, ...next };
      if (next.dayNight !== undefined && next.dayNight !== prev.dayNight) Object.assign(p, blendLook(p.dayNight));
      if (next.journey !== undefined && next.journey !== prev.journey) journey = next.journey;
      tiles.errorTarget = p.errorTarget;
      tiles.maxDepth = p.maxDepth;
      root.visible = p.enabled;
      if (p.trackHeight !== prev.trackHeight) {
        reorient.transformLatLonHeightToOrigin(THREE.MathUtils.degToRad(route.origin.lat), THREE.MathUtils.degToRad(route.origin.lon), p.trackHeight);
      }
      applyLook();
    },
    /** Day/night blend 0..1 (also updates the public params so the GUI follows). */
    setDayNight(t) {
      p.dayNight = THREE.MathUtils.clamp(t, 0, 1);
      Object.assign(p, blendLook(p.dayNight));
      applyLook();
    },
    /** Set the journey directly (0..1), e.g. from the scroll story. */
    setJourney(j) {
      journey = THREE.MathUtils.clamp(j, 0, 1);
      p.journey = journey;
    },
    /** Scroll input: metres along the route. */
    advance(metres) {
      journey = THREE.MathUtils.clamp(journey + metres / route.total, 0, 1);
      p.journey = journey;
    },
    /**
     * @param {number} dt seconds
     * @param {THREE.Camera} camera
     * @param {number} floorSimY  sim-space y of the car floor
     */
    update(dt, camera, floorSimY) {
      if (!p.enabled) return;
      if (p.auto) {
        journey += (direction * p.speedMps * dt) / route.total;
        if (journey > 1 || journey < 0) {
          if (p.bounce) direction *= -1;
          journey = THREE.MathUtils.clamp(journey, 0, 1);
        }
        p.journey = journey;
      }
      route.sample(journey * route.total, pt);
      // Local tiles frame after reorientation (measured): east = -X, up = +Y, north = +Z.
      P.set(-pt.x, 0, pt.y);
      dir.set(-pt.dx, 0, pt.dy).normalize();
      if (direction < 0) dir.negate();
      q.setFromUnitVectors(dir, plusX);
      sideways.set(-dir.z, 0, dir.x).multiplyScalar(p.lateral);
      P.add(sideways);
      root.quaternion.copy(q);
      root.scale.setScalar(scale);
      root.position.copy(P).multiplyScalar(-scale).applyQuaternion(q);
      // Rails sit floorAboveRail below the car floor.
      root.position.y += floorSimY - p.floorAboveRail * scale;
      root.updateMatrixWorld(true);

      camera.updateMatrixWorld();
      sky.position.copy(camera.position);
      tiles.setCamera(camera);
      tiles.setResolutionFromRenderer(camera, o.renderer);
      tiles.update();
    },
    info() {
      const s = journey * route.total;
      const st = route.nearestStation(s);
      return { station: st ? `${st.name} ${st.d >= 0 ? "+" : ""}${Math.round(st.d)} m` : "", route: `${Math.round(s)} / ${Math.round(route.total)} m` };
    },
    dispose() {
      tiles.dispose();
      o.scene.remove(root);
      o.scene.remove(sky);
    },
  };
}
