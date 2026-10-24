/**
 * Relight: per-splat colour crossfade between two trained variants of the same
 * gaussians (night base -> day), driven by a single 0..1 amount.
 *
 * The day variant is trained from the night splat with geometry and opacity
 * frozen (train_splat.py --init_splat ... --freeze_geometry --freeze_opacity), so
 * both files transcode to the same splat set in the same order. The viewer loads
 * the day file once, copies its base colours into a float texture (one texel per
 * splat, 512 wide like the sim textures) and this Spark objectModifier mixes the
 * night rgb toward the day rgb by `relightAmount`. Runs before flow/sway.
 */
import * as THREE from "three";
import { dyno } from "@sparkjsdev/spark";

const WIDTH = 512;

function makeTexture(data, rows) {
  const tex = new THREE.DataTexture(data, WIDTH, rows, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export function createRelight() {
  const empty = makeTexture(new Float32Array(4), 1);
  const uniforms = {
    relightColors: { value: empty },
    relightAmount: { value: 0 },
    relightGain: { value: 1 },
    relightWidth: { value: WIDTH },
  };
  let ready = false;
  let colours = null;

  const modifier = new dyno.Dyno({
    inTypes: { gsplat: dyno.Gsplat },
    outTypes: { gsplat: dyno.Gsplat },
    generate: ({ inputs, outputs }) => ({
      uniforms,
      globals: [
        /* glsl */ `
        uniform sampler2D relightColors;
        uniform float relightAmount, relightGain;
        uniform int relightWidth;`,
      ],
      statements: [
        `${outputs.gsplat} = ${inputs.gsplat};`,
        /* glsl */ `if (relightAmount > 0.0) {
          ivec2 rc = ivec2(${inputs.gsplat}.index % relightWidth, ${inputs.gsplat}.index / relightWidth);
          vec4 day = texelFetch(relightColors, rc, 0);
          if (day.a > 0.5) ${outputs.gsplat}.rgba.rgb = mix(${inputs.gsplat}.rgba.rgb, min(day.rgb * relightGain, vec3(1.0)), relightAmount);
        }`,
      ],
    }),
  });

  return {
    modifier,
    uniforms,
    get ready() {
      return ready;
    },
    get amount() {
      return uniforms.relightAmount.value;
    },
    /**
     * Copy the day colours of a loaded SplatMesh (same splat order as the base).
     * @param {import("@sparkjsdev/spark").SplatMesh} dayMesh
     * @param {number} count  splat count of the base mesh (must match)
     * @param {(index:number, color:THREE.Color)=>void} [tweak] optional per-splat adjust
     */
    setFromMesh(dayMesh, count, tweak) {
      const n = dayMesh.packedSplats?.numSplats ?? 0;
      if (n !== count) throw new Error(`day splat has ${n.toLocaleString()} splats, base has ${count.toLocaleString()}`);
      const rows = Math.max(1, Math.ceil(count / WIDTH));
      const data = new Float32Array(WIDTH * rows * 4);
      dayMesh.forEachSplat((index, _center, _scales, _quat, _opacity, color) => {
        if (tweak) tweak(index, color);
        const o = index * 4;
        data[o] = color.r;
        data[o + 1] = color.g;
        data[o + 2] = color.b;
        data[o + 3] = 1;
      });
      this.setColours(data, rows);
    },
    /** Raw RGBA float data, WIDTH x rows texels. */
    setColours(data, rows) {
      colours?.dispose();
      colours = makeTexture(data, rows);
      uniforms.relightColors.value = colours;
      ready = true;
    },
    clear() {
      colours?.dispose();
      colours = null;
      uniforms.relightColors.value = empty;
      ready = false;
    },
    /** Brightness multiplier on the day colours (the Krea-averaged variant lands a little dim). */
    setGain(v) {
      uniforms.relightGain.value = v;
    },
    setAmount(v) {
      uniforms.relightAmount.value = THREE.MathUtils.clamp(v, 0, 1);
    },
  };
}
