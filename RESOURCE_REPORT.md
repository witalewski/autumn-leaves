# Runtime resource optimization — Chrome DevTools verification

Measured 2026-10-01 in Chrome 154.0.8037.93 on the local desktop. Baseline: commit `664bf7e`, built before these edits. Candidate: the optimized production build, with the same seed (2409), 32 leaves, High quality, 4× scene MSAA, material tiers, textures, resolution, clouds, bloom, flare, focus and grain.

## Results

Desktop viewport is 1280×720, DPR 1. Each backend/build has three fresh, cache-disabled navigations. After three seconds of warmup, DevTools `Performance.getMetrics` deltas cover 180 animation frames, approximately three seconds. Running and paused phases are measured separately. Values below are medians.

| Measurement | Baseline | Candidate |
| --- | ---: | ---: |
| WebGPU requested texture allocation, estimated from captured descriptors | 114.73 MiB | 64.51 MiB |
| WebGPU main-thread task time, animated | 414 ms | 394 ms |
| WebGPU main-thread task time, paused | 386 ms | 57 ms |
| WebGL2 main-thread task time, animated | 374 ms | 172 ms |
| WebGL2 main-thread task time, paused | 347 ms | 43 ms |
| WebGPU queue submissions over paused sample | 2,520 | 0 |
| Mean presentation interval, both backends | 16.67 ms | 16.67 ms |
| Production JavaScript, raw | 934,393 B | 934,325 B |
| Production JavaScript, Node zlib gzip | 257,351 B | 257,344 B |

Requested WebGPU texture storage decreases about **44%**. Measured animated WebGL2 task time decreases about **54%**, and paused task time decreases **85% on WebGPU / 88% on WebGL2**. The remaining paused time includes the profiling harness's own rAF sampling and browser work; the application schedules no recurring scene frames. Paused script time falls from 289 to 9 ms on WebGPU and 284 to 7 ms on WebGL2. Active WebGPU submissions remain unchanged: the compute pool and post effects still run normally while animated.

## What changed

- Precompile the scene against its actual post-processing HDR/MSAA target. Compiling against the canvas previously allocated an unused full-size framebuffer and its multisampled color/depth attachments. Avoiding it saves roughly 49.22 MiB at the tested viewport, without removing scene MSAA or the depth texture used for flare occlusion.
- Store monochrome grain in R8 instead of RGBA8. The same deterministic red-channel samples, mipmaps and filtering produce identical output. CPU staging drops from 1 MiB to 0.25 MiB; GPU texture allocation with mips drops from 1.33 MiB to 0.33 MiB.
- Stop the scene frame loop while paused. Settings, reset, resize, visibility restoration and resume request a redraw. Idle time does not drive automatic quality changes. Hidden scenes continue to stop rendering.
- On WebGL2, upload only each visible instance-matrix prefix. Skip composition and uploads when the fixed-step simulation has not advanced; invalidate that cache on configuration/reset so restored counts and visibility work while paused.
- Remove an unused single-leaf mesh and template transmission graph. Share the warm-light node across the palette materials. This offsets the scheduling/cache code and keeps the bundle slightly smaller.

The seed, geometry, active leaf distribution, 120 Hz physics, camera drift, full GPU simulation pool, artwork and post settings remain unchanged. No application dependency or network request was added.

## Startup comparison

A separate paired DevTools run warms both builds' driver shaders, disables the network cache for every page and alternates build order. Three recorded navigations per backend/build/profile avoid interpreting first-driver-startup outliers as an optimization.

| Median scene readiness | Baseline | Candidate |
| --- | ---: | ---: |
| Desktop WebGPU | 524 ms | 530 ms |
| Desktop WebGL2 | 627 ms | 639 ms |
| Throttled portrait WebGPU | 6,752 ms | 6,750 ms |
| Throttled portrait WebGL2 | 6,658 ms | 6,658 ms |

Desktop differences are 1–2%, with overlapping individual run ranges; throttled differences are below 0.1%. There is no material loading regression demonstrated by this sample. The throttled profile uses 390×844, DPR 2 (application cap 1.75), 4× main-page CPU slowdown, 200,000 B/s download and 150 ms latency. Both builds use uncompressed local HTTP. Scene readiness ends after first render submission, rather than GPU presentation completion.

## Visual and backend checks

Seeded first-frame Chrome screenshots are **pixel-identical** between builds on WebGPU and WebGL2, in landscape (1280×720/DPR 1) and portrait (390×844/DPR 1.75). Animation is held after the initial completed scene render; WebGL's shader compilation callbacks are allowed to complete first. This verifies the grain format and shader setup without differences from advancing scene clocks.

The real `/tests/gpu.html` harness passes initialization, 120-step CPU/GPU agreement (maximum matrix error 0.0000722), reset replay, turning gesture wind, recycling, every depth band, extreme controls and portrait resize. `/tests/post.html` passes on both backends at DPR 1/1.75, including strength, pause, reduced motion and exactly 24 grain updates per second at 60/120/144 FPS.

Application checks pass on both backends: paused scenes execute zero recurring scene frames; paused resize redraws twice then stays idle; resume restores the frame loop; reduced motion and lifecycle freeze/resume work. Static `backend=none` renders the expected fallback. Additional checks cover synchronous assets, paused post comparison toggles, hidden/show behavior, and automatic WebGL2 selection when WebGPU is unavailable.

`npm test`: 41 tests pass. `npm run check`, `npm run build`, and `git diff --check` pass. The existing large-chunk Vite advisory remains. There are no page errors in the backend/harness checks. The first fresh production profile on each build records a harmless missing `/favicon.ico` response; subsequent samples and rendering are error-free.

## Evidence and reproduction

Raw data in `benchmarks/`:

- `resources-baseline.json`, `resources-candidate.json`: DevTools CPU/heap metrics, frame intervals, GPU queue counts and live WebGPU texture descriptors.
- `resources-loading.json`: paired desktop/throttled startup runs.
- `resources-visual.json`: per-channel screenshot differences for all four backend/viewport combinations.
- `resource-backend-checks.json`, `resource-backend-extra.json`: actual rendering harnesses and lifecycle/fallback checks.

The scripts use Playwright solely to launch Chrome and access the Chrome DevTools Protocol. Install browser tooling in a separate temporary directory, outside the app. Serve the preserved baseline and current `dist` with identical local HTTP servers. For example:

```sh
npm install --prefix /private/tmp/autumn-resource-tools playwright
node scripts/profile-resources.mjs /private/tmp/autumn-resource-tools/node_modules http://127.0.0.1:4181/ /private/tmp/resources.json
node scripts/profile-loading.mjs /private/tmp/autumn-resource-tools/node_modules http://127.0.0.1:4180/ http://127.0.0.1:4181/ /private/tmp/loading.json
node scripts/profile-visuals.mjs /private/tmp/autumn-resource-tools/node_modules http://127.0.0.1:4180/ http://127.0.0.1:4181/ /private/tmp/visual
node scripts/check-backends.mjs /private/tmp/autumn-resource-tools/node_modules http://127.0.0.1:5173 /private/tmp/backends.json
node scripts/check-backend-controls.mjs /private/tmp/autumn-resource-tools/node_modules http://127.0.0.1:5173 /private/tmp/controls.json
```

The scripts target the standard macOS Chrome path. The `profile-resources` script accepts a final `slow` argument for throttled portrait sampling. Backend harnesses are served with `npm run dev` and excluded from the production build.

Texture bytes are computed from captured live `GPUDevice.createTexture` descriptors (dimensions, mip levels, format and sample count), assuming four bytes for `depth24plus`. They are allocation estimates, not a driver heap measurement, and exclude swap-chain storage, compression/alignment, buffers and process memory. The baseline's obsolete compile framebuffer is still live and included. JavaScript heap samples are noisy and exclude some backing storage; grain's CPU reduction follows its exact array size. Headless desktop DevTools results do not establish physical mobile/thermal performance or active GPU execution-time savings. Frame cadence is vsync limited. The demonstrated GPU work reduction is the complete removal of recurring paused submissions.
