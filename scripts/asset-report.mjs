import { readFile, readdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { sourceModule } from './modules.mjs';
const root = new URL('../dist/', import.meta.url);
async function inventory(directory, prefix = '') {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) output.push(...await inventory(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`));
    else {
      const buffer = await readFile(new URL(entry.name, directory));
      output.push({ file: prefix + entry.name, bytes: buffer.length, gzipBytes: gzipSync(buffer).length });
    }
  }
  return output;
}
const files = await inventory(root);
const { createLeaf } = await sourceModule('leaf');
const { Color, Vector3 } = await import('three/webgpu');
const leaf = createLeaf(new Vector3(0, 0.2, -1), new Color('#fff0d0'));
const geometryBytes = Object.values(leaf.geometryVariants).flat().reduce((sum, geometry) => sum + geometry.index.array.byteLength
  + Object.values(geometry.attributes).reduce((bytes, attribute) => bytes + attribute.array.byteLength, 0), 0);
const total = files.reduce((sum, file) => sum + file.bytes, 0);
const gzip = files.reduce((sum, file) => sum + file.gzipBytes, 0);
const mib = bytes => (bytes / 1024 ** 2).toFixed(2);
let text = '# Asset budget after startup optimization\n\n';
text += '| Built file | Raw KiB | Gzip KiB |\n| --- | ---: | ---: |\n';
for (const file of files) text += `| ${file.file} | ${(file.bytes / 1024).toFixed(1)} | ${(file.gzipBytes / 1024).toFixed(1)} |\n`;
text += `\nEntire build: **${mib(total)} MiB raw / ${mib(gzip)} MiB gzip estimate**. No KTX2, Basis decoder, WASM, or image files ship. Gzip estimates depend on server configuration and exclude request overhead.\n\n`;
text += `Foliage texture storage: **${mib(leaf.textureBytes)} MiB** for fifteen 256px RGBA8 maps including full mip chains, shared by depth tiers. The five color families, normal maps, packed thickness/roughness, and cutout silhouettes remain. Previous KTX2 atlas: 6 MiB with native 4×4 block compression, or about 24 MiB when transcoded to RGBA32. Previous 512px procedural version: 20 MiB. These are allocation-size estimates, not driver GPU heap measurements.\n\n`;
text += `One 2.6 KiB worker generates surfaces once. Pixel buffers transfer without copies, and the worker terminates immediately. CPU staging pixels occupy 3.75 MiB retained by Three.js for texture ownership/context recovery; transient height fields and worker heap disappear on termination. No texture generation occurs in the animation loop. Worker failure falls back to synchronous generation at the same 256px resolution.\n\n`;
text += `Geometry: ${(geometryBytes / 1024).toFixed(1)} KiB plus batch clones. GPU simulation: 78.1 KiB for 500 slots. Grain: 0.33 MiB including mips, using a single R8 channel (0.25 MiB CPU staging). HDR/depth/bloom targets use roughly 67.33 bytes per internal pixel including scene 4× MSAA, before swap-chain storage and alignment: about 133.2 MiB at 1920×1080/DPR 1, or 407.8 MiB at effective DPR 1.75. Compilation uses the scene pass target, avoiding an additional unused 56 bytes per pixel. Adaptive render scale remains the main control for this variable memory cost.\n\n`;
text += 'See PERFORMANCE_REPORT.md for historical startup measurements and RESOURCE_REPORT.md for current DevTools CPU, memory, and backend verification. Meshopt remains unnecessary because geometry has zero transferred bytes.\n';
leaf.dispose();
await writeFile(new URL('../ASSET_REPORT.md', import.meta.url), text);
console.log(`Payload ${mib(total)} MiB raw / ${mib(gzip)} MiB gzip; foliage ${mib(leaf.textureBytes)} MiB.`);
