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
if(process.argv[3]==='seed')try{
 const a=fixture.actors['small-admin'],holder=fixture.actors['small-employee'];
 const {rows:[prior]}=await pool.query('select count(*)::int as n from equipment_type where organization_id=$1',[a.organizationId]);assert.equal(prior.n,0,'Use a new fixture');
 await pool.query('update organization set equipment_enabled=true where id=$1',[a.organizationId]);
 await pool.query('insert into equipment_policy(organization_id,retention_months) values($1,24)',[a.organizationId]);
 const type=randomUUID(),quantity=randomUUID();
 await pool.query("insert into equipment_type(id,organization_id,name,tracking_mode,default_return_required) values($1,$2,'Fixture laptops','individual',true),($3,$2,'Fixture shirts','quantity',true)",[type,a.organizationId,quantity]);
 for(const [identifier,status,custody] of [['EQ-HELD','available',true],['EQ-READY','available',false],['EQ-DAMAGED','unavailable',false],['EQ-RETIRED','retired',false]]){
  const id=randomUUID();await pool.query('insert into equipment_item(id,organization_id,type_id,identifier,serial_number,status,in_custody) values($1,$2,$3,$4,$5,$6,$7)',[id,a.organizationId,type,identifier,'SERIAL-'+identifier,status,custody]);
  if(custody){const assignment=randomUUID();await pool.query("insert into equipment_assignment(id,organization_id,item_id,type_id,employee_id,return_required,explicit_deadline) values($1,$2,$3,$4,$5,true,'2026-11-01')",[assignment,a.organizationId,id,type,holder.employeeId]);await pool.query("insert into equipment_handover(organization_id,assignment_id,kind,quantity,actual_date,condition,notes) values($1,$2,'issue',1,'2026-10-01','good','Synthetic baseline holding')",[a.organizationId,assignment]);}
 }
 const partial=randomUUID();await pool.query('insert into equipment_assignment(id,organization_id,type_id,employee_id,quantity,received_quantity,return_required) values($1,$2,$3,$4,3,2,true)',[partial,a.organizationId,quantity,holder.employeeId]);
 await pool.query("insert into equipment_handover(organization_id,assignment_id,kind,quantity,actual_date,condition) values($1,$2,'issue',3,'2026-10-01','good'),($1,$2,'receipt',2,'2026-10-10','worn')",[a.organizationId,partial]);
 console.log('Seeded small-organization synthetic holdings (including 1/3 partial), ready/damaged/retired items. Large organization stays feature-off.');
}finally{await pool.end();}
