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
