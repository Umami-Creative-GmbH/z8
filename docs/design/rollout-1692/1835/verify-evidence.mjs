import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,lstat,readdir,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve,sep} from 'node:path';
const repo=process.cwd(),out=join(repo,'docs/design/rollout-1692/1835'),initial='3c7bc534edeb355d862c3f38759444658863af20';
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourcePaths=['apps/webapp/src/app/[locale]/onboarding/work-templates/page-client.tsx','apps/webapp/src/app/[locale]/onboarding/work-templates/page.test.tsx','apps/webapp/src/app/[locale]/onboarding/work-templates/actions.integration.test.ts'];
const result={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),initial,source:[],unchangedOwners:[],dependencyRoots:[],links:[],resolutions:[],checks:[]};
for(const path of sourcePaths){const bytes=await readFile(path),lf=bytes.toString().replaceAll('\r\n','\n');result.source.push({path,rawSha256:sha(bytes),lfSha256:sha(lf),crlfSha256:sha(lf.replaceAll('\n','\r\n')),gitBlob:execFileSync('git',['hash-object','--path',path,path],{encoding:'utf8'}).trim()});}
for(const path of ['apps/webapp/src/app/[locale]/onboarding/work-templates/actions.ts','apps/webapp/src/app/[locale]/onboarding/work-templates/page.tsx','apps/webapp/src/app/[locale]/onboarding/layout.tsx','apps/webapp/src/app/[locale]/onboarding/run-onboarding-action.ts','apps/webapp/src/components/onboarding/progress-indicator.tsx','apps/webapp/src/lib/effect/services/onboarding.service.ts','apps/webapp/src/lib/validations/onboarding.ts','apps/webapp/next.config.ts','pnpm-lock.yaml','package.json','apps/webapp/package.json']){
 const blob=execFileSync('git',['hash-object','--path',path,path],{encoding:'utf8'}).trim(),before=execFileSync('git',['rev-parse',initial+':'+path],{encoding:'utf8'}).trim();assert.equal(blob,before,path);result.unchangedOwners.push({path,blob,unchanged:true});
}
assert.equal(sha(await readFile('pnpm-lock.yaml')).toUpperCase(),'2A254A9E5731E431B5032D1B918688F5663CE837B08207E147E1808A71BB3799');
for(const path of ['node_modules','apps/webapp/node_modules','node_modules/.pnpm']){const stat=await lstat(path);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),path);result.dependencyRoots.push({path,physical:true,realpath:await realpath(path)});}
async function linksAt(path){for(const item of await readdir(path,{withFileTypes:true})){if(item.name==='.pnpm'||item.name==='.bin')continue;const p=join(path,item.name),s=await lstat(p);if(s.isSymbolicLink()){const target=await realpath(p);assert.ok(target.toLowerCase().startsWith((repo+sep).toLowerCase()),p);result.links.push({path:p,target});}else if(item.name.startsWith('@')&&s.isDirectory())await linksAt(p);}}
await linksAt('node_modules');await linksAt('apps/webapp/node_modules');
const require=createRequire(join(repo,'apps/webapp/package.json'));
const sharp=require('sharp');
for(const name of ['next/package.json','react/package.json','vitest/package.json','babel-plugin-react-compiler/package.json']){const target=await realpath(require.resolve(name));assert.ok(target.toLowerCase().startsWith((repo+sep).toLowerCase()));result.resolutions.push({name,target});}
const unit=JSON.parse(await readFile(join(out,'unit-final.json'),'utf8'));assert.equal(unit.numFailedTests,0);result.unit={files:unit.testResults.length,tests:unit.numTotalTests,passed:unit.numPassedTests};
const pg=JSON.parse(await readFile(join(out,'postgres-final.json'),'utf8'));assert.equal(pg.numFailedTests,0);result.postgres={files:pg.testResults.length,tests:pg.numTotalTests,passed:pg.numPassedTests};
const runtime=JSON.parse(await readFile(join(out,'runtime.json'),'utf8'));assert.ok(!runtime.failure);assert.equal(runtime.pageErrors.length,0);result.runtimeChecks=runtime.checks.length;
result.decodedCaptures=[];
for(const capture of runtime.captures){const bytes=await readFile(join(out,capture.filename));const decoded=await sharp(bytes).raw().toBuffer({resolveWithObject:true});assert.equal(decoded.info.width,capture.png.width);assert.equal(decoded.info.height,capture.png.height);assert.equal(capture.documentWidth,capture.width);if(capture.phase==='after')assert.equal(capture.source.files.find(x=>x.path===sourcePaths[0]).lfSha256,result.source[0].lfSha256);result.decodedCaptures.push({filename:capture.filename,width:decoded.info.width,height:decoded.info.height,channels:decoded.info.channels,decodedBytes:decoded.data.length,sha256:sha(bytes)});}
const native=JSON.parse(await readFile(join(out,'native-source.json'),'utf8'));assert.equal(native.lfSha256,result.source[0].lfSha256);const inspect=JSON.parse(await readFile(join(out,'native-inspect.json'),'utf8'));assert.equal(inspect.code,0);assert.match(inspect.out,/WorkTemplateSetup/);
result.checks.push('source pins and unchanged owners','approved lock and physical own dependency roots','direct/scoped links and framework resolution inside checkout','fresh unit/PostgreSQL accounting','actual runtime without uncaught exceptions','PNG dimensions and final consumer identity','native actual owner inspection and canonical source identity');
await writeFile(join(out,'evidence-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({checks:result.checks.length,dependencyLinks:result.links.length,unit:result.unit,postgres:result.postgres,runtime:result.runtimeChecks}));
