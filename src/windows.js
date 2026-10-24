import * as THREE from "three";
import windows from "../data/windows.json";

/** Restrained glass in the trained metre frame, normalised exactly like the car. */
export function createWindows(settings) {
  const object = new THREE.Group();
  object.name = "window glass";
  object.visible = false;
  const uniforms = {
    uReflection: { value: settings.reflectionNight },
    uDirt: { value: settings.dirt },
    uDayNight: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    vertexShader: `
      varying vec3 vViewPosition;
      varying vec3 vNormal;
      varying vec2 vGlass;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = viewPosition.xyz;
        vNormal = normalize(normalMatrix * normal);
        vGlass = position.xy;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform float uReflection, uDirt, uDayNight;
      varying vec3 vViewPosition;
      varying vec3 vNormal;
      varying vec2 vGlass;
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
      }
      void main() {
        float facing = clamp(abs(dot(normalize(vNormal), normalize(-vViewPosition))), 0.0, 1.0);
        float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
        float reflection = fresnel * uReflection;
        float dirt = uDirt * mix(0.67, 1.0, noise(vGlass * 24.0));
        // Constant cool interior proxy; no cube capture or extra render pass.
        vec3 tint = mix(vec3(0.34, 0.43, 0.55), vec3(0.44, 0.51, 0.60), uDayNight);
        float alpha = reflection + dirt;
        // Straight-alpha output: avoid applying the small reflection weight twice.
        vec3 colour = (reflection * tint + dirt * vec3(0.25, 0.27, 0.29)) / max(alpha, 0.00001);
        gl_FragColor = vec4(colour, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  for (const aperture of windows.apertures) {
    const width = aperture.x[1] - aperture.x[0] - 2 * windows.edgeTrim;
    const height = aperture.y[1] - aperture.y[0] - 2 * windows.edgeTrim;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    pane.name = aperture.id;
    pane.position.set(
      (aperture.x[0] + aperture.x[1]) / 2,
      (aperture.y[0] + aperture.y[1]) / 2,
      aperture.z - Math.sign(aperture.z) * windows.interiorInset,
    );
    // Spark renders in the scene with depth. Owner must verify its depth coverage
    // at translucent splat edges: renderOrder alone cannot guarantee occlusion.
    pane.renderOrder = 1000;
    object.add(pane);
  }
  let fitted = false;
  return {
    object,
    uniforms,
    clear() {
      fitted = false;
      object.visible = false;
    },
    fit(centre, scale) {
      // sim = (carFrame - centre) * scale, matching loadSplat's mesh transform.
      object.position.copy(centre).multiplyScalar(-scale);
      object.scale.setScalar(scale);
      fitted = true;
      object.visible = settings.enabled;
    },
    update(dayNight) {
      object.visible = fitted && settings.enabled;
      const mix = THREE.MathUtils.clamp(dayNight, 0, 1);
      uniforms.uDayNight.value = mix;
      uniforms.uReflection.value = settings.reflectionNight + (settings.reflectionDay - settings.reflectionNight) * mix;
      uniforms.uDirt.value = settings.dirt;
    },
  };
}
