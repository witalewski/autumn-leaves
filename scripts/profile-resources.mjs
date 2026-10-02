// Chrome DevTools Protocol measurements. Keep browser tooling outside the app.
// Usage: node scripts/profile-resources.mjs <tools-node_modules> <url> <output.json> [slow]
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const [runtime, url, output, slow] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(resolve(runtime, 'playwright/index.mjs')));
const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true, args:['--enable-unsafe-webgpu']});
const runs = [];
try {
for (const backend of ['webgpu','webgl']) for (let run=0;run<3;run++) {
 const page = await browser.newPage({viewport:slow?{width:390,height:844}:{width:1280,height:720},deviceScaleFactor:slow?2:1});
 const client=await page.context().newCDPSession(page);
 await client.send('Network.enable'); await client.send('Network.setCacheDisabled',{cacheDisabled:true}); await client.send('Performance.enable');
 if(slow){await client.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});await client.send('Emulation.setCPUThrottlingRate',{rate:4});}
 const errors=[]; page.on('pageerror',e=>errors.push(String(e))); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{
   window.resourceProfile={textures:[],submits:0};
   if(!window.GPUDevice)return;
   const original=GPUDevice.prototype.createTexture;
   GPUDevice.prototype.createTexture=function(d){ const record={size:d.size,format:d.format,samples:d.sampleCount||1,mips:d.mipLevelCount||1,destroyed:false}; window.resourceProfile.textures.push(record); const t=original.call(this,d); const destroy=t.destroy.bind(t);t.destroy=()=>{record.destroyed=true;destroy();}; return t; };
   const submit=GPUQueue.prototype.submit;GPUQueue.prototype.submit=function(b){window.resourceProfile.submits++;return submit.call(this,b);};
 });
 await page.goto(url+'?backend='+backend,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#fallback')?.hidden,undefined,{timeout:60000});
 await page.waitForTimeout(3000);
 async function sample(){
   await client.send('HeapProfiler.collectGarbage');
   const before=(await client.send('Performance.getMetrics')).metrics;
   const counters=await page.evaluate(()=>({...window.resourceProfile, textures:undefined}));
   const intervals=await page.evaluate(async()=>{const a=[];let p;for(let i=0;i<180;i++){const n=await new Promise(requestAnimationFrame);if(p)a.push(n-p);p=n;}return a;});
   const after=(await client.send('Performance.getMetrics')).metrics;
   const get=(a,n)=>a.find(m=>m.name===n)?.value||0;
   intervals.sort((a,b)=>a-b);
   return {taskMs:(get(after,'TaskDuration')-get(before,'TaskDuration'))*1000, scriptMs:(get(after,'ScriptDuration')-get(before,'ScriptDuration'))*1000,heapBytes:get(after,'JSHeapUsedSize'),meanFrameMs:intervals.reduce((s,x)=>s+x,0)/intervals.length,p95FrameMs:intervals[Math.floor(intervals.length*.95)],submits:await page.evaluate(()=>window.resourceProfile.submits)-counters.submits};
 }
 const running=await sample(); await page.keyboard.press('Space');await page.waitForTimeout(200);const paused=await sample();
 const info=await page.evaluate(()=>({readyMs:performance.getEntriesByName('autumn:scene-ready')[0]?.duration,backend:document.querySelector('#app').dataset.backend,resources:performance.getEntriesByType('resource').reduce((s,x)=>s+x.decodedBodySize,0),textures:window.resourceProfile.textures.filter(x=>!x.destroyed)}));
 const result={run,...info,running,paused,errors};runs.push(result); console.log(JSON.stringify({...result,textures:result.textures.map(x=>x.format)}));
 await page.close();
}
await writeFile(output,JSON.stringify({url,version:browser.version(),slow:Boolean(slow),runs},null,2)+'\n');
}finally{await browser.close();}
