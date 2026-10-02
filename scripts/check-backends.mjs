// Chrome rendering regression checks against the development server.
// Usage: node scripts/check-backends.mjs <tools-node_modules> <dev-url> <output.json>
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const [runtime, url, output] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(resolve(runtime, 'playwright/index.mjs')));
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-webgpu']});
const results=[];
try{
 for(const path of ['/tests/gpu.html','/tests/post.html','/tests/post.html?webgl']){
 const page=await browser.newPage();await page.goto(url+path);
 await page.waitForFunction(()=>/FAIL|All GPU checks passed|PASS 144 FPS/.test(document.querySelector('#result').textContent),undefined,{timeout:120000});
 const result=await page.locator('#result').textContent();results.push({path,result});console.log(path+'\n'+result);await page.close();
 }
 for(const backend of ['webgpu','webgl','none']){
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});const client=await page.context().newCDPSession(page);
 await page.addInitScript(()=>{window.appFrames=0;const raf=requestAnimationFrame;window.requestAnimationFrame=f=>raf(t=>{if(f.name==='frame')window.appFrames++;f(t);});});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(url+'/?backend='+backend);
 if(backend==='none'){await page.waitForFunction(()=>document.querySelector('#app').dataset.backend==='Static');results.push({backend,fallback:await page.locator('#fallback').textContent(),errors});await page.close();continue;}
 await page.waitForFunction(()=>document.querySelector('#fallback')?.hidden,undefined,{timeout:60000});
 await page.keyboard.press('Space');await page.waitForTimeout(300);let start=await page.evaluate(()=>window.appFrames);await page.waitForTimeout(400);let paused=await page.evaluate(()=>window.appFrames)-start;
 if(paused!==0)throw Error(backend+': paused frame loop still running');
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(300);let resized=await page.evaluate(()=>window.appFrames)-start;
 if(resized<1||resized>3)throw Error(backend+': paused resize failed '+resized);
 start=await page.evaluate(()=>window.appFrames);await page.waitForTimeout(300);if(await page.evaluate(()=>window.appFrames)!==start)throw Error('Resize left a frame loop running');
 await page.keyboard.press('Space');await page.waitForTimeout(300);let resumed=await page.evaluate(()=>window.appFrames)-start;if(resumed<5)throw Error('Failed to resume');
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(300);
 // Force hidden/resume events through CDP lifecycle, then verify active frames return.
 await client.send('Page.setWebLifecycleState',{state:'frozen'});await page.waitForTimeout(200);await client.send('Page.setWebLifecycleState',{state:'active'});await page.waitForTimeout(300);
 const before=await page.evaluate(()=>window.appFrames);await page.waitForTimeout(300);if(await page.evaluate(()=>window.appFrames)<=before)throw Error('Lifecycle resume failed');
 
 results.push({backend,pausedFrames:paused,resizeFrames:resized,resumedFrames:resumed,errors});console.log(JSON.stringify(results.at(-1)));await page.close();
 }
 await writeFile(output,JSON.stringify(results,null,2));
 if(results.some(r=>r.result?.includes('FAIL')||r.errors?.length))process.exitCode=1;
}finally{await browser.close();}
