import {Effect,Exit} from 'effect';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {OnboardingService} from '@/lib/effect/services/onboarding.service';
const mocks=vi.hoisted(()=>({update:vi.fn(),skip:vi.fn()}));
vi.mock('next/headers',()=>({headers:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:{api:{getSession:vi.fn()}}}));
vi.mock('@/lib/effect/result',()=>({runServerActionSafe:async (effect:any)=>Exit.match(await Effect.runPromiseExit(Effect.provideService(effect,OnboardingService,OnboardingService.of({updateProfile:mocks.update,skipProfileSetup:mocks.skip} as never))),{onSuccess:data=>({success:true,data}),onFailure:()=>({success:false,error:'refused'})})}));
import {updateProfileOnboarding} from '@/app/[locale]/onboarding/profile/actions';
beforeEach(()=>{mocks.update.mockReset();mocks.update.mockReturnValue(Effect.succeed({nextStep:'/onboarding/wellness'}));});
describe('Independent public profile save birthday boundary',()=>{
 it.each(['1900-01-01','2000-02-29',new Date('2000-02-29T23:59:59Z')])('accepts civil birthday %s as UTC midnight',async birthday=>{
  const response=await updateProfileOnboarding({firstName:'Ada',lastName:'Lovelace',birthday});expect(response.success).toBe(true);
  expect(mocks.update.mock.calls[0][0].birthday.toISOString()).toBe(typeof birthday==='string'?birthday+'T00:00:00.000Z':'2000-02-29T00:00:00.000Z');
 });
 it.each([new Date('1899-12-31T23:59:59Z'),new Date('2999-01-01T00:00:00Z'),new Date('invalid'),'1900-02-29','2000-02-30'])('refuses invalid/range birthday %s before writer',async birthday=>{
  const response=await updateProfileOnboarding({firstName:'Ada',lastName:'Lovelace',birthday});expect(response.success).toBe(false);expect(mocks.update).not.toHaveBeenCalled();
 });
});
