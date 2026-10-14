import {chromium} from 'playwright-core';
import fs from 'node:fs';
const browser=await chromium.launch({executablePath:['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
try{
await page.goto('http://127.0.0.1:5173/?map=kino');await page.waitForFunction(()=>kino?.debug.getState().ready,null,{timeout:120000});
await page.evaluate(()=>{kino.debug.setActive(true);kino.debug.setInvulnerable(true);kino.debug.step(.6);});
await page.screenshot({path:'artifacts/qa/visual-lobby.png'});
console.log(JSON.stringify(await page.evaluate(()=>[kino.debug.pickSurface(1045,430),kino.debug.pickSurface(1010,450),kino.debug.pickSurface(1075,465),kino.debug.getState().performance])));
await page.evaluate(()=>{const e=kino.debug.getEntities().find(e=>e.targetname==='use_elec_switch');kino.debug.teleportPlayer(e.position);kino.debug.step(.45);});
console.log('STAGE',JSON.stringify(await page.evaluate(()=>kino.debug.pickSurface(1130,150))));
await page.screenshot({path:'artifacts/qa/visual-stage.png'});
}finally{await browser.close();}
