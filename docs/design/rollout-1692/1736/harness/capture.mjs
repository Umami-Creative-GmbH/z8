import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const phase=process.argv[2];
const cli='C:/Users/KaiHentschel/AppData/Local/pnpm/global/v11/bf86bf49b40726ed136d2d0acb80e5862fa90fc3a766ffc0e05622cbe6aa30a8/node_modules/agent-browser/bin/agent-browser.js';
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('AGENT_BROWSER_')));
const run=(args,input)=>execFileSync(process.execPath,[cli,'--session','1736-bf423a4e',...args],{env,input,encoding:'utf8',windowsHide:true,timeout:60000});
const evalJS=code=>run(['eval','--stdin'],code);
const dir='docs/design/rollout-1692/1736';
const pins=JSON.parse(readFileSync('.tmp/1736-current/pins.json'));
const sources=pins.map(({file})=>({file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),gitBlob:execFileSync('git',['hash-object',file],{encoding:'utf8'}).trim()}));
const captures=[];
evalJS('(async()=>{await new Promise(r=>setTimeout(r,5000));return true;})()');
for(const [width,height,name] of [[1600,1000,'desktop'],[390,844,'phone'],[2560,1440,'wide']]){
 run(['set','viewport',String(width),String(height)]);
 const measure=`(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await new Promise(r=>setTimeout(r,400));const main=document.querySelector('main');const h=[...document.querySelectorAll('h1')].filter(x=>x.getClientRects().length);if(!main?.innerText.includes('R062 Delivery')||!main.innerText.includes('R062 Unpriced'))throw Error('Report not settled');const heading=h.map(x=>({text:x.innerText,x:x.getBoundingClientRect().x,y:x.getBoundingClientRect().y,width:x.getBoundingClientRect().width}));return {instant:new Date().toISOString(),viewport:[innerWidth,innerHeight],documentWidth:document.documentElement.scrollWidth,headings:heading,theme:document.documentElement.className,rootFont:getComputedStyle(document.documentElement).fontSize,text:main.innerText};})()`;
 const raw=evalJS(measure);
 const second=JSON.parse(evalJS(measure));const first=JSON.parse(raw);if(JSON.stringify(first.headings)!==JSON.stringify(second.headings)||first.documentWidth!==second.documentWidth)throw Error('Unsettled report geometry');
 const file=`${phase}-${name}.png`;
 run(['screenshot',resolve(dir,file)]);
 captures.push({file,sha256:createHash('sha256').update(readFileSync(`${dir}/${file}`)).digest('hex'),measurement:JSON.parse(raw)});
}
writeFileSync(`${dir}/${phase}-captures.json`,JSON.stringify({phase,base:'5646e7b320376d2605b80e231b6b828f4b35f670',fixture:'own disposable 1736 fixture; two synthetic projects, 6 hours, one task and customer; Berlin +60 entries; Nov 2026; small-admin',sources,captures},null,2));
console.log(`Captured ${phase}: ${captures.length} settled default-text report layouts with source hashes.`);
