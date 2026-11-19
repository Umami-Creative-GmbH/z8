// Guarded fixture setup/readback only: business uploads always use the application.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const dir=resolve(process.argv[2]),mode=process.argv[3],read=async n=>JSON.parse(await readFile(join(dir,n),'utf8'));
const r=await read('runtime-private.json'),f=await read('fixture-private.json'),services=await read('services.json');
assert.equal(f.kind,'disposable');assert.equal(r.env.POSTGRES_HOST,'127.0.0.1');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const {Client}=createRequire(resolve('apps/webapp/package.json'))('pg'),db=new Client({connectionString:r.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});await db.connect();
try {
const holder=f.actors['small-employee'],org=holder.organizationId;
if(mode==='seed'){
 const grant=randomUUID(),holderUser=(await db.query('select user_id from employee where id=$1 and organization_id=$2',[holder.employeeId,org])).rows[0].user_id;
 const people=(await db.query('select e.id,e.user_id from employee e where e.organization_id=$1 and e.id<>$2 order by e.id',[org,holder.employeeId])).rows;
 const covered=people.slice(0,3),former=covered[2];
 await db.query('begin');
 for(const [i,p] of people.entries())await db.query('update employee set employee_number=$1 where id=$2 and organization_id=$3',[`R043-${i+1}`,p.id,org]);
 await db.query('update employee set is_active=false where id=$1 and organization_id=$2',[former.id,org]);
 await db.query("insert into payroll_access_grant(id,organization_id,payroll_employee_id,scope,is_active,created_by,updated_by,updated_at) values($1,$2,$3,'specific',true,$4,$4,now())",[grant,org,holder.employeeId,holderUser]);
 for(const p of covered)await db.query('insert into payroll_access_employee(organization_id,grant_id,employee_id,created_by) values($1,$2,$3,$4)',[org,grant,p.id,holderUser]);
 // Approved second membership and distinct covered records prove settled destination scope.
 const other=f.actors['large-admin'].organizationId,otherHolder=randomUUID(),otherGrant=randomUUID();
 await db.query("insert into member(id,organization_id,user_id,role,status,created_at) values($1,$2,$3,'member','approved',now())",[randomUUID(),other,holderUser]);
 await db.query("insert into employee(id,organization_id,user_id,role,is_active,start_date,updated_at) values($1,$2,$3,'employee',true,'2025-01-01',now())",[otherHolder,other,holderUser]);
 await db.query("insert into payroll_access_grant(id,organization_id,payroll_employee_id,scope,is_active,created_by,updated_by,updated_at) values($1,$2,$3,'specific',true,$4,$4,now())",[otherGrant,other,otherHolder,holderUser]);
 const target=f.actors['large-restricted'].employeeId;
 await db.query('update employee set employee_number=$1 where id=$2 and organization_id=$3',['B-R043',target,other]);
 await db.query('insert into payroll_access_employee(organization_id,grant_id,employee_id,created_by) values($1,$2,$3,$4)',[other,otherGrant,target,holderUser]);
 await db.query('commit');
 await writeFile(join(dir,'r043-private.json'),JSON.stringify({org,grant,holderUser,covered,former,people,other,otherHolder,otherGrant,target}));
 console.log('Seeded three covered identities including one former employee and a distinct second-organization grant/record.');
}else{
 const s=await read('r043-private.json');
 if(mode==='readback')console.log(JSON.stringify((await db.query("select employee_id,kind,to_char(day,'YYYY-MM-DD') as recorded_day,minutes,reason,cancelled_at is not null as cancelled from balance_adjustment where organization_id=$1 and employee_id=any($2) order by recorded_at",[org,s.covered.map(x=>x.id)])).rows));
 else if(mode==='revoke'||mode==='restore')await db.query('update payroll_access_grant set is_active=$1 where id=$2 and organization_id=$3',[mode==='restore',s.grant,org]);
 else if(mode==='empty'||mode==='unempty'){
  if(mode==='empty')await db.query('delete from payroll_access_employee where grant_id=$1 and organization_id=$2',[s.grant,org]);
  else for(const p of s.covered)await db.query('insert into payroll_access_employee(organization_id,grant_id,employee_id,created_by) values($1,$2,$3,$4) on conflict do nothing',[org,s.grant,p.id,s.holderUser]);
 }else throw Error('Unknown operation');
}
}catch(e){await db.query('rollback');throw e;}finally{await db.end();}
