# Asset budget after startup optimization

| Built file | Raw KiB | Gzip KiB |
| --- | ---: | ---: |
| THIRD_PARTY_NOTICES.txt | 1.1 | 0.7 |
| assets/SurfaceWorker-DiehqeXh.js | 2.5 | 1.3 |
| assets/index-Be_ubZiQ.js | 909.8 | 250.4 |
| assets/index-C2mnHj8Z.css | 1.7 | 0.9 |
| index.html | 1.0 | 0.6 |

Entire build: **0.89 MiB raw / 0.25 MiB gzip estimate**. No KTX2, Basis decoder, WASM, or image files ship. Gzip estimates depend on server configuration and exclude request overhead.

Foliage texture storage: **5.00 MiB** for fifteen 256px RGBA8 maps including full mip chains, shared by depth tiers. The five color families, normal maps, packed thickness/roughness, and cutout silhouettes remain. Previous KTX2 atlas: 6 MiB with native 4×4 block compression, or about 24 MiB when transcoded to RGBA32. Previous 512px procedural version: 20 MiB. These are allocation-size estimates, not driver GPU heap measurements.

One 2.6 KiB worker generates surfaces once. Pixel buffers transfer without copies, and the worker terminates immediately. CPU staging pixels occupy 3.75 MiB retained by Three.js for texture ownership/context recovery; transient height fields and worker heap disappear on termination. No texture generation occurs in the animation loop. Worker failure falls back to synchronous generation at the same 256px resolution.

Geometry: 16.3 KiB plus batch clones. GPU simulation: 78.1 KiB for 500 slots. Grain: 1.33 MiB including mips. HDR/depth/bloom targets remain roughly 19.33 bytes per internal pixel before MSAA, swap-chain storage and alignment: about 38.2 MiB at 1920×1080/DPR 1, or 117.1 MiB at effective DPR 1.75. Adaptive render scale remains the main control for this variable memory cost.

See PERFORMANCE_REPORT.md for measured DevTools loading times and frame intervals. Meshopt remains unnecessary because geometry has zero transferred bytes.
