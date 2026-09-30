# Phase 8 asset budget

| Built file | Raw KiB | Gzip KiB |
| --- | ---: | ---: |
| BASIS_LICENSE.txt | 11.1 | 3.8 |
| THIRD_PARTY_NOTICES.txt | 4.2 | 1.8 |
| assets/basis_transcoder-VXdx5NbI.wasm | 515.0 | 241.8 |
| assets/basis_transcoder-o4Hde_L7.js | 56.2 | 14.8 |
| assets/index-C2mnHj8Z.css | 1.7 | 0.9 |
| assets/index-CMKXYWCl.js | 971.8 | 275.2 |
| assets/leaves-color-WWFpEjQx.ktx2 | 1296.8 | 1296.9 |
| assets/leaves-normal-DpFDIyKi.ktx2 | 1277.5 | 1277.2 |
| assets/leaves-surface-CIauAMaF.ktx2 | 1366.6 | 1366.8 |
| index.html | 1.0 | 0.6 |

Built payload: **5.37 MiB raw / 4.37 MiB with gzip**. This counts the entire build, including the decoder, rather than just textures. Gzip sizes are estimates; server compression, caching, request headers, and transport overhead differ. KTX2 files already use Zstd.

GPU texture storage: **6.00 MiB** at 16-byte 4×4 blocks (BC7/ASTC/ETC2 RGBA), versus **20.00 MiB** for the previous fifteen RGBA8 512px textures including mips. Actual transcode formats are logged in development. Devices without native compression can use RGBA32: about **24.00 MiB**, larger because of atlas padding. The procedural fallback retains the old 20 MiB path.

Geometry: 16.3 KiB for all fifteen source geometries, about 32.6 KiB including batch clones. GPU simulation buffers: 78.1 KiB for 500 slots (six vec4s plus a mat4 per slot). Grain texture: 1.33 MiB including mips. CPU initialization arrays and browser/driver bookkeeping are excluded.

Post targets remain the largest variable memory cost: one HDR color + depth target and half-resolution bloom bright/blur targets are roughly 19.33 bytes per internal pixel before MSAA, swap-chain storage, driver alignment, and temporary resources. At 1920×1080 and DPR 1 this is about 38.2 MiB; effective DPR 1.75 is about 117.1 MiB. Phase 7 resolution adaptation reduces this quadratically. This is an estimate, not a GPU heap measurement.

Meshopt decision: no GLB geometry is transferred. Tiny leaf meshes are generated at startup and seeded curvature is baked locally. Adding Meshopt and a mesh download would add decoder/network cost to replace zero transferred geometry. Defer Meshopt until scanned or imported GLB assets create a measurable payload.
