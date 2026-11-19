// Owned disposable synthetic configuration only; never alters immutable check evidence.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const repo=process.cwd(),dir=resolve(process.argv[2]),mode=process.argv[3];
const json=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const {Pool}=createRequire(join(repo,'apps/webapp/package.json'))('pg'),pool=new Pool({host:runtime.env.POSTGRES_HOST,port:Number(runtime.env.POSTGRES_PORT),database:runtime.env.POSTGRES_DB,user:runtime.env.POSTGRES_USER,password:runtime.env.POSTGRES_PASSWORD});
const a=fixture.actors['small-admin'];
try {
 if(mode==='revoke')await pool.query('update driving_licence_verifier_grant set revoked_at=now(),revoked_by=granted_by where organization_id=$1 and verifier_employee_id=$2 and revoked_at is null',[a.organizationId,a.employeeId]);
 else if(mode==='restore')await pool.query('update driving_licence_verifier_grant set revoked_at=null,revoked_by=null where organization_id=$1 and verifier_employee_id=$2',[a.organizationId,a.employeeId]);
 else if(mode==='off'||mode==='on')await pool.query('update driving_licence_policy set enabled=$2 where organization_id=$1',[a.organizationId,mode==='on']);
 else if(mode==='inspect'){
  const e=fixture.actors['small-employee'];
  console.log(JSON.stringify((await pool.query('select correction from driving_licence_supplement where organization_id=$1 and employee_id=$2',[a.organizationId,e.employeeId])).rows));
 }
 else if(mode==='ended'){
  const {rows:[ended]}=await pool.query("select employee_id from driving_authorization where organization_id=$1 and state='ended' limit 1",[a.organizationId]);
  console.log(JSON.stringify(ended));
 } else if(mode==='former'){
  const {rows:[ended]}=await pool.query("select employee_id from driving_authorization where organization_id=$1 and state='ended' limit 1",[a.organizationId]);
  await pool.query('update employee set is_active=false,deactivated_at=now() where organization_id=$1 and id=$2',[a.organizationId,ended.employee_id]);
 } else throw Error('Unsupported fixture-only operation');
 console.log('Completed guarded synthetic configuration operation: '+mode);
} finally {await pool.end();}
