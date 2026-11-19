import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {sourceIdentity} from './identity.mjs';
const out='docs/design/rollout-1692/1727/',json=async n=>JSON.parse((await readFile(out+n,'utf8')).replace(/^\uFEFF/,''));
const sharp=createRequire(resolve('apps/webapp/package.json'))('sharp'),checks=[];
const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
const before=await json('matched-before.json'),after=await json('matched-after.json'),overlay=await json('comparison-source.json');
check('exact before source overlay restored',overlay.restored);
for(let i=0;i<4;i++){
 const a=before.snapshots[i],b=after.snapshots[i];check(a.name+' matched viewport and theme',JSON.stringify(a.observation.cssViewport)===JSON.stringify(b.observation.cssViewport)&&a.observation.dark===b.observation.dark);
 check(a.name+' matched real ledger evidence count',(a.observation.text.match(/R044 browser/g)??[]).length===(b.observation.text.match(/R044 browser/g)??[]).length);
 check(a.name+' actual loaded fonts',a.observation.fontsStatus==='loaded'&&b.observation.fontsStatus==='loaded');
 check(a.name+' same app font family',a.observation.fontFamily===b.observation.fontFamily);
 for(const [phase,s]of [['matched-before',a],['matched-after',b]]){const decoded=await sharp(out+phase+'-'+s.name+'.png').raw().toBuffer({resolveWithObject:true});check(phase+' '+s.name+' fully decoded PNG agrees with CSS viewport',decoded.info.width===s.observation.cssViewport.width&&decoded.info.height===s.observation.cssViewport.height&&decoded.data.length===s.png.decodedBytes);}
}
check('real persisted large preference is 18px in both phases',before.snapshots[3].observation.font==='18px'&&after.snapshots[3].observation.font==='18px');
const unit=await json('unit-final4.json'),pg=await json('postgres-final.json'),runtime=await json('runtime.json'),recovery=await json('recovery.json'),native=await json('native-final.json'),inspect=await json('native-final-inspect.json');
check('final unit selection 154/0',unit.numPassedTests===154&&unit.numFailedTests===0);
check('final PostgreSQL 35/0',pg.numPassedTests===35&&pg.numFailedTests===0);
check('actual browser operations 14 plus recovery 8',runtime.checks.length===14&&recovery.checks.length===8&&!runtime.failures.length&&!recovery.failures.length);
check('native usable component tree and inspected target',native.data.tree.includes('EmployeeBalanceArrival')&&inspect.data.text.includes('13a2c846-0999-440b-ad8b-7a8081a177dc'));
const identity=await sourceIdentity();
const hash=b=>createHash('sha256').update(b).digest('hex');
const owners=['apps/webapp/src/app/[locale]/(app)/settings/employees/work-balance-actions.ts','apps/webapp/src/app/[locale]/(app)/payroll/work-balances/coverage.ts','apps/webapp/src/components/settings/work-balance/use-employee-work-balance.ts','apps/webapp/src/lib/work-balance/service.ts',...['store.ts','rules.ts','authorization.ts'].map(n=>'apps/webapp/src/lib/work-balance/adjustments/'+n)];
for(const file of owners){const original=execFileSync('git',['show','11ad20e2251742960e6ccf3db17b1227ca3f17da:'+file]);const current=await readFile(file);check('preserved authoritative owner '+file,hash(original.toString('utf8').replaceAll('\r\n','\n'))===hash(current.toString('utf8').replaceAll('\r\n','\n')));}
await writeFile(out+'evidence-verification.json',JSON.stringify({identity,checks,counts:{freshR044Client:8,freshR044Page:3,freshR044Postgres:3,existingCompatibilityRerun:143,existingPostgresRerun:32,unitCombined:154,postgresCombined:35,browserOperations:14,browserRecovery:8},limits:['Combined reruns overlap prior runs; never sum them.','Native tree is distinct from DOM and generic Done.','The fixture dev deployment ID remains its preparation commit; actual source commits/hashes above identify the tested code.','Before-overlay unused new modules remain on disk; baseline page does not import them.','Physical devices, true zoom, global transitions, providers, full static generation and remote catalogs remain unpassed.']},null,2)+'\n');
console.log(`Evidence: ${checks.length} verified assertions`);
