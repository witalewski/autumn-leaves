# Startup optimization — DevTools comparison

Measured 2026-10-01 with Chrome 154.0.8037.93 on the local desktop, production phase 9 builds, default 32 visible leaves, seed 2409, WebGPU. The baseline used the phase 8 KTX2 atlases; the candidate uses five procedural 256px surface sets generated once in a worker. Both include the same motion/post polish and readiness instrumentation.

| Median of three runs | KTX2 | Worker surfaces |
| --- | ---: | ---: |
| Desktop scene initialization | 615 ms | 550 ms |
| Throttled scene initialization | 30,591 ms | 7,058 ms |
| Resource transfer, raw HTTP | 5,620,323 B | 936,811 B |
| Desktop texture stage | 156 ms | 169 ms |
| Throttled texture stage | 23,454 ms | 317 ms |
| Desktop mean frame interval | 16.67 ms | 16.67 ms |
| Throttled mean frame interval | 16.67 ms | 16.67 ms |
| Estimated foliage GPU texture storage | 6 MiB native block compression | 5 MiB RGBA8 |

The candidate reduces requested bytes by **83%**, throttled initialization by **77%**, and foliage texture allocation by **17%** relative to native KTX2. There is no demonstrated steady-state FPS improvement. Texture generation/upload is slightly slower than cached local KTX2 loading on desktop; the decisive gain is eliminating the multi-megabyte artwork and decoder download. The original 512px procedural maps needed 20 MiB; lowering their resolution avoids that memory regression.

## Protocol and raw evidence

[scripts/profile.mjs](./scripts/profile.mjs) drives a separate headless Chrome profile through the Chrome DevTools Protocol. Network cache is disabled for every fresh page. Each build/profile gets three navigations in one browser process. Desktop viewport: 1280×720, DPR 1, no throttling. Throttled viewport: 390×844, DPR 2 (application cap 1.75), 200,000 B/s download (1.6 Mbps), 150 ms latency, and 4× main-page CPU slowdown. Both snapshots use the same Python HTTP server, without gzip or Brotli.

Scene initialization measures navigation start through renderer initialization, surface loading/generation, shader compilation, and submission of the first post-processed render, when the loading fallback is hidden. It does not measure GPU presentation completion. Caption LCP alone would miss scene readiness. Texture stage includes download/transcode or worker generation, texture construction, and leaf construction; it excludes later shader compilation.

After readiness, allow three seconds of warmup and sample 180 requestAnimationFrame callbacks. Main-thread long tasks are observed from page startup through sampling. Raw requests, initialization, texture-stage durations, long tasks, frame intervals, and page errors are retained in [benchmarks](./benchmarks/): baseline-desktop.json, baseline-slow.json, candidate-desktop.json, candidate-slow.json. All twelve runs used WebGPU and had no page errors. Resource Timing totals include subresources and request overhead, excluding the main HTML document.

Readiness samples (ms):

- KTX2 desktop: 2524, 493, 615. Candidate desktop: 879, 488, 550.
- KTX2 throttled: 30628, 30591, 30401. Candidate throttled: 7058, 6994, 7068.

The first desktop KTX2 run has a shader/driver initialization outlier. Fresh network cache does not reset operating-system or GPU shader caches. Report medians, not the first-run difference as a reliable desktop speedup. The largest throttled long task remains about 650–700 ms for both versions: moving artwork generation off the main thread does not remove renderer/shader initialization work.

## Reproduction

Install Lighthouse 13.5.0 in a separate temporary tools directory (its Puppeteer Core dependency was 25.12.0). This keeps profiling dependencies out of the application. The script currently targets the standard macOS Chrome installation.

```sh
npm install --prefix /private/tmp/autumn-tools lighthouse@13.5.0
npm run build
npm run preview -- --host 127.0.0.1 --port 4180
node scripts/profile.mjs /private/tmp/autumn-tools/node_modules http://127.0.0.1:4180/ /private/tmp/desktop.json
node scripts/profile.mjs /private/tmp/autumn-tools/node_modules http://127.0.0.1:4180/ /private/tmp/slow.json slow
```

For matching the recorded comparison, serve isolated build snapshots using an uncompressed static HTTP server. The historical KTX2 snapshot was captured before these optimization edits; retained JSON is the evidence for that build. These are DevTools measurements, not Lighthouse audit scores.

## Balance and limits

The candidate sends about 0.89 MiB of files raw, or 0.25 MiB with gzip estimates (see [ASSET_REPORT.md](./ASSET_REPORT.md)). Actual hosting compression changes absolute loading times: the old build estimated 4.38 MiB gzip, so compression does not erase the payload difference. No downloaded texture/WASM decoder remains. The 2.6 KiB worker transfers fifteen RGBA buffers without copies and terminates. Generation happens only once; the fallback uses the same 256px maps synchronously. CPU staging pixels retain 3.75 MiB for Three.js resource ownership/context recovery. Material tiers, normal maps, packed roughness/thickness, mipmaps, and draw batches are retained. Desktop WebGPU and portrait WebGL2 visual checks show intact cutouts, veins, pigment, and backlighting at the intended framing; extreme close-ups have less texture detail than 512px artwork.

GPU texture sizes are allocation estimates, not measured driver heap usage. The baseline's 6 MiB assumes native ASTC/BC7-class blocks; uncompressed transcoding can require about 24 MiB. HDR/depth/bloom targets remain the largest resolution-dependent memory expense. Adaptive quality retains control of that expense and pixel shading; existing compute simulation/LOD still reduce per-frame work.

Frame cadence is a CPU/presentation observation, not GPU execution time, and the desktop test is vsync limited. DevTools CPU throttling does not reproduce a mobile GPU, worker CPU throttling, or thermal behavior. Physical mobile testing remains unverified; these measurements establish the download/startup improvement under controlled local conditions.
