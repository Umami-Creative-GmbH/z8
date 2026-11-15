/* @vitest-environment jsdom */
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Activity} from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({summary:vi.fn(),create:vi.fn(),skip:vi.fn(),slug:vi.fn(),push:vi.fn(),replace:vi.fn(),error:vi.fn(),success:vi.fn(),scope:{user:'a',session:'s-a',org:''}}));
vi.mock('@tolgee/react',()=>({useTranslate:()=>({t:(_key:string,fallback?:string)=>fallback??_key})}));
vi.mock('sonner',()=>({toast:{success:mocks.success,error:mocks.error}}));
vi.mock('@/navigation',()=>({useRouter:()=>({push:mocks.push,replace:mocks.replace})}));
vi.mock('@/lib/auth-client',()=>({useSession:()=>({data:{user:{id:mocks.scope.user},session:{id:mocks.scope.session,activeOrganizationId:mocks.scope.org}}})}));
vi.mock('@/app/[locale]/(app)/organization-actions',()=>({checkSlugAvailability:mocks.slug}));
vi.mock('@/app/[locale]/onboarding/organization/actions',()=>({getOnboardingSummary:mocks.summary,createOrganizationOnboarding:mocks.create,skipOrganizationSetup:mocks.skip}));
import OrganizationPageClient from '@/app/[locale]/onboarding/organization/organization-page-client';
function deferred<T>() {let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};}
const noMembership={success:true,data:{hasOrganization:false}};
const membership={success:true,data:{hasOrganization:true}};
beforeEach(()=>{vi.clearAllMocks();for(const mock of [mocks.summary,mocks.create,mocks.skip,mocks.slug])mock.mockReset();Object.assign(mocks.scope,{user:'a',session:'s-a',org:''});mocks.summary.mockResolvedValue(noMembership);mocks.slug.mockResolvedValue(true);mocks.skip.mockResolvedValue({success:true});});
afterEach(()=>{cleanup();vi.useRealTimers()});
describe('Independent public onboarding arrival and response probes',()=>{
 it('retains exactly one task heading while membership detection is held',()=>{
  mocks.summary.mockReturnValue(new Promise(()=>{}));
  render(<OrganizationPageClient canCreateOrganizations/>);
  expect(screen.getByRole('status',{name:'Checking organization membership'})).toBeTruthy();
  expect(screen.queryAllByRole('button',{name:'Create Organization'})).toHaveLength(0);
  expect(screen.queryAllByRole('heading',{level:1})).toHaveLength(1);
 });
 it.each(['user','session','org'] as const)('ignores a held old membership summary after %s arrival',async key=>{
  const old=deferred<typeof membership>(),current=deferred<typeof noMembership>();
  mocks.summary.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const view=render(<OrganizationPageClient canCreateOrganizations/>);
  mocks.scope[key]='new';view.rerender(<OrganizationPageClient canCreateOrganizations/>);
  await act(async()=>current.resolve(noMembership));
  fireEvent.change(await screen.findByLabelText('Organization Name'),{target:{value:'Current account draft'}});
  await act(async()=>old.resolve(membership));
  expect(mocks.skip).not.toHaveBeenCalled();expect(mocks.replace).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Organization Name')).toHaveProperty('value','Current account draft');
 });
 it('ignores held automatic Skip success after organization A to B to A',async()=>{
  const oldSkip=deferred<{success:true}>();
  mocks.summary.mockResolvedValueOnce(membership).mockResolvedValue(noMembership);mocks.skip.mockReturnValueOnce(oldSkip.promise);
  const view=render(<OrganizationPageClient canCreateOrganizations/>);
  await waitFor(()=>expect(mocks.skip).toHaveBeenCalledOnce());
  for(const org of ['b','']){mocks.scope.org=org;view.rerender(<OrganizationPageClient canCreateOrganizations/>);await screen.findByLabelText('Organization Name');}
  fireEvent.change(screen.getByLabelText('Organization Name'),{target:{value:'Returned draft'}});
  await act(async()=>oldSkip.resolve({success:true}));
  expect(mocks.replace).not.toHaveBeenCalled();expect(mocks.push).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Organization Name')).toHaveProperty('value','Returned draft');
 });
 it('recovers from a rejected automatic Skip through a deliberate retry',async()=>{
  mocks.summary.mockResolvedValue(membership);mocks.skip.mockRejectedValueOnce(new Error('transport lost')).mockResolvedValueOnce({success:true});
  render(<OrganizationPageClient canCreateOrganizations/>);
  const retry=await screen.findByRole('button',{name:'Skip for now'});
  expect(mocks.replace).not.toHaveBeenCalled();fireEvent.click(retry);
  await waitFor(()=>expect(mocks.push).toHaveBeenCalledWith('/onboarding/profile'));
  expect(mocks.skip).toHaveBeenCalledTimes(2);
 });
 it('retains input after authoritative create refusal and permits Skip under disabled policy',async()=>{
  const request=deferred<{success:false,error:string}>();mocks.create.mockReturnValue(request.promise);
  const view=render(<OrganizationPageClient canCreateOrganizations trackingSuggestedAt="2026-06-01T23:30:00Z"/>);
  fireEvent.change(await screen.findByLabelText('Organization Name'),{target:{value:'Retain refusal draft'}});
  fireEvent.change(screen.getByLabelText('Time tracking start date'),{target:{value:'2026-06-04'}});
  fireEvent.click(screen.getByRole('button',{name:'Create Organization'}));
  await waitFor(()=>expect(mocks.create).toHaveBeenCalledOnce());
  view.rerender(<OrganizationPageClient canCreateOrganizations={false} trackingSuggestedAt="2026-06-01T23:30:00Z"/>);
  await act(async()=>request.resolve({success:false,error:'Organization creation is disabled for this deployment.'}));
  expect(screen.getByRole('alert').textContent).toContain('disabled');expect(mocks.push).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Organization Name')).toBeNull();
  view.rerender(<OrganizationPageClient canCreateOrganizations trackingSuggestedAt="2026-06-01T23:30:00Z"/>);
  expect(screen.getByLabelText('Organization Name')).toHaveProperty('value','Retain refusal draft');
  expect(screen.getByLabelText('Time tracking start date')).toHaveProperty('value','2026-06-04');
  view.rerender(<OrganizationPageClient canCreateOrganizations={false}/>);
  fireEvent.click(screen.getByRole('button',{name:'Skip for now'}));await waitFor(()=>expect(mocks.push).toHaveBeenCalledOnce());
 });
 it('retains duplicate prevention across Activity reconnect and clears only after refusal',async()=>{
  const request=deferred<{success:false,error:string}>();mocks.create.mockReturnValue(request.promise);
  const body=(mode:'visible'|'hidden')=><Activity mode={mode}><OrganizationPageClient canCreateOrganizations/></Activity>;
  const view=render(body('visible'));
  fireEvent.change(await screen.findByLabelText('Organization Name'),{target:{value:'Pending draft'}});
  fireEvent.click(screen.getByRole('button',{name:'Create Organization'}));await waitFor(()=>expect(mocks.create).toHaveBeenCalledOnce());
  view.rerender(body('hidden'));view.rerender(body('visible'));
  const create=await screen.findByRole('button',{name:'Create Organization'}),skip=screen.getByRole('button',{name:'Skip for now'});
  expect(create).toHaveProperty('disabled',true);expect(skip).toHaveProperty('disabled',true);fireEvent.click(skip);expect(mocks.skip).not.toHaveBeenCalled();
  await act(async()=>request.resolve({success:false,error:'Refused old visit'}));
  expect(screen.queryByText('Refused old visit')).toBeNull();expect(mocks.error).not.toHaveBeenCalled();
  await waitFor(()=>expect(create).toHaveProperty('disabled',false));
 });
});
