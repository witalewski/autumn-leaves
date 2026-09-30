import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { encodeToKTX2 } from 'ktx2-encoder';
import { sourceModule } from './modules.mjs';
const { createTextures } = await sourceModule('leaf');
const { atlasLayout } = await sourceModule('foliage/AtlasLayout');
const { width, height, cell, gutter, columns, variants } = atlasLayout;
const surfaces = Array.from({ length: variants }, (_, index) => createTextures(index));
const output = new URL('../src/assets/', import.meta.url);
await mkdir(output, { recursive: true });
const files = [];
for (const kind of ['color', 'normal', 'surface']) {
  const data = new Uint8Array(width * height * 4);
  for (let variant = 0; variant < variants; variant++) {
    const source = surfaces[variant][kind].image.data;
    for (let y = 0; y < cell; y++) {
      const v = Math.max(0, Math.min(1, (y - gutter) / (cell - gutter * 2 - 1)));
      const sy = Math.round(v * (cell - 1));
      for (let x = 0; x < cell; x++) {
        const u = Math.max(0, Math.min(1, (x - gutter) / (cell - gutter * 2 - 1)));
        const sx = Math.round(u * (cell - 1));
        const target = ((Math.floor(variant / columns) * cell + y) * width + variant % columns * cell + x) * 4;
        data.set(source.subarray((sy * cell + sx) * 4, (sy * cell + sx) * 4 + 4), target);
      }
    }
  }
  // Keep the spare cell benign; opaque data maps prevent needless alpha channels.
  if (kind !== 'color') for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const encoded = await encodeToKTX2(data, {
    imageDecoder: async bytes => ({ data: bytes, width, height }),
    isUASTC: true, needSupercompression: true, uastcLDRQualityLevel: 2,
    generateMipmap: true, isPerceptual: kind === 'color',
    isSetKTX2SRGBTransferFunc: kind === 'color', isNormalMap: kind === 'normal',
  });
  const name = `leaves-${kind}.ktx2`;
  await writeFile(new URL(name, output), encoded);
  files.push({ name, bytes: encoded.length, sha256: createHash('sha256').update(encoded).digest('hex') });
  console.log(`${name}: ${(encoded.length / 1024).toFixed(1)} KiB`);
}
surfaces.forEach(surface => Object.values(surface).forEach(map => map.dispose()));
await writeFile(new URL('manifest.json', output), JSON.stringify({ layout: atlasLayout, codec: 'UASTC + Zstd', files }, null, 2) + '\n');
