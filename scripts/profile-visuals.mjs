// Freeze the first completed scene frame for matching Chrome screenshots.
// Usage: node scripts/profile-visuals.mjs <tools-node_modules> <baseline-url> <candidate-url> <output-prefix>
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const [runtime, baseline, candidate, output] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(resolve(runtime, 'playwright/index.mjs')));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-webgpu']});
try{
for(const backend of ['webgpu','webgl'])for(const portrait of [false,true])for(const [name,url] of [['baseline',baseline],['candidate',candidate]]){
 const page=await browser.newPage({viewport:portrait?{width:390,height:844}:{width:1280,height:720},deviceScaleFactor:portrait?1.75:1});
 await page.addInitScript(()=>{const raf=requestAnimationFrame;window.requestAnimationFrame=f=>document.querySelector('#fallback')?.hidden?1:raf(f);});
 await page.goto(`${url}?backend=${backend}`);
 await page.waitForFunction(()=>document.querySelector('#fallback')?.hidden,undefined,{polling:100,timeout:60000});
 await page.waitForTimeout(200);
 await page.screenshot({path:`${output}-${name}-${backend}-${portrait?'portrait':'landscape'}.png`});await page.close();
}
}finally{await browser.close();}
