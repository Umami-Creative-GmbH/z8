// Only generated, label-owned local fixture data. No ambient application env.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
export const repo=process.cwd(),dir=resolve(process.argv[2]);
const json=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
export const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json');
const services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);assert.equal(new URL(runtime.origin).hostname,'localhost');
for(const c of services.containers){assert.match(c,/^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);}
const {Pool}=createRequire(join(repo,'apps/webapp/package.json'))('pg');
export const pool=new Pool({host:runtime.env.POSTGRES_HOST,port:Number(runtime.env.POSTGRES_PORT),database:runtime.env.POSTGRES_DB,user:runtime.env.POSTGRES_USER,password:runtime.env.POSTGRES_PASSWORD});
