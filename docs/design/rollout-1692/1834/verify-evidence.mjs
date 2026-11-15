import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
const root=process.cwd(),out=resolve('docs/design/rollout-1692/1834');
const json=async name=>JSON.parse((await readFile(join(out,name),'utf8')).replace(/^\uFEFF/,''));
const hash=value=>createHash('sha256').update(value.replaceAll('\r\n','\n')).digest('hex');
const runtime=await json('runtime.json'),native=await json('native-source.json'),usability=await json('usability.json'),unit=await json('unit.json');
const pins=[];
for(const pin of runtime.source){const actual=hash(await readFile(pin.path,'utf8'));assert.equal(actual,pin.sha256);assert.equal(native.source.find(p=>p.path===pin.path).canonicalSha256,actual);assert.equal(usability.source.find(p=>p.path===pin.path).sha256,actual);pins.push({path:pin.path,sha256:actual});}
for(const observation of runtime.observations.filter(o=>o.capture))for(const pin of observation.source){const expected=observation.capture.startsWith('before')?hash(execFileSync('git',['show','b4cef3a126fd16563cb0bbddfd5872a2aeb4e530:'+pin.path],{encoding:'utf8'})):hash(await readFile(pin.path,'utf8'));assert.equal(pin.sha256,expected);}
const require=createRequire(join(root,'apps/webapp/package.json')),sharp=require('sharp'),pngs=[];
for(const name of (await readdir(out)).filter(n=>n.endsWith('.png'))){const result=await sharp(join(out,name)).raw().toBuffer({resolveWithObject:true});assert.ok(result.data.length>0);const observation=runtime.observations.find(o=>o.capture+'.png'===name);if(observation)assert.equal(result.info.width,observation.width);pngs.push({name,width:result.info.width,height:result.info.height});}
assert.equal(unit.numFailedTests,0);assert.equal(unit.numPassedTests,unit.numTotalTests);assert.ok(unit.testResults.length>=19);
for(const file of ['apps/webapp/src/app/[locale]/onboarding/work-schedule/actions.ts','apps/webapp/src/app/[locale]/onboarding/run-onboarding-action.ts','apps/webapp/src/lib/effect/services/onboarding.service.ts','apps/webapp/src/app/[locale]/onboarding/layout.tsx','apps/webapp/src/components/onboarding/progress-indicator.tsx'])assert.equal(hash(await readFile(file,'utf8')),hash(execFileSync('git',['show','584db58aa2e5789e6f0e94d0f2c2f69b62f18807:'+file],{encoding:'utf8'})));
await writeFile(join(out,'evidence-audit.json'),JSON.stringify({pins,pngs,files:unit.testResults.length,tests:unit.numPassedTests,unchangedOwners:true,currentSourceMatched:true},null,2)+'\n');
console.log(`Current route, native, usability and baseline pins match; ${pngs.length} PNGs fully decoded;${unit.testResults.length} suites/${unit.numPassedTests} tests; owners unchanged.`);
