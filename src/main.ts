import './style.css';
import { Color, DirectionalLight, HemisphereLight, MathUtils, Mesh, PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { createLeaf } from './leaf';
import { createRenderer } from './renderer';
import { createSky } from './sky';
import { MotionSimulation, motionDefaults } from './simulation/MotionSimulation';

export const settings = {
  sunAzimuth: 15, sunElevation: 10, sunIntensity: 3.2, sunColor: '#fff0d0', skyIntensity: 1.3,
  transmission: 1.15, roughness: 0.85, normalStrength: 0.65, leafColor: '#ffffff',
  haze: 0.45, clouds: 0.32, exposure: 1,
  ...motionDefaults,
  renderScale: 1, dprCap: 1.75,
};
export type Settings = typeof settings;

const host = document.querySelector<HTMLElement>('#app')!;
const fallback = document.querySelector<HTMLElement>('#fallback')!;
const hint = document.querySelector<HTMLElement>('#interaction-hint')!;
const params = new URLSearchParams(location.search);
const requestedSeed = Number(params.get('seed'));
if (params.has('seed') && Number.isFinite(requestedSeed)) settings.seed = requestedSeed >>> 0;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let dispose = () => {};

function showFallback(error: unknown) {
  if (import.meta.env.DEV) console.error('Autumn motion study:', error);
  host.dataset.backend = 'Static';
  fallback.textContent = 'The sky is still here. Live rendering is unavailable in this browser.';
  fallback.hidden = false;
  hint.textContent = 'Try a browser with WebGPU or WebGL2 support';
}

async function start() {
  if (import.meta.env.DEV && params.get('backend') === 'none') {
    showFallback('Static fallback requested');
    return;
  }
  const { renderer, capabilities } = await createRenderer(params.get('backend') === 'webgl');
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Autumn leaves drifting in wind. Press Space to pause or resume.');
  host.prepend(canvas);
  host.dataset.backend = capabilities.backend;

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 200);
  const sunDirection = new Vector3();
  const sunColor = new Color(settings.sunColor);
  const sun = new DirectionalLight(sunColor, settings.sunIntensity);
  const ambient = new HemisphereLight('#c1d9ef', '#72604c', settings.skyIntensity);
  const leaf = createLeaf(sunDirection, sunColor);
  const sky = createSky(sunDirection, sunColor);
  const simulation = new MotionSimulation(settings);
  // Phase 3 deliberately uses a small CPU prototype; GPU batching belongs to phase 4.
  const leaves = simulation.leaves.map(() => {
    const mesh = new Mesh(leaf.mesh.geometry, leaf.material);
    mesh.scale.setScalar(0.3);
    scene.add(mesh);
    return mesh;
  });
  function applyLeafVariety() {
    // A separate seeded stream leaves the aerodynamic replay unchanged.
    let seed = (settings.seed ^ 0x9e3779b9) >>> 0;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (const mesh of leaves) {
      const size = 0.23 + random() * 0.16;
      const width = 0.72 + random() * 0.56;
      const curl = 0.65 + random() * 0.85;
      mesh.scale.set(size * width, size, size * curl);
      mesh.material = leaf.palette[Math.floor(random() * leaf.palette.length)].material;
    }
  }
  applyLeafVariety();
  function syncLeaves() {
    for (let i = 0; i < leaves.length; i++) {
      leaves[i].visible = i < settings.leafCount;
      leaves[i].position.copy(simulation.leaves[i].position);
      leaves[i].quaternion.copy(simulation.leaves[i].rotation);
    }
  }
  scene.add(sky.mesh, sun, ambient);
  const abort = new AbortController();
  const events = { signal: abort.signal };
  let failed = false;
  let ready = false;
  let request = 0;
  let lastTime = 0;
  let sampleTime = 0;
  let sampleFrames = 0;
  let stats: { update: (fps: number, ms: number) => void; destroy: () => void } | undefined;

  function resize() {
    const width = host.clientWidth, height = host.clientHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, settings.dprCap) * settings.renderScale);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.set(0, 0, 16 * Math.max(1, 0.65 / camera.aspect));
    camera.updateProjectionMatrix();
    // Include the far side of the shallow prototype volume and a leaf-size margin.
    const halfHeight = Math.tan(MathUtils.degToRad(camera.fov / 2)) * (camera.position.z + 5);
    simulation.setBounds(halfHeight * camera.aspect + 1, halfHeight + 1);
  }

  function applySettings() {
    const azimuth = MathUtils.degToRad(settings.sunAzimuth);
    const elevation = MathUtils.degToRad(settings.sunElevation);
    sunDirection.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation));
    sunColor.set(settings.sunColor);
    sun.color.copy(sunColor);
    sun.position.copy(sunDirection).multiplyScalar(50);
    sun.intensity = settings.sunIntensity;
    ambient.intensity = settings.skyIntensity;
    leaf.transmission.value = settings.transmission;
    leaf.sunStrength.value = settings.sunIntensity;
    leaf.material.color.set(settings.leafColor);
    leaf.material.roughness = settings.roughness;
    leaf.material.normalScale.setScalar(settings.normalStrength);
    for (const variant of leaf.palette) {
      variant.material.color.copy(leaf.material.color).multiply(variant.tint);
      variant.material.roughness = settings.roughness;
      variant.material.normalScale.setScalar(settings.normalStrength);
    }
    sky.haze.value = settings.haze;
    sky.clouds.value = settings.clouds;
    sky.sunIntensity.value = settings.sunIntensity;
    renderer.toneMappingExposure = settings.exposure;
    hint.textContent = settings.running ? 'Space to pause' : 'Paused · Space to resume';
    syncLeaves();
  }

  function fail(error: unknown) {
    if (failed) return;
    failed = true;
    dispose();
    showFallback(error);
  }
  renderer.onDeviceLost = (info) => fail(info);
  renderer.onError = (message) => fail(message);

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLElement && event.target.closest('input, button, select, textarea, .lil-gui')) return;
    if (event.code !== 'Space' || event.repeat) return;
    event.preventDefault();
    settings.running = !settings.running;
    applySettings();
  }, events);

  function frame(now: number) {
    if (failed || document.hidden) return;
    const elapsed = lastTime ? (now - lastTime) / 1000 : 0;
    const dt = Math.min(elapsed, 0.05);
    lastTime = now;
    simulation.update(dt, motion.matches);
    syncLeaves();
    try { renderer.render(scene, camera); } catch (error) { fail(error); return; }
    if (failed) return;
    sampleTime += elapsed;
    sampleFrames++;
    if (sampleTime >= 0.75) {
      stats?.update(sampleFrames / sampleTime, sampleTime * 1000 / sampleFrames);
      sampleFrames = 0;
      sampleTime = 0;
    }
    request = requestAnimationFrame(frame);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  window.addEventListener('resize', resize, events);
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(request);
    lastTime = 0;
    sampleFrames = 0;
    sampleTime = 0;
    if (ready && !document.hidden && !failed) request = requestAnimationFrame(frame);
  }, events);

  dispose = () => {
    failed = true;
    cancelAnimationFrame(request);
    abort.abort();
    observer.disconnect();
    stats?.destroy();
    leaf.dispose();
    sky.dispose();
    renderer.dispose();
    canvas.remove();
  };
  applySettings();
  resize();
  simulation.reset();
  syncLeaves();
  // Compile before dismissing the loading state, so shader failures retain the static sky.
  await renderer.compileAsync(scene, camera);
  if (failed) return;
  if (import.meta.env.DEV) {
    const { createDebug } = await import('./debug');
    stats = createDebug(settings, renderer, capabilities.backend, applySettings, resize, () => { simulation.reset(); applyLeafVariety(); syncLeaves(); });
    console.info('Renderer capabilities:', capabilities);
  }
  fallback.hidden = true;
  ready = true;
  if (!document.hidden) request = requestAnimationFrame(frame);
}

start().catch((error: unknown) => { dispose(); showFallback(error); });
if (import.meta.hot) import.meta.hot.dispose(() => dispose());
