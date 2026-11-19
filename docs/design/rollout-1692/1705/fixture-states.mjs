// Owned fixture setup after boundary probes; no production or response substitution.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const dir=resolve(process.argv[2]), mode=process.argv[3];
const json=async f=>JSON.parse(await readFile(join(dir,f),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const {Client}=createRequire(resolve('apps/webapp/package.json'))('pg');const db=new Client({connectionString:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});await db.connect();
try {
 const admin=fixture.actors['small-admin'];
 if(mode==='original-roster') {
  // The real invitation probe created this additional employee, outside the original eight-person history.
  const result=await db.query(`update employee e set is_active=false from "user" u where e.user_id=u.id and e.organization_id=$1 and u.email=$2 and e.is_active=true returning e.id`,[admin.organizationId,fixture.actors['large-admin'].email]);
  assert.equal(result.rowCount,1);console.log('Excluded only the ninth probe-created employee; original eight fixture records unchanged.');
 } else if(mode==='allowances') {
  for(const [actor,annual,carryover] of [[admin,0,0],[fixture.actors['small-manager'],25,3]]) {
   assert.equal((await db.query('select 1 from employee e join "user" u on u.id=e.user_id where e.id=$1 and e.organization_id=$2 and u.email=$3',[actor.employeeId,actor.organizationId,actor.email])).rowCount,1);
   const inserted=await db.query(`insert into employee_vacation_allowance (employee_id,year,custom_annual_days,custom_carryover_days,updated_at) values ($1,2026,$2,$3,now()) returning id`,[actor.employeeId,annual,carryover]);
   assert.equal(inserted.rowCount,1);
  }
  console.log('Added owned stored allowance examples: configured zero and 25+3; other source rows unchanged.');
 } else throw Error('Expected original-roster or allowances');
}finally{await db.end();}
