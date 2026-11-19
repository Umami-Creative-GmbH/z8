import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {integrationAdminPool,verifySuiteDatabase,closeIntegrationPools} from '@/test/integration-database';
async function main(){
await verifySuiteDatabase();
const directory=resolve('../../.tmp/1734-independent-checks/runtime');
const fixture=JSON.parse(await readFile(resolve(directory,'fixture-private.json'),'utf8'));
if(fixture.kind!=='disposable')throw Error('Disposable fixture required');
const pool=integrationAdminPool();
try{
 const actor=fixture.actors['small-admin'],target=fixture.actors['small-employee'];
 await pool.query('update organization set personnel_files_enabled=true where id=any($1::text[])',[[actor.organizationId,fixture.actors['large-admin'].organizationId]]);
 const {rows:[category]}=await pool.query("insert into absence_category (organization_id,type,name,requires_approval,counts_against_vacation,updated_at) values ($1,'sick','Synthetic independent sick leave',false,false,now()) returning id",[actor.organizationId]);
 const {rows:people}=await pool.query('select id from employee where organization_id=$1 and id<>all($2::uuid[]) order by id',[actor.organizationId,[actor.employeeId,fixture.actors['small-manager'].employeeId,fixture.actors['small-restricted'].employeeId,target.employeeId]]);
 const former=people[0].id;await pool.query('update employee set is_active=false where id=$1 and organization_id=$2',[former,actor.organizationId]);
 const absences=[];
 for(let i=0;i<12;i++){
  const employeeId=i<3?target.employeeId:i===3?former:i===4?fixture.actors['small-manager'].employeeId:people[(i-5)%people.length].id;
  const day=`2026-11-${String(i+1).padStart(2,'0')}`;
  const {rows:[entry]}=await pool.query("insert into absence_entry (employee_id,organization_id,category_id,start_date,end_date,status,sick_detail,updated_at) values ($1,$2,$3,$4,$4,$5,$6,now()) returning id",[employeeId,actor.organizationId,category.id,day,i%2?'pending':'approved',['with_certificate','without_certificate','child_sick','other'][i%4]]);
  absences.push({id:entry.id,employeeId,day});
 }
 await writeFile(resolve(directory,'r051-private.json'),JSON.stringify({categoryId:category.id,former,absences,target:target.employeeId,organizationId:actor.organizationId},null,2));
 console.log('Seeded 12 own synthetic absences, initial feature configuration and one synthetic former employee through the guarded integration helper. No auth/member/grant mutation.');
}finally{await closeIntegrationPools();}
}
main().catch(()=>{console.error('Guarded synthetic seed failed; private log retained.');process.exitCode=1;});
