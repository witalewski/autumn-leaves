import { readFile } from 'node:fs/promises';
import { transformWithOxc } from 'vite';
// Build tools reuse the source of the procedural artwork; no browser renderer.
export async function sourceModuleURL(name) {
  let source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  for (const dependency of ['three/webgpu', 'three/tsl']) source = source.replaceAll(`'${dependency}'`, JSON.stringify(import.meta.resolve(dependency)));
  if (name === 'leaf') source = source.replaceAll("'./foliage/ProceduralSurfaces'", JSON.stringify(await sourceModuleURL('foliage/ProceduralSurfaces')));
  const { code } = await transformWithOxc(source, `${name}.ts`);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}

export async function sourceModule(name) { return import(await sourceModuleURL(name)); }
