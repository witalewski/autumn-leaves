# Autumn — a study of motion

Phases 1–9 of `specs.md`: a cinematic sky with GPU-simulated leaves arranged in foreground, midground, and background populations. Production starts at 32 visible leaves on both backends and adapts down to 20 under sustained load. Development uses 500 leaves on WebGPU and 100 on WebGL2. Geometry/material LOD and atmospheric haze give distant leaves a lower rendering cost and clearer depth separation.

## Run

Use Node 20.19+ or 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite (normally http://127.0.0.1:5173).

```sh
npm test          # Simulation, composition, LOD, and resource regression tests
npm run check     # TypeScript
npm run build     # TypeScript + production bundle
npm run preview   # Serve the built application
```

## GitHub Pages

The workflow in `.github/workflows/deploy.yml` installs the locked dependencies, type-checks, builds, and deploys `dist` on every push to `main`. It can also be run manually from the Actions tab. A failed build prevents deployment. Deployments are serialized, and only the deployment job receives Pages/OIDC write permissions.

The site URL is **https://witalewski.github.io/autumn-leaves/**. The repository's **Settings → Pages → Build and deployment → Source** must be set to **GitHub Actions** (a one-time repository setting).

`vite.config.ts` sets `base: './'`, so built JavaScript, CSS, and imported assets use relative URLs. The same `dist` works at the site root on localhost and under `/autumn-leaves/` on Pages; local development/debugging still uses `npm run dev` at `/`. Use the trailing slash in the Pages URL so document-relative URLs resolve inside the project directory.

For future textures, models, or other static assets:

- Prefer Vite imports, e.g. `import leafUrl from './assets/leaf.ktx2?url'`, or a statically analyzable `new URL('./assets/leaf.ktx2', import.meta.url).href`. Pass that URL to the Three.js loader.
- For files deliberately placed in `public/`, use `import.meta.env.BASE_URL + 'textures/leaf.ktx2'` in TypeScript, or `%BASE_URL%textures/leaf.ktx2` in HTML.
- Avoid origin-root URLs such as `/textures/leaf.ktx2`, which would omit the repository path on Pages. The surface worker is bundled through Vite; there are no remote CDN dependencies or mesh downloads.

This follows [Vite's relative-base support](https://vite.dev/guide/build#relative-base). If client-side routes are introduced later, revisit the base/routing strategy; this prototype has a single page and no router.

## Inspect the motion

- Space or a canvas tap/click pauses/resumes the simulation. The hint reads “Tap” for a coarse primary pointer (touch devices) and “Space” for desktop pointers; both inputs always work.
- Swipe or drag across the canvas to stir a temporary gust. Faster motion adds stronger wind; longer strokes linger longer. Curves and circles steer the wind as the pointer turns. Gusts ease back into the ambient breeze without trails, markers, or additional interface cues. Drags do not toggle pause. Reduced motion softens the response, and paused scenes ignore gusts.
- The development panel exposes motion, lighting, and material controls. **Depth composition** adds per-population visibility/counts, world-space depth and scale ranges, plus haze start/falloff/strength. Finishing a depth/scale edit restarts the same seed; count and visibility edits do not. Counts are limited by each fixed pool and the global leaf-count limit. Reducing the global count retains a mixture of depth groups.
- **Restart same seed** restores the initial population without changing controls. **Reset study** restores default controls and restarts. **Export parameters** downloads the current configuration as JSON.
- The default seed is 2409. Append `?seed=42` for another repeatable population. Repeatability assumes the same viewport, controls, and simulation time.
- Compare high/low drag for broadside braking, lift for gliding, tumble/flutter for orientation changes, and angular damping for calmer intervals. Gusts affect both translation and aerodynamic torque through relative airflow.
- The development overlay reports the backend, FPS, mean frame interval, visible instance counts per population, total draw/triangle counts, render scale, and DPR. These are CPU frame intervals, not GPU timings. Controls and statistics are omitted from production builds.

## Implementation

- `main.ts`: scene, lighting, camera drift, input, sizing, and lifecycle.
- `interaction/GestureWind.ts`: captured touch/mouse/pen drags, tap discrimination, viewport-relative speed and stroke length, smooth direction tracking, and bounded gust decay. One shared vector feeds both simulation backends without particle uploads or readbacks.
- `LeafSystem.ts`: fifteen population/palette batches, stable instance-slot mapping, seeded scales, backend selection, timing, and resource ownership.
- `simulation/GpuMotion.ts`: TSL compute kernel updating GPU-resident position, velocity, quaternion, angular velocity, and instance-matrix buffers. Mass, drag, lift, flutter phase/frequency, and visual scale live in storage buffers too.
- `simulation/MotionSimulation.ts`: seeded fixed-size state pool, spatial/time-varying wind, and CPU integration at 120 Hz. Gravity, orientation-dependent drag, perpendicular lift, aerodynamic alignment, asymmetric tumble, flutter, and angular damping drive velocity and quaternion orientation. Parameters vary per leaf. Scratch vectors are reused.
- `renderer.ts`: WebGPURenderer initialization, backend detection, and filmic tone mapping.
- `sky.ts`: TSL gradient, atmospheric sun glow, sun disc, and procedural cloud wisps. The scene seed selects a repeatable cloud pattern, including URL and debug seed changes. Wind slowly advects the cloud field while three noise layers evolve independently to reshape the wisps over time. Pause freezes clouds, reduced motion slows them to 8%, and restarting resets their clock.
- `leaf.ts`: three geometry tiers, five leaf forms, and five patterned autumn surfaces per material tier. Foreground uses normal/roughness maps and full backlighting; midground omits the normal map; background also omits the packed surface map and uses a simpler transmission term. All tiers share textures, alpha cutouts, and double-sided lighting.
- `simulation/DepthComposition.ts`: population settings and perspective-aware depth bounds.
- `scene/Atmosphere.ts`: depth-dependent exponential haze matching the sky gradient, applied in linear color space before tone mapping without an extra render pass.
- `debug.ts`: development controls and statistics.
- `style.css`: canvas and captions.

On WebGPU, CPU work per frame consists of advancing fixed-step time and submitting fifteen compute kernels per substep. There are no per-leaf CPU updates, transform uploads, or readbacks in that path. CPU initialization/uploads happen only at startup or explicit reset/seed changes. Matrices generated by compute feed Three.js instancing directly, including normal transformations for nonuniform scale and normal mapping. The fixed 500-slot GPU pool stays simulated when the visible count is reduced. WebGL2 uses the CPU reference at a smaller capacity and updates instance matrices.

Leaves recycle above or upstream of the frame at their own depth. Each leaf keeps its population, palette, and visual scale across recycling. A population-specific spring and depth-boundary guard retain the assigned band without respawning leaves visibly along Z. CPU/GPU integration uses the same depth rules, while respawn random sequences intentionally differ. Velocity/torque limits keep exploratory control settings stable. This is an intentionally approximate visual model, not a calibrated fluid simulation.

Five procedural surface sets are generated once at 256×256 in a small worker and shared across depth tiers. Each contains albedo/alpha, normals, and packed thickness/roughness, with its own pigment pattern: golden mottling, asymmetric red-and-amber mottling, burnt edges, asymmetric russet patches, or green remnants. Patch contrast is compressed to 20% of its original range around each palette’s characteristic hue. Veins, freckles, and fine surface noise vary too. Albedo uses sRGB; data maps remain linear. Full mip chains take approximately 5 MiB of GPU texture storage. These remain procedural **placeholder assets**, not scanned foliage. Worker failure falls back to synchronous generation at the same resolution.

The five forms range from an open oval to a gently cupped blade, softly arched narrow leaf, almost-flat blade, and wavy broadleaf. Geometry warps the shared UV silhouette so veins, pigment, and cutout edges follow each bend. The seed adds repeatable bend/twist variation per population/form batch (restrained for the almost-flat form), alongside the existing per-instance size/proportion variation. Geometry and normals are baked only at startup or explicit reset, remain stable during recycling, and retain the same triangle counts and 15-batch rendering budget. Surface patterns remain distinct; seeded per-population form permutations pair those colors with different silhouettes while keeping all five forms in each depth group. All forms use restrained cupping, tip curl, and twist; seeded variation is limited to avoid folded or crumpled silhouettes.

The renderer prefers WebGPU and lets Three.js fall back to WebGL2 with the same node materials. Append `?backend=webgl` to exercise WebGL2 explicitly. In development, `?backend=none` exercises the static CSS sky and unsupported-renderer message. Initialization, rendering, and device-loss errors also reveal that fallback. Reload to retry after device loss.

Effective DPR is capped at 1.75, with a separate render-scale control. The single animation loop stops while hidden and clamps elapsed time on resume. Reduced motion runs simulation time at 8% speed, slowing movement, rotation, gusts, and flutter together; the camera stays fixed. HMR cleans up resources, controls, listeners, and the frame loop.

## Phase 5 composition

| Population | WebGPU / WebGL2 capacity | World Z range | Base scale | Triangles per leaf |
| --- | --- | --- | --- | --- |
| Foreground | 50 / 10 | 4 to 10 | 0.28–0.42 | 44 |
| Midground | 200 / 40 | -6 to 4 | 0.23–0.39 | 28 |
| Background | 250 / 50 | -35 to -6 | 0.20–0.34 | 20 |

The composed camera looks along -Z and adds only subtle lateral drift. Population bounds derive from camera position, FOV, aspect, zoom, and clipping planes; spawn/recycle extents follow the frustum at each leaf's Z. Bounds update on resize without resetting motion. Offscreen margins accommodate leaf size. LOD is fixed by population to avoid switching artifacts, and seeded proportion/curvature variation still applies within each scale range.

All fifteen foliage batches are conservatively drawn because GPU transforms have no CPU bounding sphere. Full WebGPU foliage costs 12,800 triangles versus 22,000 with the former geometry at 500 leaves (about 42% fewer). Foliage uses fifteen draw batches. WebGL2 uses the same composition proportions with a smaller CPU pool and 2,560 foliage triangles.

The default mix is 10% foreground, 40% midground, and 50% background. Production shows 32 leaves distributed as 3 foreground, 13 midground, and 16 background; the fixed backend pool capacities remain unchanged. The development controls can reduce visible counts without rebuilding pools. Scanned foliage assets and final artistic tuning remain later work.

## Phase 6 cinematic post

`scene/CinematicPost.ts` renders the scene into an HDR target, extracts bloom at half resolution with a mip blur chain, and combines a procedural lens flare, ACES tone mapping, grading, vignette, and grain in one final pass. Tone mapping and output color conversion each happen once. Render targets follow the drawing-buffer size, including DPR and render-scale changes, and are disposed with the scene.

A subtle 0.6 CSS-pixel soft-focus filter smooths scene detail before grain is added. Its normalized nine-tap kernel shares the final composite pass, with no extra render target. **Soft focus (px)** adjusts the radius; zero restores a sharp scene.

The **Cinematic post** development folder offers a before/after toggle, bloom threshold/radius/strength, flare intensity, contrast, saturation, temperature, tint, highlight warmth, shadow coolness, black level, vignette, and grain. Exposure remains in **Renderer**. Reset/export include all post settings. The defaults use restrained bloom and warm highlights with slightly cool shadows.

Flare follows the projected directional sun, fades at the screen edge, and disappears behind the camera. Five depth samples across the source suppress flare under leaf occlusion; this is an inexpensive approximation, not volumetric cloud occlusion. Monochrome grain uses a small, seeded noise texture generated once with an integer PRNG. Randomly positioned, overlapping grains with varied radii create fine speckles and irregular clumps. Two filtered layers mix fine detail with weaker coarse texture, using a stable CSS-pixel scale across DPR/render-scale changes. The default strength is 0.006 in development and production, aiming for the character of a scanned 35mm–16mm reference. Independent texture offsets refresh at 24 Hz without scrolling. Grain is applied in display space after color conversion, with reduced intensity in extreme highlights and shadows. Pausing freezes grain as well as leaves; reduced motion keeps grain static. The comparison toggle bypasses all post effects while retaining the original renderer's ACES exposure.

## Phase 7 adaptive quality

Both backends start at **High** and measure actual animation-frame intervals, independently of the clamped simulation delta. `quality/PerformanceMonitor.ts` keeps a bounded rolling window of roughly two seconds without frame-loop allocations. `quality/QualityController.ts` waits three seconds at startup/resume, then lowers quality after three sustained seconds above 130% of the target frame budget. Recovery needs twelve seconds below 105% of the budget. Each change has an eight-second cooldown and clears old samples. An isolated stall does not trigger a downgrade; intervals over one second reset monitoring as suspension gaps. Hidden-page transitions clear the history. Paused/reduced-motion rendering still measures actual rendering performance.

| Preset | Render scale | DPR cap | Development leaves (GPU / GL2) | Production leaves |
| --- | --- | --- | --- | --- |
| High | 1.0 | 1.75 | 500 / 100 | 32 |
| Medium | 0.8 | 1.5 | 350 / 70 | 22 |
| Low | 0.65 | 1.25 | 200 / 40 | 20 |

Effective pixel ratio is `min(devicePixelRatio, dprCap) * renderScale`. Presets retain the established composition and material tiers; visible counts change within the existing fixed pools without resetting positions, seed, or clocks. The foreground/midground/background mix remains proportional. The GPU pool continues simulating all slots so restored leaves retain coherent motion; adaptation reduces draw work and pixel cost, not GPU compute capacity. CPU simulation already steps only the active prefix. Bloom and the HDR scene target follow the reduced drawing-buffer resolution automatically; grain stays enabled and keeps its CSS-pixel size.

The development **Renderer** folder offers Auto/High/Medium/Low and a 30/60 FPS target (default 60). Fixed presets stop adaptation. Editing leaf count, render scale, or DPR switches to fixed mode so automatic changes do not overwrite manual tuning. Select Auto to resume monitoring at the current level. Reset restores High/Auto and the original scene budget. The overlay reports active quality, target, rolling frame time, and controller status. These are CPU frame intervals including presentation waits, not GPU timings; a stable 30 Hz display may select Low at the default 60 FPS target. The 30 FPS option supports profiling that cadence without device-type assumptions.

For an end-to-end load check, open `/tests/quality.html` (or append `?backend=webgl`) in the development server. **Add 40 ms frame load** introduces intentional CPU pressure into the real scene. Auto should move High → Medium → Low over roughly 17 seconds. Stop the load and allow roughly 30 seconds for full recovery on a 60 Hz display. This harness is excluded from production. Unit tests cover 30/60 FPS traces, rolling-window expiry, cooldown, asymmetric recovery, isolated stalls, jitter, fixed mode, suspension, and production count limits.

Local browser checks cover desktop WebGPU, portrait WebGL2, fixed presets, and automatic transitions under synthetic load. These checks do not establish sustained performance or thermal behavior on a physical mid-range smartphone. For device profiling, run the production scene on physical desktop/mobile hardware, watch the development overlay if available, and verify stable frame times after several minutes, resizing/orientation changes, hide/resume, and reduced motion.

## Phase 8 asset optimization, revisited

DevTools profiling showed that the KTX2 atlas increased cold startup without improving the measured frame cadence. It has been replaced by five 256px procedural surface sets. foliage/ProceduralSurfaces.ts contains the artwork generator; foliage/SurfaceWorker.ts generates the fifteen maps once without importing Three.js. foliage/SurfaceAssets.ts transfers their buffers without copies, terminates the worker, and creates shared textures. Generation does not run during animation. There are no texture downloads, Basis decoder, WASM, or encoder dependency.

Foreground retains normal mapping and full backlighting; distant tiers skip expensive map samples. All tiers share the five surface sets. Alpha clipping, seeded form/pigment pairings, mipmaps, and the fifteen-batch draw budget remain intact. Worker initialization/error/timeout falls back to synchronous generation at the same 256px resolution. In development, ?assets=sync exercises that path. The #app diagnostics identify the selected path and estimated texture allocation.

Run npm run build, then npm run assets:report to regenerate ASSET_REPORT.md.

Tests check deterministic, distinct surface data, alpha/normal ranges, texture color spaces, sharing, allocation size, disposal, and worker cleanup on success/failure. Local visual checks cover WebGPU and portrait WebGL2.

The complete build is about **0.89 MiB raw / 0.25 MiB gzip**, and foliage GPU texture storage is **5 MiB**, compared with 6 MiB on the tested native KTX2 compression path and 20 MiB for the original 512px procedural maps. CPU staging pixels retain 3.75 MiB for texture ownership/context recovery. HDR/bloom targets remain the largest variable memory cost; phase 7’s resolution controls reduce that cost quadratically. See [ASSET_REPORT.md](./ASSET_REPORT.md) for allocation estimates and [PERFORMANCE_REPORT.md](./PERFORMANCE_REPORT.md) for measurements and limitations.

Meshopt remains deferred: source leaf geometry totals about 16.3 KiB and is generated locally, with zero geometry download. A mesh decoder and GLB would increase the transferred payload here. Add Meshopt when imported/scanned GLB assets justify it.

## Phase 9 polish

The default wind is calmer: speed 1.35, gust strength 1.3, turbulence 0.45, tumble 0.75, flutter 0.38, and angular damping 1.75. Two overlapping slow gust fronts replace the single obvious gust rhythm. CPU and GPU implementations use the same equations. Aerodynamic drag, lift, and shared spatial turbulence still drive translation and rotation; the settings remain editable in development.

`scene/CameraController.ts` adds slow translation of at most 0.10 units horizontally and 0.09 vertically, without rotating the camera. It shares pause/reset/visibility timing with the scene and stays fixed under reduced motion. Resize computes the original base framing before adding drift. Existing offscreen spawn margins conservatively contain this small camera movement, so no per-frame volume rebuilding or allocation is needed.

Foreground leaves occasionally approach the camera through a smooth depth-spring target. Each leaf's phase and mass determine its own approach timing (roughly a 35–40 second cycle); overlapping phases avoid a shared choreographed sweep. Only foreground depth targets change, and every leaf stays in its established band. Recycling starts beyond the top/upstream edge with up to 0.7 units of extra, seeded margin, varying entry timing without introducing hidden allocations, depth teleports, or immediate recycle loops. CPU/GPU recycling RNG still intentionally differs.

Shape/color pairings vary by seed and depth population. Every population retains all five forms, while different pigments can appear on different silhouettes. Form variation is baked on restart and uses the existing fifteen batches, shared surfaces, and GPU pool. Seed reset reproduces shapes, motion, and camera drift.

Color grading uses more neutral warmth (temperature 0.012, highlight warmth 0.025, shadow coolness 0.018), slightly restrained saturation (0.94), and contrast 1.055. Sunlight is 3.0 with a softer warm tint. Bloom strength is 0.13 and flare 0.045, reducing conspicuous glow/ghosts. Grain retains the established 0.006 strength and 24 Hz cadence; its pause/reduced-motion and DPR behavior were rechecked on both backends. Sun projection reuses scratch vectors instead of allocating them each frame.

Local verification covers the production scene, portrait WebGL2, pause/resume, the GPU regression harness, and post-processing harnesses on both backends. All GPU checks passed; the 120-step CPU/GPU matrix comparison stayed below 0.00008 maximum error, and all depth populations retained finite state under extreme controls and portrait resize. Unit tests cover camera bounds/cadence/reduced motion, seeded shape permutations, smooth independent foreground approaches, and delayed offscreen entries. Physical mobile/thermal performance and the realism of final scanned assets remain outside this local verification. The current foliage is still procedural artwork.

## Verification

`npm test` also checks population capacity/assignment, frustum projection at landscape/portrait aspect ratios and zoom, clipping, seeded depth replay, offscreen recycling in both wind directions, finite depth state through two simulated minutes of extreme controls, geometry LOD, distinct seeded forms with recomputed normals, shared per-tier surface textures, real CPU batch transforms/count controls, resize/pause behavior, and geometry/material disposal.

`npm test` checks seeded replay, render-cadence independence, pause/resume timing, reduced motion, recycling without replacing pool objects, finite state and unit quaternions over two simulated minutes at extreme controls, gravity/drag/damping response, and wind continuity. `npm run build` performs strict TypeScript checking and builds the production bundle.

For GPU integration checks, run the dev server and open `/tests/gpu.html` in a WebGPU browser. This development-only harness compares 500 initial matrices and 120 integration steps against the CPU reference, checks reset replay and recycling, and exercises extreme controls for five simulated seconds. It also checks all three depth populations against the CPU reference, verifies offscreen recycling into the correct depth band, and stresses each GPU population after a portrait resize. Readback exists only in that test. The test page is not included in the production build. GPU and CPU respawn random sequences intentionally differ, and different GPUs are not guaranteed bit-identical floating-point results.

The phase 5 scene has been checked locally in WebGPU and forced WebGL2, including a portrait viewport. Both rendered around 60 FPS in the local browser with no shader warnings/errors; these are CPU frame intervals, not GPU timings. The GPU regression harness passed all depth checks (maximum CPU/GPU position difference below 0.00003 over 120 steps for non-recycled depth leaves). These checks do not establish performance on physical mobile devices; representative-device profiling still requires physical mobile hardware.

The development-only `/tests/post.html` harness checks actual rendered grain strength, animation, pause, and reduced motion at DPR 1 and 1.75; append `?webgl` for WebGL2. It displays maximum-strength samples.
