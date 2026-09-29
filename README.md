# Autumn — a study of motion

Phases 1–4 of `specs.md`: GPU leaf simulation rendered in five instanced palette batches. Production defaults to 32 visible leaves on both backends, matching the phase 3 demo. Development defaults to 500 GPU-simulated leaves on WebGPU or 100 CPU-simulated leaves on WebGL2 for performance checks. The development count control ranges from 20 to the backend’s capacity.

## Run

Use Node 20.19+ or 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite (normally http://127.0.0.1:5173).

```sh
npm test          # CPU simulation regression tests
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
- Avoid origin-root URLs such as `/textures/leaf.ktx2`, which would omit the repository path on Pages. No external texture/model files are loaded by the current procedural prototype.

This follows [Vite's relative-base support](https://vite.dev/guide/build#relative-base). If client-side routes are introduced later, revisit the base/routing strategy; this prototype has a single page and no router.

## Inspect the motion

- Space or a canvas tap/click pauses/resumes the simulation. The hint reads “Tap” for a coarse primary pointer (touch devices) and “Space” for desktop pointers; both inputs always work.
- The development panel exposes wind direction/speed, gust strength, turbulence, gravity, drag, lift, tumble, flutter, angular damping, and leaf count, alongside the existing lighting/material controls.
- **Restart same seed** restores the initial population without changing controls. **Reset study** restores default controls and restarts. **Export parameters** downloads the current configuration as JSON.
- The default seed is 2409. Append `?seed=42` for another repeatable population. Repeatability assumes the same viewport, controls, and simulation time.
- Compare high/low drag for broadside braking, lift for gliding, tumble/flutter for orientation changes, and angular damping for calmer intervals. Gusts affect both translation and aerodynamic torque through relative airflow.
- The development overlay reports the backend, FPS, mean frame interval, active leaf count, total draw/triangle counts, render scale, and DPR. These are CPU frame intervals, not GPU timings. Controls and statistics are omitted from production builds.

## Implementation

- `main.ts`: scene, lighting, fixed camera, input, sizing, and lifecycle.
- `LeafSystem.ts`: five instanced palette batches, seeded initialization, backend selection, timing, and resource ownership.
- `simulation/GpuMotion.ts`: TSL compute kernel updating GPU-resident position, velocity, quaternion, angular velocity, and instance-matrix buffers. Mass, drag, lift, flutter phase/frequency, and visual scale live in storage buffers too.
- `simulation/MotionSimulation.ts`: seeded fixed-size state pool, spatial/time-varying wind, and CPU integration at 120 Hz. Gravity, orientation-dependent drag, perpendicular lift, aerodynamic alignment, asymmetric tumble, flutter, and angular damping drive velocity and quaternion orientation. Parameters vary per leaf. Scratch vectors are reused.
- `renderer.ts`: WebGPURenderer initialization, backend detection, and filmic tone mapping.
- `sky.ts`: TSL gradient, atmospheric sun glow, sun disc, and procedural cloud wisps.
- `leaf.ts`: shared curved geometry and a five-color double-sided material palette with warm, thickness-modulated backlighting.
- `debug.ts`: development controls and statistics.
- `style.css`: canvas and captions.

On WebGPU, CPU work per frame consists of advancing fixed-step time and submitting five compute kernels per substep. There are no per-leaf CPU updates, transform uploads, or readbacks in that path. CPU initialization/uploads happen only at startup or explicit reset/seed changes. Matrices generated by compute feed Three.js instancing directly, including normal transformations for nonuniform scale and normal mapping. The fixed 500-slot GPU pool stays simulated when the visible count is reduced. WebGL2 uses the CPU reference at a smaller capacity and updates instance matrices.

Leaves recycle above or upstream of the frame. A weak depth-restoring force keeps this prototype in one shallow population. Velocity/torque limits keep exploratory control settings stable. This is an intentionally approximate visual model, not a calibrated fluid simulation.

The 768×768 albedo/alpha, normal, and packed thickness/roughness maps are generated once at startup. They contain a serrated silhouette, branching veins, mottled autumn pigment, and fine surface variation. Albedo uses sRGB; data maps remain linear. The mesh closely follows the silhouette, uses alpha testing/MSAA coverage, and has no alpha blending. These are procedural **placeholder assets**, not scanned foliage. There are no external texture downloads.

The renderer prefers WebGPU and lets Three.js fall back to WebGL2 with the same node materials. Append `?backend=webgl` to exercise WebGL2 explicitly. In development, `?backend=none` exercises the static CSS sky and unsupported-renderer message. Initialization, rendering, and device-loss errors also reveal that fallback. Reload to retry after device loss.

Effective DPR is capped at 1.75, with a separate render-scale control. The single animation loop stops while hidden and clamps elapsed time on resume. Reduced motion runs simulation time at 8% speed, slowing movement, rotation, gusts, and flutter together; the camera stays fixed. HMR cleans up resources, controls, listeners, and the frame loop.

## Scope boundary

Phase 4 adds GPU state/compute and instanced rendering. The phase 3 CPU model remains the reference and fallback. There are no depth populations, LOD, adaptive quality, new post-processing, or asset-pipeline changes. A follow-up adds seeded visual variety: five autumn tints (gold, amber, copper, russet, and olive), different sizes, narrower/broader proportions, and varying curvature. The palette shares the existing texture maps; these are variations of the same leaf silhouette, not new botanical species. Appearance stays stable during flight and recycling, and changing the seed regenerates it without altering the motion random sequence. The existing sky/materials are retained.

## Verification

`npm test` checks seeded replay, render-cadence independence, pause/resume timing, reduced motion, recycling without replacing pool objects, finite state and unit quaternions over two simulated minutes at extreme controls, gravity/drag/damping response, and wind continuity. `npm run build` performs strict TypeScript checking and builds the production bundle.

For GPU integration checks, run the dev server and open `/tests/gpu.html` in a WebGPU browser. This development-only harness compares 500 initial matrices and 120 integration steps against the CPU reference, checks reset replay and recycling, and exercises extreme controls for five simulated seconds. Readback exists only in that test. The test page is not included in the production build. GPU and CPU respawn random sequences intentionally differ, and different GPUs are not guaranteed bit-identical floating-point results.

The phase 4 scene has been checked locally in WebGPU and forced WebGL2. The local WebGPU run reports seven total scene draw calls at 500 leaves (five foliage batches), with no shader errors. Motion remains subject to artistic review; these checks do not establish performance on physical mobile devices.
