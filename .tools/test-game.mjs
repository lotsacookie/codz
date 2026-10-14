import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts/browser');fs.mkdirSync(out,{recursive:true});
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const browser=await chromium.launch({executablePath,headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],failed=[];
page.on('pageerror',e=>{errors.push(String(e));console.log('PAGE ERROR',String(e));});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('CONSOLE ERROR',m.text());}});page.on('response',r=>{if(r.status()>=400)failed.push(r.url()+' '+r.status());});
try{
 await page.goto('http://127.0.0.1:5173/?map=kino',{waitUntil:'load',timeout:180000});
 await page.waitForFunction(()=>globalThis.kino?.debug.getState().ready||globalThis.kino?.debug.getState().errors.length,null,{timeout:180000});
 const boot=await page.evaluate(()=>kino.debug.getState());if(!boot.ready)throw new Error(JSON.stringify(boot.errors));
 await page.screenshot({path:path.join(out,'menu.png')});
 await page.evaluate(()=>kino.debug.setActive(true));
 await page.waitForTimeout(1000);await page.screenshot({path:path.join(out,'spawn.png')});
 const state=await page.evaluate(()=>kino.debug.getState());fs.writeFileSync(path.join(out,'state.json'),JSON.stringify(state,null,2));
 if(process.argv.includes('--encounter')){
  await page.evaluate(()=>{kino.debug.step(16);kino.debug.pause();});
  await page.screenshot({path:path.join(out,'round-spawn.png')});
  console.log('ROUND',JSON.stringify(await page.evaluate(()=>kino.debug.getState())));
  await page.evaluate(()=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.teleportPlayer([0,110,1120]);kino.debug.lookAt([0,160,880]);kino.debug.spawnEnemy([0,100,900]);kino.debug.step(.2);});
  await page.screenshot({path:path.join(out,'zombie.png')});
  console.log('ENCOUNTER',JSON.stringify(await page.evaluate(()=>kino.debug.getState())));
 }
 console.log(JSON.stringify({ready:state.ready,player:state.player,viewmodel:state.viewmodelReady,performance:state.performance,enemies:state.enemies.length,errors,failed},null,2));
 if(errors.length||failed.length)process.exitCode=1;
}catch(e){console.error(e);console.log({errors,failed});await page.screenshot({path:path.join(out,'failure.png')});process.exitCode=1;}
finally{fs.writeFileSync(path.join(out,'console.json'),JSON.stringify({errors,failed},null,2));await browser.close();}
