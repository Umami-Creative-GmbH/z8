import {Effect,Layer} from 'effect';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {AuthService} from '@/lib/effect/services/auth.service';
import {DatabaseService} from '@/lib/effect/services/database.service';
import {OnboardingServiceLive} from '@/lib/effect/services/onboarding.service';
const state=vi.hoisted(()=>({org:'org-a' as string|null,user:'actor',role:'member',status:'approved',isActive:true,policies:[] as any[],progress:[] as any[]}));
vi.mock('next/headers',()=>({headers:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:{api:{getSession:vi.fn()}},runAuthMutation:async(fn:()=>unknown)=>fn()}));
vi.mock('@/lib/user-preferences/user-settings-mutation',()=>({writeUserSettings:async(_db:unknown,userId:string,value:unknown)=>{state.progress.push({userId,value})}}));
vi.mock('@/lib/effect/runtime',async()=>{
 const {runtimeModuleOver}=await import('@/test/effect-runtime');
 const db={insert:()=>({values:async(value:unknown)=>{state.policies.push(value)}}),query:{member:{findFirst:async()=>({role:state.role,status:state.status})},employee:{findFirst:async()=>({isActive:state.isActive})}}};
 const auth=Layer.succeed(AuthService,AuthService.of({getSession:()=>Effect.succeed({user:{id:state.user},session:{activeOrganizationId:state.org}} as never)}));
 const database=Layer.succeed(DatabaseService,DatabaseService.of({db:db as never,query:(_name,query)=>Effect.promise(query) as never}));
 return runtimeModuleOver(OnboardingServiceLive.pipe(Layer.provide(auth),Layer.provide(database)));
});
import {checkIsAdmin,createVacationPolicyOnboarding,skipVacationPolicySetup} from '@/app/[locale]/onboarding/vacation-policy/actions';
const values={name:'Standard',defaultAnnualDays:25,accrualType:'annual' as const,allowCarryover:true,maxCarryoverDays:5};
beforeEach(()=>{state.org='org-a';state.user='actor';state.role='owner';state.status='approved';state.isActive=true;state.policies=[];state.progress=[]});
describe('Independent actual public vacation action with production OnboardingService and boundary adapters',()=>{
 it.each(['owner','admin'])('admits approved %s and retains existing policy payload meaning',async role=>{state.role=role;const result=await createVacationPolicyOnboarding(values);expect(result.success).toBe(true);expect(state.policies).toHaveLength(1);expect(state.policies[0]).toMatchObject({organizationId:'org-a',name:'Standard',defaultAnnualDays:'25',accrualType:'annual',allowCarryover:true,maxCarryoverDays:'5',carryoverExpiryMonths:3,isCompanyDefault:true,prorateInStartAndExitYear:true});expect(state.progress).toEqual([{userId:'actor',value:{onboardingStep:'work_templates'}}])});
 it('retains hidden carryover limit while disabling expiry',async()=>{await createVacationPolicyOnboarding({...values,allowCarryover:false,maxCarryoverDays:7});expect(state.policies[0]).toMatchObject({allowCarryover:false,maxCarryoverDays:'7',carryoverExpiryMonths:null})});
 it('skips without creating policy',async()=>{expect((await skipVacationPolicySetup()).success).toBe(true);expect(state.policies).toEqual([]);expect(state.progress).toHaveLength(1)});
 it.each(['create','skip'])('refuses %s for a member even though session is valid',async action=>{state.role='member';expect((await checkIsAdmin()).data).toBe(false);const result=await(action==='create'?createVacationPolicyOnboarding(values):skipVacationPolicySetup());expect(result.success).toBe(false);expect(state.policies).toEqual([]);expect(state.progress).toEqual([])});
 it.each(['create','skip'])('refuses %s after the admitted administrator loses authority',async action=>{state.role='admin';expect((await checkIsAdmin()).data).toBe(true);state.role='member';const result=await(action==='create'?createVacationPolicyOnboarding(values):skipVacationPolicySetup());expect.soft(result.success).toBe(false);expect.soft(state.policies).toEqual([]);expect(state.progress).toEqual([])});
 it.each(['create','skip'])('refuses %s with no active organization',async action=>{state.org=null;const result=await(action==='create'?createVacationPolicyOnboarding(values):skipVacationPolicySetup());expect(result.success).toBe(false);expect(state.policies).toEqual([]);expect(state.progress).toEqual([])});
 it('refuses pending-admin page admission',async()=>{state.role='admin';state.status='pending';expect((await checkIsAdmin()).data).toBe(false)});
 it('refuses former-owner page admission',async()=>{state.role='owner';state.isActive=false;expect((await checkIsAdmin()).data).toBe(false)});
});
