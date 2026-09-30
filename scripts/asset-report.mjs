import { readFile, readdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { read } from 'ktx-parse';
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
const manifest = JSON.parse(await readFile(new URL('../src/assets/manifest.json', import.meta.url)));
const { createGeometry } = await sourceModule('leaf');
let geometryBytes = 0;
for (const tier of ['high', 'medium', 'low']) for (let index = 0; index < 5; index++) {
  const geometry = createGeometry(tier, index);
  geometryBytes += Object.values(geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0) + geometry.index.array.byteLength;
  geometry.dispose();
}
let blockBytes = 0;
for (const file of manifest.files) {
  const texture = read(await readFile(new URL(`../src/assets/${file.name}`, import.meta.url)));
  texture.levels.forEach((_, level) => {
    const width = Math.max(1, texture.pixelWidth >> level), height = Math.max(1, texture.pixelHeight >> level);
    blockBytes += Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
  });
}
const total = files.reduce((sum, file) => sum + file.bytes, 0);
const gzip = files.reduce((sum, file) => sum + file.gzipBytes, 0);
const mib = bytes => (bytes / 1024 ** 2).toFixed(2);
let text = '# Phase 8 asset budget\n\n';
text += '| Built file | Raw KiB | Gzip KiB |\n| --- | ---: | ---: |\n';
for (const file of files) text += `| ${file.file} | ${(file.bytes / 1024).toFixed(1)} | ${(file.gzipBytes / 1024).toFixed(1)} |\n`;
text += `\nBuilt payload: **${mib(total)} MiB raw / ${mib(gzip)} MiB with gzip**. This counts the entire build, including the decoder, rather than just textures. Gzip sizes are estimates; server compression, caching, request headers, and transport overhead differ. KTX2 files already use Zstd.\n\n`;
text += `GPU texture storage: **${mib(blockBytes)} MiB** at 16-byte 4×4 blocks (BC7/ASTC/ETC2 RGBA), versus **20.00 MiB** for the previous fifteen RGBA8 512px textures including mips. Actual transcode formats are logged in development. Devices without native compression can use RGBA32: about **24.00 MiB**, larger because of atlas padding. The procedural fallback retains the old 20 MiB path.\n\n`;
text += `Geometry: ${(geometryBytes / 1024).toFixed(1)} KiB for all fifteen source geometries, about ${(geometryBytes * 2 / 1024).toFixed(1)} KiB including batch clones. GPU simulation buffers: ${(500 * 160 / 1024).toFixed(1)} KiB for 500 slots (six vec4s plus a mat4 per slot). Grain texture: 1.33 MiB including mips. CPU initialization arrays and browser/driver bookkeeping are excluded.\n\n`;
text += 'Post targets remain the largest variable memory cost: one HDR color + depth target and half-resolution bloom bright/blur targets are roughly 19.33 bytes per internal pixel before MSAA, swap-chain storage, driver alignment, and temporary resources. At 1920×1080 and DPR 1 this is about 38.2 MiB; effective DPR 1.75 is about 117.1 MiB. Phase 7 resolution adaptation reduces this quadratically. This is an estimate, not a GPU heap measurement.\n\n';
text += 'Meshopt decision: no GLB geometry is transferred. Tiny leaf meshes are generated at startup and seeded curvature is baked locally. Adding Meshopt and a mesh download would add decoder/network cost to replace zero transferred geometry. Defer Meshopt until scanned or imported GLB assets create a measurable payload.\n';
await writeFile(new URL('../ASSET_REPORT.md', import.meta.url), text);
console.log(`Payload ${mib(total)} MiB raw / ${mib(gzip)} MiB gzip; foliage ${mib(blockBytes)} MiB GPU block storage. Wrote ASSET_REPORT.md.`);
