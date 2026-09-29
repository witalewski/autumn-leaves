# Autumn — a study of light

The **First Implementation Task** in `specs.md`: Phase 1 (renderer and sky) and Phase 2 (one leaf). This is a visual prototype for reviewing the material and lighting before adding motion simulation.

## Run

Use Node 20.19+ or 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite (normally http://127.0.0.1:5173).

```sh
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

## Inspect the leaf

- Drag the canvas to turn and tilt the leaf; dragging pauses automatic rotation.
- Space pauses/resumes. Arrow keys rotate in five-degree steps.
- The development panel adjusts sun position/color/intensity, sky fill, haze, cloud amount, leaf transmission, roughness, normal detail, tint, exposure, and orientation.
- Set transmission to zero to compare the backlit material with ordinary opaque shading. Rotate through an edge-on angle to inspect curvature and the reverse side. Set sun azimuth near 180° to inspect front lighting.
- Reset restores the initial study; Export downloads the current parameters as JSON.
- The development overlay reports the actual renderer backend, FPS, mean frame interval, total draw/triangle counts, render scale, and effective DPR. These are observed CPU frame intervals, not GPU timings. The panel and overlay are omitted from production builds.

## Implementation

Six small source files keep the prototype easy to tune:

- `main.ts`: scene, lighting, camera, input, sizing, and lifecycle.
- `renderer.ts`: Three.js WebGPURenderer initialization, actual backend detection, and filmic tone mapping.
- `sky.ts`: TSL gradient, atmospheric sun glow, sun disc, and inexpensive procedural cloud wisps.
- `leaf.ts`: one curved 44-triangle mesh, deterministic placeholder texture generation, and a double-sided TSL standard material with warm, thickness-modulated backlighting.
- `debug.ts`: development-only controls and statistics.
- `style.css`: full-screen canvas and minimal captions.

The 768×768 albedo/alpha, normal, and packed thickness/roughness maps are generated once at startup. They contain a serrated silhouette, branching veins, mottled autumn pigment, and fine surface variation. Albedo uses sRGB; data maps remain linear. The mesh closely follows the silhouette, uses alpha testing/MSAA coverage, and has no alpha blending. These are procedural **placeholder assets**, not scanned foliage. There are no external texture downloads.

The renderer prefers WebGPU and lets Three.js fall back to WebGL2 with the same node materials. Append `?backend=webgl` to exercise WebGL2 explicitly. In development, `?backend=none` exercises the static CSS sky and unsupported-renderer message. Initialization, rendering, and device-loss errors also reveal that fallback. Reload to retry after device loss.

Effective DPR is capped at 1.75 by default, with a separate render-scale control. The single animation loop stops when the document is hidden and clamps delta time on resume. Reduced-motion preference slows automatic rotation to 8% of normal speed; the camera stays fixed. HMR cleans up GPU resources, controls, listeners, and the frame loop.

## Scope boundary

There is no particle system, wind/physics simulation, GPU compute, leaf population, adaptive quality controller, bloom, lens flare, depth of field, film grain, asset compression pipeline, or backend. The sky's sun glow is part of its material, not a post-processing effect. Procedural geometry/maps intentionally stand in for the later glTF/KTX2 asset pipeline. The next step is to review this leaf's appearance; later phases have not been started.

## Verification

The production build and strict TypeScript check pass. The scene has been visually checked in the local desktop browser using WebGPU and forced WebGL2; both report their selected backend and render the leaf without shader errors. A mobile-sized viewport checks layout and canvas sizing, not real mobile GPU performance. Photographic fidelity still needs artistic review, especially when replacing the placeholder maps with final assets.
