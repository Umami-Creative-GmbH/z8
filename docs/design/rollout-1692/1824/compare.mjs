// Same-fixture consumer-source comparison. Does not replace domain data or HTTP responses.
// pnpm node .../compare.mjs <owned-fixture> <baseline-ref>
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
const repo=process.cwd(),dir=resolve(process.argv[2]),base=process.argv[3];
const names=['kiosk-app','kiosk-home','kiosk-paired-screen','kiosk-pairing-form','kiosk-pin-pad','kiosk-employee-panel','kiosk-confirmation','kiosk-language','use-kiosk-uncertain-actions'];
const files=[...names.map(n=>`apps/webapp/src/components/kiosk/${n}.${n.startsWith('use-')?'ts':'tsx'}`),'apps/webapp/src/lib/time-tracking/kiosk/kiosk-store.ts','apps/webapp/src/lib/time-tracking/kiosk/protocol.ts'];
const saved=new Map(),baseline=new Map();
for(const file of files){saved.set(file,await readFile(file));baseline.set(file,execFileSync('git',['show',`${base}:${file}`]));}
const run=phase=>new Promise((done,reject)=>{const executable=process.env.npm_execpath,native=executable.endsWith('.exe');const args=['node',join(repo,'docs/design/rollout-1692/1824/capture.mjs'),dir,phase];const child=spawn(native?executable:process.execPath,native?args:[executable,...args],{cwd:repo,env:process.env,stdio:'inherit',windowsHide:true});child.on('exit',code=>code===0?done():reject(Error('Capture failed '+phase)));});
try{for(const [file,bytes]of baseline)await writeFile(file,bytes);await run('before-final');}
finally{for(const [file,bytes]of saved){const current=await readFile(file);if(!current.equals(baseline.get(file)))throw Error('Concurrent source change; refusing to overwrite '+file);await writeFile(file,bytes);}}
await run('after-final');
