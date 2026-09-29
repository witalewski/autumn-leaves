import './style.css';
import { Color, DirectionalLight, HemisphereLight, MathUtils, PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { createLeaf } from './leaf';
import { createRenderer } from './renderer';
import { createSky } from './sky';

export const settings = {
  sunAzimuth: 15, sunElevation: 10, sunIntensity: 3.2, sunColor: '#fff0d0', skyIntensity: 1.3,
  transmission: 1.15, roughness: 0.85, normalStrength: 0.65, leafColor: '#ffffff',
  haze: 0.45, clouds: 0.32, exposure: 1,
  autoRotate: true, rotationSpeed: 0.13, tilt: -10, yaw: -16, roll: -22,
  renderScale: 1, dprCap: 1.75,
};
export type Settings = typeof settings;

const host = document.querySelector<HTMLElement>('#app')!;
const fallback = document.querySelector<HTMLElement>('#fallback')!;
const hint = document.querySelector<HTMLElement>('#interaction-hint')!;
const params = new URLSearchParams(location.search);
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let dispose = () => {};

function showFallback(error: unknown) {
  if (import.meta.env.DEV) console.error('Autumn material study:', error);
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
  canvas.setAttribute('aria-label', 'Autumn leaf. Drag or use arrow keys to rotate. Press Space to pause.');
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
  scene.add(sky.mesh, leaf.mesh, sun, ambient);
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
    camera.position.set(0, 0, 6.3 * Math.max(1, 0.78 / camera.aspect));
    camera.updateProjectionMatrix();
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
    sky.haze.value = settings.haze;
    sky.clouds.value = settings.clouds;
    sky.sunIntensity.value = settings.sunIntensity;
    renderer.toneMappingExposure = settings.exposure;
    leaf.mesh.rotation.set(MathUtils.degToRad(settings.tilt), MathUtils.degToRad(settings.yaw), MathUtils.degToRad(settings.roll));
    hint.textContent = settings.autoRotate ? 'Drag to turn · Space to pause' : 'Drag to turn · Space to resume';
  }

  function fail(error: unknown) {
    if (failed) return;
    failed = true;
    dispose();
    showFallback(error);
  }
  renderer.onDeviceLost = (info) => fail(info);
  renderer.onError = (message) => fail(message);

  let dragging = false, pointerId = -1, previousX = 0, previousY = 0;
  canvas.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    dragging = true;
    pointerId = event.pointerId;
    previousX = event.clientX;
    previousY = event.clientY;
    settings.autoRotate = false;
    canvas.setPointerCapture(pointerId);
    canvas.focus({ preventScroll: true });
    applySettings();
  }, events);
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    settings.yaw = MathUtils.euclideanModulo(settings.yaw + (event.clientX - previousX) * 0.4 + 180, 360) - 180;
    settings.tilt = MathUtils.clamp(settings.tilt + (event.clientY - previousY) * 0.3, -180, 180);
    previousX = event.clientX;
    previousY = event.clientY;
    applySettings();
  }, events);
  canvas.addEventListener('lostpointercapture', () => { dragging = false; }, events);
  canvas.addEventListener('pointerup', (event) => {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    dragging = false;
  }, events);
  canvas.addEventListener('pointercancel', () => { dragging = false; }, events);
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLElement && event.target.closest('input, button, select, textarea, .lil-gui')) return;
    if (event.code === 'Space') {
      event.preventDefault();
      settings.autoRotate = !settings.autoRotate;
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      settings.autoRotate = false;
      if (event.key === 'ArrowLeft') settings.yaw -= 5;
      if (event.key === 'ArrowRight') settings.yaw += 5;
      if (event.key === 'ArrowUp') settings.tilt -= 5;
      if (event.key === 'ArrowDown') settings.tilt += 5;
    } else return;
    applySettings();
  }, events);

  function frame(now: number) {
    if (failed || document.hidden) return;
    const elapsed = lastTime ? (now - lastTime) / 1000 : 0;
    const dt = Math.min(elapsed, 0.05);
    lastTime = now;
    if (settings.autoRotate && !dragging) {
      const speed = settings.rotationSpeed * (motion.matches ? 0.08 : 1);
      settings.yaw = MathUtils.euclideanModulo(settings.yaw + MathUtils.radToDeg(dt * speed) + 180, 360) - 180;
      leaf.mesh.rotation.y = MathUtils.degToRad(settings.yaw);
    }
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
  // Compile before dismissing the loading state, so shader failures retain the static sky.
  await renderer.compileAsync(scene, camera);
  if (failed) return;
  if (import.meta.env.DEV) {
    const { createDebug } = await import('./debug');
    stats = createDebug(settings, renderer, capabilities.backend, applySettings, resize);
    console.info('Renderer capabilities:', capabilities);
  }
  fallback.hidden = true;
  ready = true;
  if (!document.hidden) request = requestAnimationFrame(frame);
}

start().catch((error: unknown) => { dispose(); showFallback(error); });
if (import.meta.hot) import.meta.hot.dispose(() => dispose());
