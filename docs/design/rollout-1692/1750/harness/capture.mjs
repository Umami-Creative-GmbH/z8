import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const agent='USER_HOME/AppData/Local/pnpm/global/v11/bf86bf49b40726ed136d2d0acb80e5862fa90fc3a766ffc0e05622cbe6aa30a8/node_modules/agent-browser/bin/agent-browser.js';
const [label,width='1600',height='1000']=process.argv.slice(2);
const output=resolve('docs/design/rollout-1692/1750');
await mkdir(output,{recursive:true});
function browser(args,input) {
 const env={...process.env,AGENT_BROWSER_SESSION:'z8-r168-1750-35f73bb3'};delete env.AGENT_BROWSER_RESTORE;
 const r=spawnSync(process.execPath,[agent,'--session',env.AGENT_BROWSER_SESSION,...args],{env,input,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:10*1024*1024});
 if(r.status!==0) throw Error(r.stderr||r.stdout||'native failure');
 return r.stdout;
}
browser(['set','viewport',width,height]);
browser(['wait','--text','Customer workshop train ticket']);
browser(['wait','--text','All changes saved']);
const state=browser(['eval','--stdin'],`(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.scrollTo(0,0);return {path:location.pathname,viewport:[innerWidth,innerHeight],h1:[...document.querySelectorAll('h1')].map(n=>n.textContent),fields:[...document.querySelectorAll('main input:not([type=file]):not([type=hidden]),main textarea')].map(n=>({name:n.name,value:n.value})),overflow:document.documentElement.scrollWidth>innerWidth,theme:document.documentElement.className,fontSize:getComputedStyle(document.documentElement).fontSize,dialogs:document.querySelectorAll('[role=dialog],[role=alertdialog]').length,active:{tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label')},fixtureNotificationPolicy:'native --disable-notifications; permission grant not asserted',privacyClone:'Only displayed synthetic account contact text replaced; no original contact capture retained'};})()`);
const parsed=JSON.parse(state); const data=typeof parsed==='string'?JSON.parse(parsed):parsed;
await writeFile(join(output,label+'.json'),JSON.stringify(data,null,2));
browser(['eval','--stdin'],`(()=>{const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){if(/[^\\s@]+@[^\\s@]+\\.[^\\s@]+/.test(n.textContent??'') && n.parentElement?.tagName!=='SCRIPT')n.textContent=n.textContent.replace(/[^\\s@]+@[^\\s@]+\\.[^\\s@]+/g,'[synthetic account]');}return 'privacy clone prepared';})()`);
browser(['eval','--stdin'], `(()=>{let style=document.getElementById("r168-privacy");if(!style){style=document.createElement("style");style.id="r168-privacy";document.head.append(style);}style.textContent="button[aria-label^=Account] span.text-xs, [role=menu] span.text-xs {visibility:hidden !important}";return "contact line masked";})()`);
browser(['screenshot',join(output,label+'.png'),'--full']);
console.log(JSON.stringify({label,width:Number(width),height:Number(height),overflow:data.overflow,headingCount:data.h1?.length}));
