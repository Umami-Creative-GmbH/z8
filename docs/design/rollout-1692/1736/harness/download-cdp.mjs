import { execFileSync } from 'node:child_process';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer-core';
const cli='C:/Users/KaiHentschel/AppData/Local/pnpm/global/v11/bf86bf49b40726ed136d2d0acb80e5862fa90fc3a766ffc0e05622cbe6aa30a8/node_modules/agent-browser/bin/agent-browser.js';
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('AGENT_BROWSER_')));
const session=process.argv[2]||'1736-bf423a4e';
const run=args=>execFileSync(process.execPath,[cli,'--session',session,...args],{env,encoding:'utf8',windowsHide:true,timeout:60000});
const endpoint=run(['get','cdp-url']).trim();
const browser=await puppeteer.connect({browserWSEndpoint:endpoint});
const client=await browser.target().createCDPSession();
const directory=resolve('.tmp/1736-fixture/completed-downloads');mkdirSync(directory,{recursive:true});
await client.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:directory,eventsEnabled:true});
const sources=execFileSync('git',['diff','--name-only','--','apps/webapp/src'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean).map(file=>({file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),gitBlob:execFileSync('git',['hash-object',file],{encoding:'utf8'}).trim()}));
writeFileSync('.tmp/1736-fixture/latest-download-source-pins-private.json',JSON.stringify({instant:new Date().toISOString(),sources},null,2));
const events=[];
client.on('Browser.downloadWillBegin',event=>events.push({kind:'begin',guid:event.guid,filename:event.suggestedFilename}));
for(const label of (process.argv.slice(3).length ? process.argv.slice(3) : ['CSV','Excel'])){
 const snap=run(['snapshot','-i']);const id=snap.split('\n').find(x=>(x.includes(`- button "Export ${label}"`) || x.includes(`- button "${label} exportieren"`)))?.match(/ref=(e\d+)/)?.[1];if(!id)throw Error('Missing visible export');
 const completion=new Promise((done,reject)=>{const timeout=setTimeout(()=>reject(Error('Download completion timeout')),30000);const handler=event=>{events.push({kind:'progress',...event});if(event.state==='completed'){clearTimeout(timeout);client.off('Browser.downloadProgress',handler);done(event);}else if(event.state==='canceled'){clearTimeout(timeout);client.off('Browser.downloadProgress',handler);reject(Error('Download canceled'));}};client.on('Browser.downloadProgress',handler);});
 run(['click',`@${id}`]);await completion;
}
writeFileSync(`.tmp/1736-fixture/${session}-download-events-private.json`,JSON.stringify(events,null,2));
await browser.disconnect();console.log('Actual native clicks completed browser download events in the owned directory.');
