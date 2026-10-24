// Convert a 3DGS .ply into Spark/Niantic .spz using Spark's own transcoder (WASM).
//   node tools/ply2spz.mjs in.ply out.spz [maxSh=3] [opacityThreshold=0.02]
import { readFile, writeFile } from "node:fs/promises";
import { transcodeSpz } from "@sparkjsdev/spark";

const [src, dst, maxShArg, opaArg] = process.argv.slice(2);
if (!src || !dst) {
  console.error("usage: node tools/ply2spz.mjs in.ply out.spz [maxSh] [opacityThreshold]");
  process.exit(1);
}
const fileBytes = new Uint8Array(await readFile(src));
const t0 = performance.now();
const { fileBytes: spz } = await transcodeSpz({
  inputs: [{ fileBytes, pathOrUrl: src }],
  maxSh: maxShArg ? Number(maxShArg) : 3,
  opacityThreshold: opaArg ? Number(opaArg) : 0.02,
});
await writeFile(dst, spz);
console.log(`${src} (${(fileBytes.length / 1e6).toFixed(1)} MB) -> ${dst} (${(spz.length / 1e6).toFixed(1)} MB) in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
