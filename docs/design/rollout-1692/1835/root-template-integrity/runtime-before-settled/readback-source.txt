import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { integrationAdminPool, verifySuiteDatabase, closeIntegrationPools } from '@/test/integration-database';
async function main() {
const [pointer,stage,name]=process.argv.slice(2);
assert.ok(pointer&&stage&&name);const root=resolve(process.env.Z8_1835_REPO??'');assert.ok(process.env.Z8_1835_REPO);process.chdir(root);
const { fixtureFromPointer } = await import('./common.mjs');
const {fixture,runtime}=await fixtureFromPointer(resolve(pointer));assert.equal(runtime.env.POSTGRES_DB,process.env.POSTGRES_DB);
const actor=fixture.actors['small-admin'];assert.ok(actor?.organizationId&&actor?.employeeId);
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
try{
 await verifySuiteDatabase();const pool=integrationAdminPool();
 const {rows:[employee]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[actor.employeeId,actor.organizationId]);assert.ok(employee?.user_id);
 const [policy,schedule,day,assignment,settings,time]=await Promise.all([
  pool.query('select * from work_policy where organization_id=$1 order by id',[actor.organizationId]),
  pool.query('select s.* from work_policy_schedule s join work_policy p on p.id=s.policy_id where p.organization_id=$1 order by s.id',[actor.organizationId]),
  pool.query('select d.* from work_policy_schedule_day d join work_policy_schedule s on s.id=d.schedule_id join work_policy p on p.id=s.policy_id where p.organization_id=$1 order by d.id',[actor.organizationId]),
  pool.query('select * from work_policy_assignment where organization_id=$1 order by id',[actor.organizationId]),
  pool.query('select * from user_settings where user_id=$1 order by id',[employee.user_id]),
  pool.query('select * from time_entry where organization_id=$1 order by id',[actor.organizationId]),
 ]);
 const activeDefaults=assignment.rows.filter(row=>row.assignment_type==='organization'&&row.is_active);assert.equal(activeDefaults.length,1,'Own baseline requires one active organization default');
 const defaultIds=new Set(activeDefaults.map(row=>row.policy_id)),defaultSchedules=schedule.rows.filter(row=>defaultIds.has(row.policy_id)),defaultScheduleIds=new Set(defaultSchedules.map(row=>row.id));
 const defaultGraph={policy:policy.rows.filter(row=>defaultIds.has(row.id)),schedule:defaultSchedules,day:day.rows.filter(row=>defaultScheduleIds.has(row.schedule_id)),assignment:activeDefaults};
 const namedPolicy=policy.rows.filter(row=>row.name===name),namedPolicyIds=new Set(namedPolicy.map(row=>row.id)),namedSchedule=schedule.rows.filter(row=>namedPolicyIds.has(row.policy_id)),namedScheduleIds=new Set(namedSchedule.map(row=>row.id));
 const order=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'],namedDay=day.rows.filter(row=>namedScheduleIds.has(row.schedule_id)).sort((a,b)=>order.indexOf(a.day_of_week)-order.indexOf(b.day_of_week));
 const preferences=settings.rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['onboarding_step','updated_at'].includes(key))));
 const graph={policy:policy.rows,schedule:schedule.rows,day:day.rows,assignment:assignment.rows};
 console.log(JSON.stringify({stage,name,graph:{counts:{policy:policy.rows.length,schedule:schedule.rows.length,day:day.rows.length,assignment:assignment.rows.length},rowHash:sha(graph)},defaultGraphHash:sha(defaultGraph),recordedTimeHash:sha(time.rows),userSettingsHash:sha(settings.rows),preferencesWithoutProgressHash:sha(preferences),onboardingStep:settings.rows[0]?.onboarding_step??null,named:{policyIds:namedPolicy.map(row=>row.id),scheduleIds:namedSchedule.map(row=>row.id),dayIds:namedDay.map(row=>row.id),isDefault:namedPolicy[0]?.is_default??null,hoursPerCycle:namedSchedule[0]?String(Number(namedSchedule[0].hours_per_cycle)):null,days:namedDay.map(row=>({day:row.day_of_week,isWorkDay:row.is_work_day,hoursPerDay:Number(row.hours_per_day).toFixed(1)}))}}));
}finally{await closeIntegrationPools();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
