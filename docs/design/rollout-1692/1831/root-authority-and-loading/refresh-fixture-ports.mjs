import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const dir=resolve(process.argv[2]),read=async n=>JSON.parse(await readFile(join(dir,n),'utf8'));
const r=await read('runtime-private.json'),f=await read('fixture-private.json'),s=await read('services.json');assert.equal(f.kind,'disposable');assert.equal(s.label,'z8-performance-fixture-1450');assert.equal(new URL(r.origin).hostname,'localhost');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
const records=[];
for(const [kind,internal,key]of [['postgres',5432,'POSTGRES_PORT'],['redis',6379,'REDIS_PORT'],['storage',9000,'S3_PUBLIC_ENDPOINT']]){
 const matches=s.containers.filter(c=>c.endsWith('_'+kind));assert.equal(matches.length,1);const c=matches[0];assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),s.label);
 const binding=execFileSync('docker',['port',c,internal+'/tcp'],{encoding:'utf8',windowsHide:true}).trim();assert.match(binding,/^127\.0\.0\.1:\d+$/);const port=binding.split(':').at(-1);
 if(kind==='storage'){for(const k of ['S3_PUBLIC_ENDPOINT','S3_PUBLIC_URL']){const url=new URL(r.env[k]);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));records.push({key:k,oldPort:url.port,newPort:port});url.port=port;r.env[k]=url.toString().replace(/\/$/,'');}}
 else {records.push({key,oldPort:r.env[key],newPort:port});r.env[key]=port;if(kind==='postgres'){const url=new URL(r.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');url.port=port;r.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL=url.toString();}}
}
await writeFile(join(dir,'runtime-private.json'),JSON.stringify(r,null,2),{mode:0o600});await writeFile('.tmp/1831-root-checks/fixture-restart-ports.json',JSON.stringify({onlyOwnedLoopbackEndpoints:true,bindings:records,qualification:'Docker reallocated ephemeral host ports on restart. Earlier connection refusal happened before tests and is not product or red-regression evidence. Credentials, data and app origin are unchanged.'},null,2)+'\n');console.log('Reconciled only private owned-fixture ports from verified Docker bindings.');
