// Paired, cache-disabled Chrome DevTools startup checks; browser tooling stays external.
// Usage: node scripts/profile-loading.mjs <tools-node_modules> <baseline-url> <candidate-url> <output.json>
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const [runtime, baseline, candidate, output] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(resolve(runtime, 'playwright/index.mjs')));
const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-webgpu']});
const runs=[];
try {
 for(const slow of [false,true])for(const backend of ['webgpu','webgl'])for(let run=-1;run<3;run++) {
  // Warm both sets of driver shaders, then alternate navigation order.
  const builds=run%2===0?[['candidate',candidate],['baseline',baseline]]:[['baseline',baseline],['candidate',candidate]];
  for(const [build,url] of builds){
   const page=await browser.newPage({viewport:slow?{width:390,height:844}:{width:1280,height:720},deviceScaleFactor:slow?2:1});
   const client=await page.context().newCDPSession(page);
   await client.send('Network.enable');await client.send('Network.setCacheDisabled',{cacheDisabled:true});
   if(slow){await client.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});await client.send('Emulation.setCPUThrottlingRate',{rate:4});}
   const errors=[];page.on('pageerror',e=>errors.push(String(e)));
   await page.goto(url+'?backend='+backend,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.querySelector('#fallback')?.hidden,undefined,{timeout:120000});
   const sample=await page.evaluate(()=>({readyMs:performance.getEntriesByName('autumn:scene-ready')[0].duration,textureMs:performance.getEntriesByName('autumn:textures')[0].duration,backend:document.querySelector('#app').dataset.backend}));
   if(run>=0){const result={build,run,slow,...sample,errors};runs.push(result);console.log(JSON.stringify(result));}
   await page.close();
  }
 }
 await writeFile(output,JSON.stringify({baseline,candidate,version:browser.version(),runs},null,2)+'\n');
}finally{await browser.close();}
