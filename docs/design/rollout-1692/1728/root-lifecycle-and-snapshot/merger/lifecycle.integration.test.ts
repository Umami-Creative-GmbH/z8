import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {db} from '@/db';
import {integrationAdminPool} from '@/test/integration-database';
import {parseInstant,instantFromDate} from '@/lib/datetime/temporal-core';
import {createDepartureCommands} from '@/lib/employee-lifecycle/commands';
import {resolveEmployeeOrganizationAccess} from '@/lib/employee-lifecycle/access';
import {listManagedEmployees,resolvePersonnelFileAccess} from '@/lib/personnel-file/access-store';
import {listExpiringDocuments} from '@/lib/personnel-file/expiry-store';
it('marks the retained personnel-file record former at the canonical cutoff before materialization, then recovers after rehire',async()=>{
 const out=resolve('../../.tmp/merge1728-audit'),fixture=JSON.parse(readFileSync(resolve(out,'fixture/fixture-private.json'),'utf8')),admin=fixture.actors['small-admin'],target=fixture.actors['small-restricted'],pool=integrationAdminPool(),observations:any={qualification:'Real PostgreSQL canonical lifecycle commands and canonical public readers; controlled domain clock, no browser clock manipulation, no SQL authority/grant changes.'};
 let now=parseInstant('2027-05-01T08:00:00Z');
 for(const person of [admin,target])person.userId=(await pool.query('select user_id from employee where organization_id=$1 and id=$2',[person.organizationId,person.employeeId])).rows[0].user_id;
 const actor={userId:admin.userId,organizationId:admin.organizationId};
 const commands=createDepartureCommands({db,clock:{nowInstant:()=>now},clockOut:{async close(){return{kind:'not_running' as const};}}});
 const snapshot=async()=>{const access=await resolvePersonnelFileAccess(db,{...actor,now});expect(access).not.toBeNull();const row=(await listManagedEmployees(db,access!)).find(e=>e.id===target.employeeId);const attention=await listExpiringDocuments(db,access!,{now});return{at:now.toString(),directory:row,expiryRows:attention.filter(e=>e.employeeId===target.employeeId).length,canonicalAccess:await resolveEmployeeOrganizationAccess(db,{userId:target.userId,organizationId:target.organizationId,now})};};
 try{
  const period=(await pool.query(`select id from employee_employment_period where organization_id=$1 and employee_id=$2 and status='open'`,[target.organizationId,target.employeeId])).rows[0];expect(period).toBeTruthy();
  observations.before=await snapshot();expect(observations.before.directory.isActive).toBe(true);expect(observations.before.expiryRows).toBe(2);
  const scheduled=await commands.scheduleDeparture(actor,{employeeId:target.employeeId,requestId:randomUUID(),expectedRevision:null,lastWorkingDay:'2027-05-01',replacementEmployeeId:null,acknowledgeUnassignedDuties:true});observations.scheduled=scheduled;
  const stored=(await pool.query('select cutoff_at,status from employee_departure where id=$1',[scheduled.departureId])).rows[0];now=instantFromDate(stored.cutoff_at);observations.cutoff=await snapshot();observations.cutoff.departureStatus=stored.status;
  observations.executed=await commands.executeDeparture({organizationId:target.organizationId,employeeId:target.employeeId,employmentPeriodId:period.id,departureId:scheduled.departureId,revision:scheduled.revision});observations.materialized=await snapshot();expect(observations.executed.status).toBe('effective');expect(observations.materialized.directory.isActive).toBe(false);expect(observations.materialized.expiryRows).toBe(0);
  const policy=(await pool.query('select id from work_policy where organization_id=$1 order by id limit 1',[target.organizationId])).rows[0];expect(policy).toBeTruthy();now=now.add({hours:24});
  observations.rehire=await commands.rehireEmployee(actor,{employeeId:target.employeeId,requestId:randomUUID(),previousEmploymentPeriodId:period.id,role:'employee',teamId:null,primaryManagerId:null,workPolicyId:policy.id,weeklyContractMinutes:2400,contractType:'fixed',workModel:'hybrid',hourlyRate:null,currency:'EUR',probationStartsOn:null,probationEndsOn:null,changeReason:'Synthetic merger lifecycle probe'});
  observations.rehired=await snapshot();expect(observations.rehired.directory.isActive).toBe(true);expect(observations.rehired.expiryRows).toBe(2);expect(observations.rehired.canonicalAccess.allowed).toBe(true);
  expect(observations.cutoff.canonicalAccess.allowed).toBe(false);expect(observations.cutoff.expiryRows).toBe(0);expect(observations.cutoff.directory.isActive,'Cutoff-effective former employee must be marked former before deferred materialization').toBe(false);
 }finally{writeFileSync(resolve(out,'lifecycle-observations.json'),JSON.stringify(observations,null,2));}
},120000);
