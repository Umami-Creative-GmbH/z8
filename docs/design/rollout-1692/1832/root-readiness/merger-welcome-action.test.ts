import {Effect,Layer} from 'effect';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {AuthenticationError,DatabaseError} from '@/lib/effect/errors';
import {AuthService} from '@/lib/effect/services/auth.service';
import {DatabaseService} from '@/lib/effect/services/database.service';
import {OnboardingServiceLive} from '@/lib/effect/services/onboarding.service';
const state=vi.hoisted(()=>({user:'a',org:'org-a' as string|null,authenticated:true,failWrite:false,writes:[] as {userId:string,value:Record<string,unknown>}[]}));
vi.mock('next/headers',()=>({headers:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:{api:{getSession:vi.fn()}},runAuthMutation:async(fn:()=>unknown)=>fn()}));
vi.mock('@/lib/user-preferences/user-settings-mutation',()=>({writeUserSettings:async(_db:unknown,userId:string,value:Record<string,unknown>)=>{if(state.failWrite)throw new Error('controlled database refusal');state.writes.push({userId,value})}}));
vi.mock('@/lib/effect/runtime',async()=>{
 const {runtimeModuleOver}=await import('@/test/effect-runtime');
 const auth=Layer.succeed(AuthService,AuthService.of({getSession:()=>state.authenticated?Effect.succeed({user:{id:state.user},session:{activeOrganizationId:state.org}} as never):Effect.fail(new AuthenticationError({message:'Sign in required'}))}));
 const db={query:{user:{findFirst:async()=>({invitedVia:null})},member:{findFirst:async()=>null},employee:{findFirst:async()=>null},notificationPreference:{findFirst:async()=>null},userSettings:{findFirst:async()=>null}}};
 const database=Layer.succeed(DatabaseService,DatabaseService.of({db:db as never,query:(name,query)=>Effect.tryPromise({try:query,catch:cause=>new DatabaseError({message:'Could not save setup',operation:name,cause})}) as never}));
 return runtimeModuleOver(OnboardingServiceLive.pipe(Layer.provide(auth),Layer.provide(database)));
});
import {getOnboardingSummary,startOnboarding,updateOnboardingStep} from '@/app/[locale]/onboarding/welcome/actions';
beforeEach(()=>{state.user='a';state.org='org-a';state.authenticated=true;state.failWrite=false;state.writes=[]});
describe('Independent public welcome actions with production OnboardingService and request/database adapters',()=>{
 it('initializes the authenticated user through the existing settings writer',async()=>{expect((await startOnboarding()).success).toBe(true);expect(state.writes).toHaveLength(1);expect(state.writes[0]).toMatchObject({userId:'a',value:{onboardingStep:'welcome'}});expect(state.writes[0].value.onboardingStartedAt).toBeInstanceOf(Date)});
 it.each(['profile','organization'])('retains the exact %s step payload and current user ownership',async step=>{state.user='b';expect((await updateOnboardingStep(step)).success).toBe(true);expect(state.writes).toEqual([{userId:'b',value:{onboardingStep:step}}])});
 it.each(['start','summary','step'])('refuses unauthenticated %s without mutating settings',async operation=>{state.authenticated=false;const result=await(operation==='start'?startOnboarding():operation==='summary'?getOnboardingSummary():updateOnboardingStep('profile'));expect(result.success).toBe(false);expect(result).toMatchObject({code:'AuthenticationError'});expect(state.writes).toEqual([])});
 it('returns a retryable database refusal and permits a later accepted step',async()=>{state.failWrite=true;expect(await updateOnboardingStep('profile')).toMatchObject({success:false,code:'DatabaseError'});expect(state.writes).toEqual([]);state.failWrite=false;expect((await updateOnboardingStep('profile')).success).toBe(true);expect(state.writes).toHaveLength(1)});
 it('does not require an organization for the account-level initialization owner',async()=>{state.org=null;expect((await startOnboarding()).success).toBe(true);expect((await getOnboardingSummary())).toMatchObject({success:true,data:{hasOrganization:false,isAdmin:false}});expect(state.writes).toHaveLength(1)});
});
