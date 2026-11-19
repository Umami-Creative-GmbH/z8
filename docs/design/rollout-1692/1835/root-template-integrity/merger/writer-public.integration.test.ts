import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createLifecycleDatabaseFixture,type LifecycleDatabaseFixture} from '@/lib/employee-lifecycle/testing/database.test.fixture';
import {verifySuiteDatabase} from '@/test/integration-database';
const arrival=vi.hoisted(()=>({userId:'',organizationId:null as string|null}));
vi.mock('next/headers',async()=> (await import('@/test/integration-harness')).nextHeaders());
vi.mock('next/server',async original=> (await import('@/test/integration-harness')).nextServer(original));
vi.mock('next/cache',async original=> (await import('@/test/integration-harness')).nextCache(original));
// The sole authority stand-in is the established request/session boundary. All
// action, AuthService, settings facts, OnboardingService and DB code are real.
vi.mock('@/lib/auth/request-session',()=>({getRequestSession:async()=>({user:{id:arrival.userId,role:'user',name:'Audit fixture',email:'audit@example.test'},session:{id:'owned-audit-request',userId:arrival.userId,activeOrganizationId:arrival.organizationId}})}));
import {checkIsAdmin,createWorkTemplateOnboarding,skipWorkTemplateSetup} from '@/app/[locale]/onboarding/work-templates/actions';
const observations:unknown[]=[];
const destination=resolve(process.cwd(),'../../.tmp/merge1835-audit/pg-observations.json');
function record(value:unknown){observations.push(value);writeFileSync(destination,JSON.stringify(observations,null,2)+'\n');}
let fixture:LifecycleDatabaseFixture;
const input=()=>({name:'Audit '+randomUUID(),hoursPerWeek:32.5,workingDays:['monday','tuesday','wednesday','thursday'] as Array<'monday'|'tuesday'|'wednesday'|'thursday'>,setAsDefault:false});
async function snapshot(org=fixture.organizationId,user=arrival.userId){
 const [policy,schedule,days,assignment,settings,time]=await Promise.all([
  fixture.pool.query('select * from work_policy where organization_id=$1 order by id',[org]),
  fixture.pool.query('select s.* from work_policy_schedule s join work_policy p on p.id=s.policy_id where p.organization_id=$1 order by s.id',[org]),
  fixture.pool.query('select d.* from work_policy_schedule_day d join work_policy_schedule s on s.id=d.schedule_id join work_policy p on p.id=s.policy_id where p.organization_id=$1 order by d.id',[org]),
  fixture.pool.query('select * from work_policy_assignment where organization_id=$1 order by id',[org]),
  fixture.pool.query('select * from user_settings where user_id=$1',[user]),
  fixture.pool.query('select * from time_entry where organization_id=$1 order by id',[org]),
 ]);return {policy:policy.rows,schedule:schedule.rows,days:days.rows,assignment:assignment.rows,settings:settings.rows,time:time.rows};
}
beforeEach(async()=>{await verifySuiteDatabase();fixture=await createLifecycleDatabaseFixture();arrival.userId=fixture.ownerUserId;arrival.organizationId=fixture.organizationId;});
afterEach(async()=>{await fixture?.close();});
describe('R040 production public actions on owned disposable PostgreSQL',()=>{
 vi.setConfig({testTimeout:60000,hookTimeout:60000});
 it('creates the exact nondefault four-day schedule without changing recorded work',async()=>{
  const before=await snapshot();expect(await checkIsAdmin()).toMatchObject({success:true,data:true});const result=await createWorkTemplateOnboarding(input());const after=await snapshot();record({case:'nondefault-control',result,before,after});
  expect(result.success).toBe(true);expect(after.policy).toHaveLength(1);expect(after.schedule).toHaveLength(1);expect(after.schedule[0].hours_per_cycle).toBe('32.50');expect(after.days).toHaveLength(7);expect(after.days.filter(d=>d.is_work_day).map(d=>d.hours_per_day)).toEqual(['8.10','8.10','8.10','8.10']);expect(after.assignment).toHaveLength(0);expect(after.time).toEqual(before.time);expect(after.settings[0].onboarding_step).toBe('wellness');
 });
 it('refuses a second organization default without leaving a partial graph',async()=>{
  expect((await createWorkTemplateOnboarding({...input(),setAsDefault:true})).success).toBe(true);
  const before=await snapshot();const result=await createWorkTemplateOnboarding({...input(),setAsDefault:true});const after=await snapshot();record({case:'existing-default-atomicity',result,before,after});
  expect(result.success).toBe(false);expect(after).toEqual(before);
 });
 it('rolls back a valid-schema daily numeric overflow after schedule insertion',async()=>{
  const before=await snapshot();const result=await Reflect.apply(createWorkTemplateOnboarding,undefined,[{...input(),hoursPerWeek:168,workingDays:['monday']}]);const after=await snapshot();record({case:'day-overflow-atomicity',result,before,after});
  expect(result.success).toBe(false);expect(after).toEqual(before);
 });
 it.each([['empty-name',{name:''}],['over-week-limit',{hoursPerWeek:169}],['unknown-day',{workingDays:['funday']}]] as const)('refuses malformed public input %s before any persistence',async(label,change)=>{
  const before=await snapshot();const result=await Reflect.apply(createWorkTemplateOnboarding,undefined,[{...input(),...change}]);const after=await snapshot();record({case:'malformed-'+label,result,before,after});
  expect(result).toMatchObject({success:false,code:'ValidationError'});expect(after).toEqual(before);
 });
 it('keeps an empty selected week at seven zero-hour rows under the existing schema',async()=>{
  const result=await Reflect.apply(createWorkTemplateOnboarding,undefined,[{...input(),workingDays:[]}]);const after=await snapshot();record({case:'existing-empty-day-semantics',result,after});expect(result.success).toBe(true);expect(after.days).toHaveLength(7);expect(after.days.every(d=>d.hours_per_day==='0.00'&&!d.is_work_day)).toBe(true);
 });
 it('preserves the existing duplicate-day denominator without inventing a formula change',async()=>{
  const result=await Reflect.apply(createWorkTemplateOnboarding,undefined,[{...input(),hoursPerWeek:40,workingDays:['monday','monday']}]);const after=await snapshot();record({case:'existing-duplicate-day-semantics',result,after});expect(result.success).toBe(true);expect(after.days).toHaveLength(7);expect(after.days.filter(d=>d.is_work_day).map(d=>({day:d.day_of_week,hours:d.hours_per_day}))).toEqual([{day:'monday',hours:'20.00'}]);
 });
 it('keeps canonical former-admin admission and the public create action aligned',async()=>{
  const former=await fixture.seedEmployee({role:'admin',isActive:false,withPeriod:false});arrival.userId=former.userId;
  const admission=await checkIsAdmin();const before=await snapshot();const result=await createWorkTemplateOnboarding(input());const after=await snapshot();record({case:'former-admin-create',admission,result,before,after});
  expect(admission).toMatchObject({success:true,data:false});expect(result).toMatchObject({success:false,code:'AuthorizationError'});expect(after).toEqual(before);
 });
 it('keeps canonical former-admin admission and public skip aligned',async()=>{
  const former=await fixture.seedEmployee({role:'admin',isActive:false,withPeriod:false});arrival.userId=former.userId;
  const admission=await checkIsAdmin();const before=await snapshot();const result=await skipWorkTemplateSetup();const after=await snapshot();record({case:'former-admin-skip',admission,result,before,after});
  expect(admission).toMatchObject({success:true,data:false});expect(result).toMatchObject({success:false,code:'AuthorizationError'});expect(after).toEqual(before);
 });
 it('refuses an A-arrival command after the session selects another authorized organization',async()=>{
  // Ordinary initial fixture creation only: no existing membership is changed,
  // removed, demoted or restored. Both contexts are authorized before dispatch.
  const orgA=fixture.organizationId,orgB=await fixture.createOrganization();
  await fixture.pool.query("insert into member(id,organization_id,user_id,role,status,created_at) values($1,$2,$3,'admin','approved',now())",[randomUUID(),orgB,arrival.userId]);
  expect(await checkIsAdmin()).toMatchObject({success:true,data:true});const draft=input(),expected={userId:arrival.userId,organizationId:orgA};
  const beforeA=await snapshot(orgA),beforeB=await snapshot(orgB);arrival.organizationId=orgB;expect(await checkIsAdmin()).toMatchObject({success:true,data:true});
  // Current UI sends only its draft. The current action has no compared arrival
  // hint. This establishes the gap, not an existing optional-argument contract.
  const result=await createWorkTemplateOnboarding(draft);const afterA=await snapshot(orgA),afterB=await snapshot(orgB);record({case:'two-authorized-org-arrival',expected,serverSelectedOrganization:orgB,result,beforeA,beforeB,afterA,afterB});
  expect(result).toMatchObject({success:false});expect(afterA).toEqual(beforeA);expect(afterB).toEqual(beforeB);
 });
 it('refuses a real fixture member and leaves graph and progress unchanged',async()=>{
  const member=await fixture.seedEmployee({withPeriod:false});arrival.userId=member.userId;const before=await snapshot();const result=await createWorkTemplateOnboarding(input());const skip=await skipWorkTemplateSetup();const after=await snapshot();record({case:'member-control',result,skip,before,after});expect(await checkIsAdmin()).toMatchObject({success:true,data:false});expect(result).toMatchObject({success:false,code:'AuthorizationError'});expect(skip).toMatchObject({success:false,code:'AuthorizationError'});expect(after).toEqual(before);
 });
});
