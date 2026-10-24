import * as THREE from "three";
import passengers from "../data/passengers.json";

export const PASSENGER_DEFAULTS = {
  enabled: true,
  shadow: 0.2,
  yawLimit: 0.35,
  tintNight: { r: 0.78, g: 0.82, b: 0.95 },
};

function silhouetteTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(170,170,180,0.85)";
  // One filled outline avoids darker overlaps. Hip line: floor + 0.49 m
  // (about pixel 311 for the supplied 1.25 m figures).
  ctx.beginPath();
  ctx.arc(128, 48, 46, 0, Math.PI * 2);
  ctx.moveTo(108, 92);
  ctx.lineTo(148, 92);
  ctx.quadraticCurveTo(193, 96, 202, 139);
  ctx.lineTo(217, 302);
  ctx.quadraticCurveTo(220, 329, 202, 349);
  ctx.lineTo(195, 483);
  ctx.lineTo(220, 496);
  ctx.lineTo(220, 512);
  ctx.lineTo(151, 512);
  ctx.lineTo(143, 357);
  ctx.lineTo(113, 357);
  ctx.lineTo(105, 512);
  ctx.lineTo(36, 512);
  ctx.lineTo(36, 496);
  ctx.lineTo(61, 483);
  ctx.lineTo(54, 349);
  ctx.quadraticCurveTo(36, 329, 39, 302);
  ctx.lineTo(54, 139);
  ctx.quadraticCurveTo(63, 96, 108, 92);
  ctx.closePath();
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function shadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Seated planes in trained car metres; stops come from the active story. */
export function createPassengers(settings, { stops, base = "/", debug = false }) {
  const object = new THREE.Group();
  object.name = "passengers";
  object.visible = false;
  const figures = [];
  const textures = new Set();
  const warned = new Set();
  const loader = new THREE.TextureLoader();
  const cameraLocal = new THREE.Vector3();
  const tint = new THREE.Color();
  let silhouette, shadowMap, shadowGeometry;
  let fitted = false;
  let disposed = false;

  function getSilhouette() {
    if (!silhouette) {
      silhouette = silhouetteTexture();
      textures.add(silhouette);
    }
    return silhouette;
  }

  for (const slot of passengers.figures ?? []) {
    if (!slot.image && !debug) continue;
    if (!shadowMap) {
      shadowMap = shadowTexture();
      textures.add(shadowMap);
      shadowGeometry = new THREE.PlaneGeometry(0.70, 0.55);
    }
    const height = slot.height ?? 1.25;
    const material = new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, depthTest: true,
      side: THREE.DoubleSide, toneMapped: false, alphaTest: 0.02,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(height * 0.62, height), material);
    plane.name = slot.id;
    plane.position.set(slot.x, 1.35 + height / 2, slot.side * 0.78);
    const baseYaw = (slot.side > 0 ? Math.PI : 0) + (slot.yaw ?? 0);
    plane.rotation.y = baseYaw;
    plane.renderOrder = 1002;
    plane.visible = false;
    const shadow = new THREE.Mesh(shadowGeometry, new THREE.MeshBasicMaterial({
      map: shadowMap, color: 0x000000, transparent: true,
      depthWrite: false, depthTest: true, toneMapped: false, opacity: 0,
    }));
    shadow.name = `${slot.id} contact shadow`;
    shadow.position.set(slot.x, 1.845, slot.side * 0.88);
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 1002;
    shadow.visible = false;
    object.add(plane, shadow);
    const figure = { slot, plane, shadow, baseYaw, ready: false };
    figures.push(figure);
    function useTexture(texture, aspect) {
      material.map = texture;
      material.needsUpdate = true;
      plane.scale.x = aspect / 0.62;
      figure.ready = true;
    }
    if (!slot.image) {
      useTexture(getSilhouette(), 0.62);
    } else {
      const texture = loader.load(`${base}passengers/${slot.image}`, (loaded) => {
        if (disposed) { loaded.dispose(); return; }
        loaded.colorSpace = THREE.SRGBColorSpace;
        useTexture(loaded, loaded.image.width / loaded.image.height);
      }, undefined, () => {
        if (disposed) return;
        if (!warned.has(slot.image)) {
          warned.add(slot.image);
          console.warn(`Passenger image unavailable: ${slot.image}`);
        }
        if (debug) useTexture(getSilhouette(), 0.62);
      });
      texture.colorSpace = THREE.SRGBColorSpace;
      textures.add(texture);
    }
  }

  return {
    object,
    fit(centre, scale) {
      object.position.copy(centre).multiplyScalar(-scale);
      object.scale.setScalar(scale);
      fitted = true;
      object.visible = settings.enabled && figures.length > 0;
    },
    clear() { fitted = false; object.visible = false; },
    update(state, camera, dayNight) {
      if (figures.length === 0) return;
      object.visible = fitted && settings.enabled && !disposed;
      if (!object.visible) return;
      camera.getWorldPosition(cameraLocal);
      object.worldToLocal(cameraLocal);
      const day = THREE.MathUtils.clamp(dayNight, 0, 1);
      const night = settings.tintNight;
      tint.setRGB(night.r + (1 - night.r) * day,
        night.g + (1 - night.g) * day, night.b + (1 - night.b) * day);
      const t = THREE.MathUtils.clamp(state.t, 0, Math.max(0, stops.length - 1));
      const i = Math.floor(t);
      const a = stops[i]?.id;
      const b = stops[Math.min(i + 1, stops.length - 1)]?.id;
      const blend = THREE.MathUtils.smoothstep(t - i, 0, 1);
      const limit = THREE.MathUtils.clamp(settings.yawLimit, 0, 0.8);
      for (let index = 0; index < figures.length; index++) {
        const figure = figures[index];
        const { slot, plane, shadow, baseYaw } = figure;
        const presence = THREE.MathUtils.lerp(slot.presence[a] ?? 0, slot.presence[b] ?? 0, blend);
        plane.visible = shadow.visible = figure.ready && presence >= 0.01;
        plane.material.opacity = presence;
        shadow.material.opacity = THREE.MathUtils.clamp(settings.shadow, 0, 0.5) * presence;
        plane.material.color.copy(tint);
        if (!plane.visible) continue;
        const angle = Math.atan2(cameraLocal.x - plane.position.x, cameraLocal.z - plane.position.z) - baseYaw;
        // Wrap before clamping so +pi/-pi is continuous for the left bench.
        const relative = Math.atan2(Math.sin(angle), Math.cos(angle));
        plane.rotation.y = baseYaw + THREE.MathUtils.clamp(relative, -limit, limit);
      }
    },
    dispose() {
      disposed = true;
      object.visible = false;
      object.removeFromParent();
      for (const { plane, shadow } of figures) {
        plane.geometry.dispose();
        plane.material.dispose();
        shadow.material.dispose();
      }
      shadowGeometry?.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}
