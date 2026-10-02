# Asset budget after startup optimization

| Built file | Raw KiB | Gzip KiB |
| --- | ---: | ---: |
| THIRD_PARTY_NOTICES.txt | 1.1 | 0.7 |
| assets/SurfaceWorker-DiehqeXh.js | 2.5 | 1.3 |
| assets/index-BNrwY_Ri.js | 912.4 | 251.3 |
| assets/index-PD678Tgb.css | 1.7 | 0.9 |
| index.html | 1.0 | 0.6 |

Entire build: **0.90 MiB raw / 0.25 MiB gzip estimate**. No KTX2, Basis decoder, WASM, or image files ship. Gzip estimates depend on server configuration and exclude request overhead.

Foliage texture storage: **5.00 MiB** for fifteen 256px RGBA8 maps including full mip chains, shared by depth tiers. The five color families, normal maps, packed thickness/roughness, and cutout silhouettes remain. Previous KTX2 atlas: 6 MiB with native 4×4 block compression, or about 24 MiB when transcoded to RGBA32. Previous 512px procedural version: 20 MiB. These are allocation-size estimates, not driver GPU heap measurements.

One 2.6 KiB worker generates surfaces once. Pixel buffers transfer without copies, and the worker terminates immediately. CPU staging pixels occupy 3.75 MiB retained by Three.js for texture ownership/context recovery; transient height fields and worker heap disappear on termination. No texture generation occurs in the animation loop. Worker failure falls back to synchronous generation at the same 256px resolution.

Geometry: 16.3 KiB plus batch clones. GPU simulation: 78.1 KiB for 500 slots. Grain: 0.33 MiB including mips, using a single R8 channel (0.25 MiB CPU staging). HDR/depth/bloom targets use roughly 67.33 bytes per internal pixel including scene 4× MSAA, before swap-chain storage and alignment: about 133.2 MiB at 1920×1080/DPR 1, or 407.8 MiB at effective DPR 1.75. Compilation uses the scene pass target, avoiding an additional unused 56 bytes per pixel. Adaptive render scale remains the main control for this variable memory cost.

See PERFORMANCE_REPORT.md for historical startup measurements and RESOURCE_REPORT.md for current DevTools CPU, memory, and backend verification. Meshopt remains unnecessary because geometry has zero transferred bytes.
