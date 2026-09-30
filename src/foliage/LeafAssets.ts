import { LoadingManager, LinearMipmapLinearFilter, NoColorSpace, SRGBColorSpace, type WebGPURenderer } from 'three/webgpu';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import colorURL from '../assets/leaves-color.ktx2?url';
import normalURL from '../assets/leaves-normal.ktx2?url';
import surfaceURL from '../assets/leaves-surface.ktx2?url';
import transcoderJS from 'three/examples/jsm/libs/basis/basis_transcoder.js?url';
import transcoderWASM from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url';
import type { LeafAtlas } from '../leaf';

/** Load once before material creation; assets and the worker decoder stay same-origin. */
export async function loadLeafAtlas(renderer: WebGPURenderer): Promise<LeafAtlas> {
  const manager = new LoadingManager();
  // Vite fingerprints the two files independently, so a common directory path
  // alone cannot resolve them. The URL modifier supplies their imported URLs.
  manager.setURLModifier(url => url.endsWith('basis_transcoder.js') ? transcoderJS
    : url.endsWith('basis_transcoder.wasm') ? transcoderWASM : url);
  const loader = new KTX2Loader(manager).setTranscoderPath('basis/').setWorkerLimit(1).detectSupport(renderer);
  try {
    const results = await Promise.allSettled([colorURL, normalURL, surfaceURL].map(url => loader.loadAsync(url)));
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') {
      results.forEach(result => { if (result.status === 'fulfilled') result.value.dispose(); });
      throw failure.reason;
    }
    const textures = results.map(result => {
      if (result.status !== 'fulfilled') throw new Error('Missing foliage atlas');
      return result.value;
    });
    textures.forEach(map => { map.minFilter = LinearMipmapLinearFilter; map.anisotropy = 4; });
    textures[0].colorSpace = SRGBColorSpace;
    textures[1].colorSpace = textures[2].colorSpace = NoColorSpace;
    return { color: textures[0], normal: textures[1], surface: textures[2] };
  } finally {
    loader.dispose();
  }
}
