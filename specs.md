# Realtime Cinematic Wind Simulation

## 1. Project Goal

Build a visually impressive, photorealistic, real-time browser experience showing lightweight natural objects — primarily autumn leaves, flower petals, and optionally feathers — moving through the air against a cinematic autumn sky.

The result should feel closer to a short film/VFX shot than to a conventional web animation.

The experience must:

- run entirely in the browser;
- work well on modern desktop browsers;
- remain usable on mid-range mobile devices;
- gracefully reduce visual quality when GPU performance is limited;
- use a reasonably small initial download;
- avoid large pre-rendered video backgrounds;
- emphasize realistic motion, lighting, atmospheric depth, and cinematic post-processing;
- maintain a clean architecture so individual visual systems can be tuned independently.

The experience is primarily visual. There is no need for gameplay, complex UI, networking, persistence, or backend infrastructure.

---

# 2. Visual Direction

The target scene is:

- an autumn sky;
- warm low-angle sunlight;
- cooler blue ambient skylight;
- multiple leaves drifting and tumbling through the air;
- some objects close to the camera;
- many smaller objects farther away;
- realistic depth, scale variation, and motion;
- occasional objects crossing very close to the camera;
- cinematic contrast and color grading;
- bloom around bright light;
- subtle lens flare;
- subtle vignette;
- high-quality animated film grain.

The scene should avoid looking like:

- a conventional particle system;
- flat sprites moving on predetermined sine waves;
- a video game HUD;
- stylized/cartoon foliage;
- hundreds of identical objects;
- obviously looped motion.

Photorealistic believability is more important than physical correctness.

---

# 3. Technical Stack

Use:

- TypeScript
- Vite
- Three.js
- Three.js `WebGPURenderer`
- TSL / Three.js node materials where practical
- WebGPU as the preferred rendering backend
- WebGL2 fallback through Three.js where possible
- glTF / GLB for geometry
- KTX2 / Basis texture compression
- Meshopt compression where appropriate

Avoid adding React unless it provides a clear benefit.

This application is mostly one continuously rendered visual scene, so plain TypeScript with a small modular architecture is preferable.

Do not use WASM for the initial implementation.

WASM may be introduced later only if profiling demonstrates a CPU bottleneck that cannot reasonably be solved using GPU compute, shaders, workers, or ordinary TypeScript.

---

# 4. Browser Strategy

Preferred execution path:

```text
WebGPU
  ↓
GPU compute simulation
  ↓
GPU-resident instance state
  ↓
instanced rendering
  ↓
post-processing
```

Fallback path:

```text
WebGL2
  ↓
simplified procedural animation
  ↓
instanced rendering
  ↓
reduced post-processing
```

The fallback does not need to reproduce exactly the same simulation.

The priority is similar visual character rather than bit-for-bit equivalent behavior.

If neither WebGPU nor the required WebGL2 capabilities are available, show a simple static or lightly animated fallback scene instead of failing.

---

# 5. High-Level Architecture

Organize the application into isolated systems.

Suggested structure:

```text
src/
  app/
    App.ts
    bootstrap.ts

  renderer/
    Renderer.ts
    capabilities.ts
    resize.ts

  scene/
    SceneController.ts
    CameraController.ts
    Lighting.ts
    Sky.ts

  simulation/
    WindField.ts
    ParticleSimulation.ts
    ParticleTypes.ts
    SimulationConfig.ts

  foliage/
    LeafSystem.ts
    LeafMaterial.ts
    LeafGeometry.ts
    LeafAssets.ts

  post/
    PostProcessing.ts
    Bloom.ts
    LensFlare.ts
    FilmGrain.ts
    ColorGrading.ts
    Vignette.ts

  quality/
    QualityController.ts
    PerformanceMonitor.ts
    QualityPresets.ts

  debug/
    DebugPanel.ts
    Stats.ts

  shaders/
    ...

  assets/
    ...
```

Systems should communicate through small configuration/state interfaces.

Avoid large global mutable objects.

---

# 6. Scene Composition

Use three perceptual depth groups.

## Foreground

Approximately:

- 10–40 objects;
- relatively large;
- high-detail mesh;
- high-quality lighting;
- stronger depth-of-field/motion impression;
- may occasionally pass very close to the camera.

Foreground elements carry most of the perceived realism.

## Midground

Approximately:

- 100–300 objects;
- medium detail;
- instanced rendering;
- visible tumbling and flutter.

## Background

Approximately:

- 200–1000 objects depending on device capability;
- simplified geometry;
- smaller visual size;
- reduced shading complexity;
- may use simplified motion.

Do not treat these numbers as hard limits.

The adaptive quality system must be able to reduce them.

---

# 7. Leaf Representation

Do not model every leaf with expensive geometry.

Each high-quality leaf should typically use:

- approximately 6–40 triangles;
- a slightly curved surface;
- double-sided rendering if necessary;
- physically plausible normal orientation;
- UV coordinates;
- variation in scale and aspect ratio.

Support several leaf variants.

Initial target:

- 6–10 leaf shapes;
- 3–5 color families;
- optional flower-petal variants;
- optional feather variants later.

All variants should ideally share a texture atlas and material system.

Each instance should contain compact parameters such as:

```ts
interface LeafInstance {
  position: Vec3
  velocity: Vec3

  rotation: Quaternion
  angularVelocity: Vec3

  scale: number

  mass: number
  drag: number
  lift: number

  flutterPhase: number
  flutterFrequency: number
  flutterAmplitude: number

  variantIndex: number
  colorVariation: number
}
```

Actual GPU storage format may be more compact.

---

# 8. Materials

Leaves should not look like opaque pieces of plastic.

The material must support:

- albedo texture;
- normal map;
- roughness;
- small variation between instances;
- thin-surface transmission/backlighting;
- double-sided lighting.

The most important custom material effect is leaf translucency.

Approximate it rather than implementing expensive physically exact subsurface scattering.

Conceptually:

```text
front lighting
+
ambient sky contribution
+
warm sun contribution
+
backlight transmission
```

Backlight intensity should depend approximately on:

```text
dot(-surfaceNormal, sunDirection)
```

and should be modulated by:

- leaf texture;
- optional thickness map;
- leaf color;
- sun intensity.

Backlit leaves should shift toward warm yellow/orange/red tones.

---

# 9. Alpha Handling

Avoid traditional transparent alpha blending for foliage wherever possible.

Prefer:

- alpha clipping / alpha testing;
- alpha-to-coverage if supported and useful;
- dithering around cutout edges where appropriate.

The objective is to reduce overdraw.

Do not use giant mostly-transparent quads.

Geometry should follow the approximate silhouette closely enough to keep transparent areas small.

---

# 10. Wind Model

The wind should be spatially and temporally varying.

Do not use:

```text
position.x += sin(time)
```

as the primary motion model.

Represent wind as a field:

```text
wind(position, time)
```

consisting of:

```text
base directional wind
+
large slow gusts
+
medium-scale turbulent variation
+
small-scale flutter noise
```

Possible implementation techniques:

- procedural noise;
- curl noise;
- layered simplex/perlin-style noise;
- analytic functions suitable for shaders.

The system should support:

```ts
interface WindConfig {
  direction: Vec3
  speed: number
  gustStrength: number
  gustScale: number
  turbulenceStrength: number
  turbulenceScale: number
}
```

Wind should evolve smoothly and should never look like independent random jitter.

---

# 11. Leaf Physics

The simulation should be visually physically plausible but intentionally approximate.

For each object calculate forces based on:

```text
relativeAirVelocity = windVelocity - objectVelocity
```

Approximate:

- gravity;
- aerodynamic drag;
- lift;
- angular torque;
- turbulent perturbation.

The core visual behavior must include:

- falling;
- gliding;
- tumbling;
- fluttering;
- intermittent acceleration;
- brief stable orientations;
- sudden orientation changes after gusts.

Angular motion is especially important.

A leaf moving along a convincing trajectory but rotating mechanically will look artificial.

Each leaf should have slightly different aerodynamic parameters.

Avoid synchronized movement.

---

# 12. GPU Simulation

For WebGPU-capable devices, perform particle/leaf simulation using compute shaders.

Keep state on the GPU.

Ideal frame flow:

```text
CPU:
  update global uniforms
      ↓

GPU compute:
  update position
  update velocity
  update orientation
  update angular velocity
      ↓

GPU render:
  read updated instance data
  render instanced foliage
```

Do not read particle positions back to JavaScript every frame.

Do not upload every particle transform from JS every frame.

The CPU should primarily update global parameters such as:

- time;
- delta time;
- camera;
- wind configuration;
- sun position;
- quality settings.

---

# 13. WebGL2 Fallback

The WebGL2 implementation may simplify physics.

Possible fallback:

- base movement generated from initial state;
- procedural displacement in the vertex shader;
- deterministic noise;
- simplified angular animation;
- smaller particle count.

Prioritize:

1. stable performance;
2. believable motion;
3. matching overall visual composition.

Do not implement an unnecessarily complex GPU ping-pong simulation unless it is clearly required.

---

# 14. Instancing

Rendering must use instancing.

Do not create an individual Three.js mesh object for every leaf.

Target a small number of material/geometry batches.

Example:

```text
Leaf geometry A
  → 200 instances

Leaf geometry B
  → 150 instances

Leaf geometry C
  → 250 instances
```

Aim for approximately 5–20 foliage-related draw calls under normal conditions.

Exact numbers should be confirmed through profiling rather than enforced blindly.

---

# 15. Sky

The sky should be generated in real time.

Do not use a large video.

Initial implementation may combine:

- procedural vertical gradient;
- sun disc;
- atmospheric haze;
- horizon glow;
- subtle large-scale cloud structures.

The initial cloud implementation should be inexpensive.

Do not implement full volumetric ray-marched clouds in the first version.

The sky should support:

- time-of-day color controls;
- sun elevation;
- haze;
- cloud amount;
- cloud motion.

Target look:

```text
cool blue upper sky
+
slightly desaturated horizon
+
warm yellow/orange sunlight
```

---

# 16. Lighting

Start with:

- one directional sunlight source;
- ambient/hemisphere sky contribution;
- environment reflection contribution if useful.

Prefer a low-angle sun.

The lighting must clearly communicate object rotation.

As leaves turn, their:

- brightness;
- specular response;
- normal-map response;
- translucency

should visibly change.

Do not add expensive dynamic shadow maps in the first implementation unless profiling proves they are affordable and visually important.

Leaves do not need to cast high-resolution dynamic shadows onto other leaves.

---

# 17. Camera

The initial scene should use a mostly stable cinematic camera.

Add subtle motion only.

Examples:

- very slow drift;
- small handheld-like movement;
- very subtle parallax.

Do not add noticeable camera shake.

The camera should make foreground leaves passing nearby feel dimensional.

Optional pointer interaction:

- very small camera parallax;
- subtle change in wind direction;
- subtle scene response.

User interaction must never dominate the visual.

---

# 18. Depth and Motion

Use several inexpensive cues for depth:

- object scale;
- atmospheric haze;
- motion parallax;
- depth-dependent contrast;
- depth-dependent saturation;
- depth-dependent sharpness.

Avoid expensive cinematic depth-of-field in the initial version.

If depth of field is later added, use a low-cost implementation and run it at reduced resolution.

---

# 19. Post-Processing Pipeline

Target pipeline:

```text
HDR scene render
    ↓
bloom
    ↓
lens flare
    ↓
tone mapping
    ↓
color grading
    ↓
vignette
    ↓
film grain
    ↓
final output
```

Combine passes where reasonable.

Avoid unnecessary full-screen passes.

---

# 20. Bloom

Bloom should be subtle and mostly affect:

- sun;
- bright haze;
- strongly backlit leaves;
- flare highlights.

Avoid the exaggerated "neon game" look.

Bloom should preferably operate at reduced resolution.

---

# 21. Lens Flare

Implement a lightweight procedural cinematic lens flare.

It may contain:

- central glow;
- subtle halo;
- several lens ghosts;
- optional anamorphic streak;
- optional lens-dirt modulation.

The flare position should derive from the projected sun position.

The effect should become weaker when the sun is outside the viewport.

If affordable, approximate sun occlusion by scene geometry.

At minimum, avoid obvious full-strength flare when the light source is completely blocked.

The effect should remain subtle.

---

# 22. Film Grain

Implement film grain procedurally.

Do not ship a large animated grain texture or video.

Requirements:

- temporally varying;
- high-frequency;
- no obvious repeating pattern;
- primarily luminance grain;
- optional subtle chroma variation;
- intensity dependent on image luminance.

Suggested character:

- visible but restrained;
- stronger in midtones;
- slightly weaker in extreme highlights;
- not equivalent to simple RGB white noise.

Grain should run even on reduced-quality configurations because it is visually valuable and relatively inexpensive.

---

# 23. Color Grading

Provide centralized grading controls.

Support at least:

- exposure;
- contrast;
- saturation;
- temperature;
- tint;
- highlight warmth;
- shadow coolness;
- black level;
- optional LUT later.

The default look should be cinematic and autumnal without becoming orange/teal caricature.

---

# 24. Tone Mapping

Render scene lighting in HDR where supported by the renderer.

Use an appropriate filmic tone-mapping curve.

Avoid clipped highlights around:

- sun;
- bloom;
- translucent leaves.

The sun should feel much brighter than ordinary scene elements while remaining visually controlled.

---

# 25. Texture Pipeline

Use texture atlases where practical.

Primary foliage atlas should contain multiple leaf variants.

Prefer:

- KTX2;
- Basis Universal;
- mipmaps;
- GPU-compatible compression.

Textures may contain:

- color/albedo;
- normal;
- roughness;
- alpha;
- optional thickness/transmission data.

Where possible, pack scalar maps into channels of the same texture.

Example:

```text
R = roughness
G = thickness
B = variation mask
A = alpha
```

Avoid unnecessary 4K textures.

Start around 1K–2K atlases and verify actual rendered quality.

---

# 26. Asset Budget

Aim for:

```text
initial transferred assets:
approximately 5–15 MB
```

This is a target rather than a strict limit.

Prefer visual value over arbitrary compression, but investigate any asset that contributes several megabytes.

Avoid:

- video backgrounds;
- large uncompressed PNG sequences;
- multiple huge HDR files;
- large redundant textures.

Lazy-load optional high-quality assets when useful.

---

# 27. Performance Targets

Primary target devices:

### Desktop

Target:

```text
60 FPS
```

on typical recent integrated or discrete GPUs.

### Mid-range mobile

Target:

```text
30 FPS minimum stable target
```

Prefer stable 30 FPS with good image quality over unstable 40–60 FPS.

Higher-end mobile devices may run at 60 FPS.

Performance should be measured using actual frame time rather than assumptions based only on device type.

---

# 28. Adaptive Quality System

Implement a runtime quality controller.

Do not simply classify devices as:

```text
desktop
mobile
```

Measure actual performance.

Track rolling frame-time statistics.

Possible initial quality levels:

```text
Ultra
High
Medium
Low
```

Adjustable parameters:

- internal render scale;
- leaf count;
- foreground leaf count;
- simulation complexity;
- cloud complexity;
- bloom resolution;
- flare quality;
- material quality;
- background object count.

Example:

```text
High:
  render scale 1.0
  leaves 800
  full material quality
  bloom half resolution
  high flare quality

Medium:
  render scale 0.8
  leaves 500
  simplified distant materials
  bloom quarter resolution

Low:
  render scale 0.65
  leaves 250
  simplified sky
  reduced flare
```

Do not constantly change quality.

Use:

- rolling averages;
- hysteresis;
- cooldown periods.

Example logic:

```text
if frame time remains poor for several seconds:
    decrease quality

if frame time remains comfortably below target for a longer period:
    increase quality
```

Avoid visible oscillation.

---

# 29. Dynamic Resolution

Internal rendering resolution must be independent of CSS display resolution.

Cap effective device pixel ratio.

Do not automatically render a mobile display at full DPR 3 or DPR 4.

Suggested initial strategy:

```ts
effectiveDpr = Math.min(devicePixelRatio, configuredDprCap)
```

Allow adaptive render scale such as:

```text
1.0
0.85
0.75
0.65
```

This is one of the primary performance controls.

Post-processing should operate on the internal resolution, not blindly at native screen resolution.

---

# 30. Object Recycling

Leaves that leave the simulation volume should be recycled rather than allocated again.

The simulation should use a fixed-size pool.

Typical lifecycle:

```text
spawn upstream/outside camera
      ↓
travel through visible region
      ↓
leave simulation bounds
      ↓
reset state
      ↓
respawn
```

Avoid per-frame garbage allocation.

Avoid creating/destroying JS objects in the animation loop.

---

# 31. Deterministic Randomness

Use seeded randomness where practical.

This makes:

- debugging;
- visual comparison;
- performance testing;
- automated screenshots

more repeatable.

The default experience may choose a random seed when loading.

Debug mode must allow a fixed seed.

---

# 32. Main Loop

Use a single application render loop.

Conceptually:

```ts
function frame(timestamp: number) {
  updateTiming()

  qualityController.update()
  camera.update()
  scene.updateGlobalState()

  simulation.update()
  renderer.render()

  requestAnimationFrame(frame)
}
```

For WebGPU simulation, `simulation.update()` should primarily schedule compute work rather than iterate over every particle in JavaScript.

Clamp unusually large delta times.

Handle tab suspension/resume gracefully.

---

# 33. Reduced Motion

Respect:

```css
prefers-reduced-motion
```

When reduced motion is enabled:

- greatly reduce leaf velocity;
- reduce turbulence;
- disable camera drift;
- reduce strong flare animation;
- keep the scene visually attractive.

Do not necessarily replace the entire scene with a static image.

---

# 34. Page Visibility

When the page is not visible:

- stop or dramatically reduce rendering;
- do not continuously consume GPU resources.

Resume cleanly when visibility returns.

---

# 35. Debug Controls

Create a development-only control panel.

Use something lightweight such as `lil-gui`.

Controls should expose:

## Simulation

- wind direction;
- wind speed;
- turbulence;
- gust strength;
- gravity;
- drag;
- lift;
- flutter;
- leaf count.

## Lighting

- sun direction;
- sun intensity;
- sun color;
- sky intensity;
- transmission strength.

## Post

- bloom;
- flare;
- grain;
- vignette;
- exposure;
- grading.

## Quality

- render scale;
- DPR cap;
- quality preset;
- adaptive quality on/off.

Allow debug parameters to be copied/exported as JSON.

---

# 36. Performance Debugging

Development mode should display:

- FPS;
- average frame time;
- approximate render scale;
- active particle count;
- quality level;
- renderer backend;
- draw calls;
- triangle count if available.

If supported, expose GPU timing information.

Do not display performance UI in production.

---

# 37. Asset Loading

Show the scene as soon as minimum required assets are available.

Do not block startup on every optional resource.

Suggested sequence:

```text
1. renderer
2. procedural sky
3. core foliage atlas
4. leaf geometry
5. simulation
6. optional higher-quality effects/assets
```

Display a simple tasteful loading state only if needed.

Avoid progress bars unless loading actually takes long enough to justify them.

---

# 38. Error Handling

Handle:

- WebGPU initialization failure;
- WebGL fallback;
- texture load failure;
- device/context loss;
- invalid shader compilation;
- unsupported features.

Failure of an optional visual effect must not crash the whole experience.

Log useful diagnostics in development.

---

# 39. Memory Management

Be conservative with mobile GPU memory.

Dispose unused:

- geometries;
- textures;
- render targets;
- pipelines/materials where applicable.

Do not accidentally create new render targets on every resize.

Texture compression is required partly to keep GPU memory use low.

---

# 40. Initial Quality Presets

Start with these approximate presets.

## High

```text
renderScale: 1.0
DPR cap: 2
leaf count: 800
foreground leaves: 30
midground leaves: 250
background leaves: 520
bloom: enabled
flare: full
grain: full
sky: high
```

## Medium

```text
renderScale: 0.8
DPR cap: 1.5
leaf count: 500
foreground leaves: 20
midground leaves: 170
background leaves: 310
bloom: enabled
flare: medium
grain: full
sky: medium
```

## Low

```text
renderScale: 0.65
DPR cap: 1.25
leaf count: 250
foreground leaves: 10
midground leaves: 90
background leaves: 150
bloom: reduced
flare: reduced
grain: enabled
sky: simplified
```

These are starting assumptions only.

Adjust after profiling.

---

# 41. Development Phases

Do not build everything at once.

## Phase 1 — Renderer Foundation

Implement:

- Vite;
- TypeScript;
- Three.js;
- renderer selection;
- resize handling;
- render loop;
- debug overlay;
- procedural sky;
- camera;
- sun.

Deliverable:

A stable empty cinematic sky scene running through WebGPU with fallback.

---

## Phase 2 — One Leaf

Implement one convincing leaf.

Requirements:

- simple curved geometry;
- albedo;
- normal map;
- alpha cutout;
- double-sided shading;
- sunlight;
- backlighting/transmission.

Deliverable:

One leaf manually rotatable in front of the sun that looks convincingly physical.

Do not proceed until this looks good.

---

## Phase 3 — CPU Prototype of Motion

Before optimizing, prototype the aerodynamic model with approximately 20–50 leaves on CPU.

Focus on motion quality.

Tune:

- drag;
- lift;
- tumble;
- flutter;
- gust response;
- angular damping.

Deliverable:

Leaves should already move convincingly even if performance is not yet scalable.

---

## Phase 4 — GPU Simulation

Move the simulation to WebGPU compute.

Implement GPU state buffers and instanced rendering.

Increase to several hundred leaves.

Deliverable:

Approximately 500 leaves with minimal CPU per-particle work.

---

## Phase 5 — Depth Composition

Introduce:

- foreground;
- midground;
- background populations;
- geometry LOD;
- material LOD;
- haze;
- scale variation.

Deliverable:

Scene should start feeling visually dense without requiring thousands of detailed meshes.

---

## Phase 6 — Cinematic Post

Implement:

- bloom;
- tone mapping;
- grading;
- vignette;
- film grain;
- lens flare.

Deliverable:

The scene should visually resemble a graded cinematic shot rather than raw realtime graphics.

---

## Phase 7 — Adaptive Quality

Implement:

- frame-time monitoring;
- render-scale adaptation;
- particle-count adaptation;
- quality presets;
- hysteresis.

Test on desktop and mobile.

---

## Phase 8 — Asset Optimization

Add:

- KTX2;
- Meshopt where useful;
- atlas packing;
- payload analysis;
- GPU memory review.

---

## Phase 9 — Polish

Tune:

- wind;
- camera;
- color;
- flare;
- grain;
- leaf diversity;
- object spawn timing;
- foreground events.

Remove anything that looks synthetic.

---

# 42. Performance Rules

Follow these rules unless profiling demonstrates a reason not to.

1. Do not update every leaf from JavaScript on WebGPU devices.

2. Do not create one Three.js object per leaf.

3. Do not use full native mobile DPR by default.

4. Avoid large transparent overlapping quads.

5. Avoid large full-resolution blur passes.

6. Avoid allocating objects inside the frame loop.

7. Avoid synchronously reading data from GPU to CPU.

8. Prefer fewer larger GPU workloads to many tiny draw calls.

9. Use LOD for objects whose screen-space size is small.

10. Profile actual mobile hardware regularly.

---

# 43. Artistic Rules

Favor perceptual realism over simulation purity.

In particular:

- random motion must remain spatially coherent;
- objects must react to common gusts;
- each leaf still needs individual variation;
- nearby objects require greater detail than distant ones;
- lighting changes during rotation must be obvious;
- backlighting is a priority;
- atmospheric perspective is a priority;
- foreground events should occasionally create strong compositions.

The ideal result should make users wonder briefly whether the scene is rendered video.

---

# 44. Non-Goals

Do not initially implement:

- fluid dynamics / CFD;
- Navier-Stokes simulation;
- ray tracing;
- path tracing;
- full volumetric clouds;
- physically perfect subsurface scattering;
- high-quality real-time motion blur;
- complex collision between leaves;
- leaf-to-leaf collision;
- large terrain;
- characters;
- backend;
- multiplayer;
- React application architecture;
- WASM physics engine.

These may be explored later only when there is a clear visual payoff.

---

# 45. Acceptance Criteria

The initial production-quality version is successful when all of the following are true.

## Visual

- Leaves do not visibly move in synchronized patterns.
- Leaves visibly tumble, flutter, glide, and respond to gusts.
- At least several leaf variants are visible.
- Leaves look convincing when strongly backlit.
- Foreground leaves clearly feel closer than background leaves.
- Sky lighting feels coherent with leaf lighting.
- Film grain is animated but not distracting.
- Bloom does not look exaggerated.
- Lens flare feels integrated rather than pasted over the image.
- The final image feels deliberately color graded.

## Technical

- WebGPU is used when available.
- WebGL2 fallback works.
- Particle simulation does not perform per-leaf JS updates in the WebGPU path.
- Foliage uses instancing.
- DPR is capped.
- Internal render scale is configurable.
- Adaptive quality is implemented.
- Rendering stops or throttles when the page is hidden.
- `prefers-reduced-motion` is respected.
- no significant garbage is generated per frame.

## Performance

On a representative mid-range smartphone:

- scene remains responsive;
- sustained performance should target at least approximately 30 FPS;
- quality automatically decreases if this cannot be maintained;
- there should be no repeated multi-frame freezes.

On a recent desktop/laptop:

- 60 FPS should normally be achievable at medium/high quality.

---

# 46. First Implementation Task

Start by implementing only Phase 1 and Phase 2.

Do not begin GPU particle simulation yet.

Create:

1. the Vite + TypeScript application;
2. Three.js WebGPURenderer with WebGL fallback;
3. renderer capability detection;
4. responsive canvas;
5. cinematic procedural autumn sky;
6. directional sunlight;
7. one curved leaf mesh;
8. placeholder leaf textures if final assets are unavailable;
9. alpha-cutout leaf material;
10. custom warm backlight/transmission;
11. debug panel for sun and material parameters;
12. FPS/backend debug overlay.

The first milestone is complete when a single leaf rotating slowly against the sun looks plausibly photographic.

Treat this milestone as a visual foundation. Do not optimize particle counts before the material and lighting look convincing.
