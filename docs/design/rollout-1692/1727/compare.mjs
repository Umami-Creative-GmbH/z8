import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
const base='11ad20e2251742960e6ccf3db17b1227ca3f17da',dir=process.argv[2],out='docs/design/rollout-1692/1727/';
const paths=['apps/webapp/src/app/[locale]/(app)/payroll/work-balances/[employeeId]/page.tsx',...['set-opening-balance-dialog','record-overtime-payout-dialog','cancel-balance-adjustment-dialog'].map(n=>'apps/webapp/src/components/settings/work-balance/'+n+'.tsx')];
const metadata='apps/webapp/src/lib/navigation/route-metadata.ts';
const saved=Object.fromEntries(await Promise.all([...paths,metadata].map(async p=>[p,await readFile(p)])));
const hash=b=>createHash('sha256').update(b).digest('hex');
const identity=b=>({raw:hash(b),normalized:hash(b.toString('utf8').replaceAll('\r\n','\n'))});
const evidence={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),integration:execFileSync('git',['rev-parse','ai/1692-app-wide-ui-refresh'],{encoding:'utf8'}).trim(),base,scope:'Only four R044 page/form sources from base; remove only R044 heading opt-in from current metadata. All other current integration sources, root opt-ins, data, catalogs, preferences and shell geometry stay current. New route modules stay on disk but the baseline page does not import them.',overlays:[],restored:false};
const capture=async(phase,label)=>{const child=spawn(process.env.npm_execpath,['--config.verifyDepsBeforeRun=false','node',out+'capture.mjs',dir,phase,label],{stdio:'inherit',windowsHide:true});const [code]=await once(child,'exit');assert.equal(code,0,label);};
try{
 for(const p of paths){const before=execFileSync('git',['show',base+':'+p]);await writeFile(p,before);evidence.overlays.push({path:p,before:identity(before),after:identity(saved[p])});}
 const before=Buffer.from(saved[metadata].toString('utf8').split('\n').filter(line=>!line.includes('/^\\/payroll\\/work-balances\\/[^/]+$/')).join('\n'));
 assert.notEqual(hash(before),hash(saved[metadata]),'Remove exactly the owned opt-in');await writeFile(metadata,before);evidence.overlays.push({path:metadata,before:identity(before),after:identity(saved[metadata])});
 await capture('before','matched-before');
}finally{for(const [p,bytes]of Object.entries(saved))await writeFile(p,bytes);evidence.restored=(await Promise.all(Object.entries(saved).map(async([p,bytes])=>hash(await readFile(p))===hash(bytes)))).every(Boolean);await writeFile(out+'comparison-source.json',JSON.stringify(evidence,null,2)+'\n');assert.ok(evidence.restored);}
await capture('after','matched-after');
