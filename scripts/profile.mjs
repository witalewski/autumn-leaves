// Dedicated, disposable Chrome profile; DevTools measurements of local builds.
// Usage: node scripts/profile.mjs <tools-node_modules> <url> <output.json> [slow]
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const [runtime, url, output, slow] = process.argv.slice(2);
const { default: puppeteer } = await import(pathToFileURL(resolve(runtime, 'puppeteer-core/lib/puppeteer/puppeteer-core.js')));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--enable-unsafe-webgpu'],
});
const runs = [];
try {
  for (let run = 0; run < 3; run++) {
    const page = await browser.newPage();
    await page.setViewport(slow ? { width: 390, height: 844, deviceScaleFactor: 2 } : { width: 1280, height: 720, deviceScaleFactor: 1 });
    const client = await page.createCDPSession();
    await client.send('Network.enable');
    await client.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (slow) {
      await client.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750 });
      await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.evaluateOnNewDocument(() => {
      window.profileLongTasks = [];
      new PerformanceObserver(list => { for (const entry of list.getEntries()) window.profileLongTasks.push(entry.duration); }).observe({ type: 'longtask', buffered: true });
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.querySelector('#fallback')?.hidden, { timeout: 120000 });
    // Warm shaders/quality before sampling presentation intervals.
    await new Promise(resolve => setTimeout(resolve, 3000));
    const sample = await page.evaluate(async () => {
      const times = [];
      let previous = performance.now();
      for (let i = 0; i < 180; i++) {
        const now = await new Promise(resolve => requestAnimationFrame(resolve));
        if (i) times.push(now - previous);
        previous = now;
      }
      const ready = performance.getEntriesByName('autumn:scene-ready')[0]?.duration;
      const assets = performance.getEntriesByType('resource');
      const app = document.querySelector('#app');
      times.sort((a, b) => a - b);
      return { readyMs: ready, texturesMs: performance.getEntriesByName('autumn:textures')[0]?.duration,
        backend: app.dataset.backend, assets: app.dataset.assets, textureBytes: Number(app.dataset.textureBytes),
        transferBytes: assets.reduce((sum, entry) => sum + entry.transferSize, 0),
        resourceBytes: assets.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
        requests: assets.map(entry => ({ name: new URL(entry.name).pathname, bytes: entry.transferSize })),
        meanFrameMs: times.reduce((sum, time) => sum + time, 0) / times.length,
        p95FrameMs: times[Math.floor(times.length * 0.95)],
        longTaskMs: window.profileLongTasks.reduce((sum, duration) => sum + duration, 0),
        maxLongTaskMs: Math.max(0, ...window.profileLongTasks) };
    });
    runs.push({ ...sample, errors });
    console.log(JSON.stringify({ run, ...sample, requests: undefined }));
    await page.close();
  }
  await writeFile(output, JSON.stringify({ url, slow: Boolean(slow), runs }, null, 2) + '\n');
} finally { await browser.close(); }
