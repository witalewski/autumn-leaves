// Chrome rendering regression checks against the development server.
// Usage: node scripts/check-backend-controls.mjs <tools-node_modules> <dev-url> <output.json>
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const [runtime, url, output] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(resolve(runtime, 'playwright/index.mjs')));
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-webgpu']});const results=[];
try{
 for(const backend of ['webgpu','webgl']){
  const page=await browser.newPage({viewport:{width:1280,height:720}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{window.appFrames=0;const raf=requestAnimationFrame;window.requestAnimationFrame=f=>raf(t=>{if(f.name==='frame')window.appFrames++;f(t);});});
  await page.goto(url+'/?assets=sync&backend='+backend);await page.waitForFunction(()=>document.querySelector('#fallback').hidden);
  if(await page.locator('#app').getAttribute('data-assets')!=='Procedural sync 256')throw Error('Sync asset path failed');
  await page.keyboard.press('Space');await page.waitForTimeout(200);
  const count=()=>page.evaluate(()=>window.appFrames);const start=await count();
  for(let toggle=0;toggle<2;toggle++){
   await page.evaluate(()=>{const controller=[...document.querySelectorAll('.lil-controller')].find(e=>e.querySelector('.lil-name')?.textContent==='Enable post / compare');controller.querySelector('input').click();});await page.waitForTimeout(300);
  }
  if(await count()<start+2)throw Error('Paused post toggle failed');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});const hiddenStart=await count();await page.waitForTimeout(300);if(await count()!==hiddenStart)throw Error('Hidden scene rendered');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(200);const shown=await count();await page.waitForTimeout(300);if(await count()!==shown)throw Error('Showing paused scene restarted loop');
  await page.keyboard.press('Space');await page.waitForTimeout(200);if(await count()<=shown+3)throw Error('Resume after hide failed');
  results.push({backend,synchronousAssets:true,pausedPostToggle:true,hiddenStopsFrames:true,pausedShowRemainsIdle:true,resume:true,errors});await page.close();
 }
 const page=await browser.newPage();await page.addInitScript(()=>{Object.defineProperty(navigator,'gpu',{value:undefined});});await page.goto(url+'/');await page.waitForFunction(()=>document.querySelector('#fallback').hidden);
 const fallback=await page.locator('#app').getAttribute('data-backend');if(fallback!=='WebGL2')throw Error('Automatic WebGL2 fallback failed');results.push({automaticWebGPUFallback:fallback});await page.close();
 await writeFile(output,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));if(results.some(r=>r.errors?.length))process.exitCode=1;
}finally{await browser.close();}
