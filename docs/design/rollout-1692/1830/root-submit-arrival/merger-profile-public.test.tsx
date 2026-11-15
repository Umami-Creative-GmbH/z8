/* @vitest-environment jsdom */
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {Activity} from 'react';
import {flushSync} from 'react-dom';
import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({save:vi.fn(),skip:vi.fn(),push:vi.fn(),success:vi.fn(),error:vi.fn(),session:{data:null as null|{user:{id:string},session:{activeOrganizationId:string|null}},isPending:false}}));
vi.mock('@tolgee/react',()=>({useTranslate:()=>({t:(_key:string,fallback?:string)=>fallback??_key})}));
vi.mock('next-intl',()=>({useLocale:()=> 'en'}));
vi.mock('sonner',()=>({toast:{success:mocks.success,error:mocks.error}}));
vi.mock('@/navigation',()=>({useRouter:()=>({push:mocks.push})}));
vi.mock('@/lib/auth-client',()=>({useSession:()=>mocks.session}));
vi.mock('@/app/[locale]/onboarding/profile/actions',()=>({updateProfileOnboarding:mocks.save,skipProfileSetup:mocks.skip}));
import ProfilePage from '@/app/[locale]/onboarding/profile/page';
function deferred<T>(){let resolve!:(v:T)=>void;let reject!:(e:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};}
const result={success:true,data:{nextStep:'/onboarding/wellness'}};
function page(mode:'visible'|'hidden'='visible'){return <Activity mode={mode}><main><ProfilePage/></main></Activity>}
function names(){fireEvent.change(screen.getByLabelText('First Name'),{target:{value:'Retained'}});fireEvent.change(screen.getByLabelText('Last Name'),{target:{value:'Profile'}});}
function save(){return screen.getByRole('button',{name:'Save and continue'})}
function skip(){return screen.getByRole('button',{name:'Skip for now'})}
beforeAll(()=>{global.ResizeObserver=class {observe(){}unobserve(){}disconnect(){}};});
beforeEach(()=>{vi.clearAllMocks();mocks.save.mockReset();mocks.skip.mockReset();mocks.session.data={user:{id:'account-a'},session:{activeOrganizationId:'org-a'}};mocks.session.isPending=false;mocks.save.mockResolvedValue(result);mocks.skip.mockResolvedValue(result);});
afterEach(()=>cleanup());
describe('Independent real profile composition and event arrival',()=>{
 it.each(['initial','pending-known','signed-out','ready-no-org','ready-org'])('keeps one main task heading for %s session state',state=>{
  if(state==='initial'||state==='signed-out')mocks.session.data=null;
  mocks.session.isPending=state==='initial'||state==='pending-known';
  if(state==='ready-no-org')mocks.session.data!.session.activeOrganizationId=null;
  render(page());
  const main=screen.getByRole('main');expect(within(main).getAllByRole('heading',{level:1})).toHaveLength(1);expect(within(main).getByRole('heading',{level:1}).textContent).toBe('Complete your profile');
  expect(within(main).getByRole('navigation',{name:'Onboarding progress'})).toBeTruthy();
  expect(save()).toHaveProperty('disabled',state==='initial'||state==='pending-known'||state==='signed-out');
 });
 it('focuses the last invalid field while retaining the first valid name',async()=>{
  render(page());fireEvent.change(screen.getByLabelText('First Name'),{target:{value:'Retained'}});fireEvent.click(save());
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByLabelText('Last Name')));expect(screen.getByLabelText('First Name')).toHaveProperty('value','Retained');expect(mocks.save).not.toHaveBeenCalled();
 });
 it('selects a leap birthday through the actual calendar and sends a date-only value',async()=>{
  render(page());names();fireEvent.click(screen.getByRole('button',{name:'Birthday (Optional)'}));
  const year=screen.getByRole('combobox',{name:'Choose the Year'});fireEvent.change(year,{target:{value:'2000'}});
  const month=screen.getByRole('combobox',{name:'Choose the Month'});fireEvent.change(month,{target:{value:'1'}});
  const day=screen.getByRole('button',{name:/Tuesday, February 29/});fireEvent.click(day);
  fireEvent.keyDown(document.activeElement??document.body,{key:'Escape',code:'Escape'});fireEvent.click(save());
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({birthday:'2000-02-29'})));
 });
 it.each(['organization','pending','hidden','unmount'])('discards save intent queued before %s arrival',async boundary=>{
  const view=render(page());names();
  act(()=>{
   fireEvent.click(save());
   flushSync(()=>{
    if(boundary==='organization'){mocks.session.data!.session.activeOrganizationId='org-b';view.rerender(page());}
    else if(boundary==='pending'){mocks.session.isPending=true;view.rerender(page());}
    else if(boundary==='hidden')view.rerender(page('hidden'));
    else view.unmount();
   });
  });
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,40));});
  expect(mocks.save).not.toHaveBeenCalled();expect(mocks.push).not.toHaveBeenCalled();
 });
 it('keeps one action when save and Skip events arrive in the same turn',async()=>{
  mocks.save.mockReturnValue(new Promise(()=>{}));mocks.skip.mockReturnValue(new Promise(()=>{}));render(page());names();
  act(()=>{fireEvent.click(save());fireEvent.click(skip());});await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
  expect(mocks.save.mock.calls.length+mocks.skip.mock.calls.length).toBe(1);
 });
 it.each(['save','skip'])('ignores an old %s rejection across org A-B-A then permits retry',async action=>{
  const request=deferred<never>();(action==='save'?mocks.save:mocks.skip).mockReturnValueOnce(request.promise);
  const view=render(page());names();fireEvent.click(action==='save'?save():skip());await waitFor(()=>expect(action==='save'?mocks.save:mocks.skip).toHaveBeenCalledOnce());
  mocks.session.data!.session.activeOrganizationId='org-b';view.rerender(page());mocks.session.data!.session.activeOrganizationId='org-a';view.rerender(page());
  await act(async()=>request.reject(new Error('private stale exception')));
  expect(mocks.error).not.toHaveBeenCalled();expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByLabelText('First Name')).toHaveProperty('value','Retained');expect(save()).toHaveProperty('disabled',false);
  fireEvent.click(action==='save'?save():skip());await waitFor(()=>expect(mocks.push).toHaveBeenCalledWith('/onboarding/wellness'));
 });
 it('does not show one account draft to the next account',()=>{
  const view=render(page());names();mocks.session.data!.user.id='account-b';view.rerender(page());expect(screen.getByLabelText('First Name')).toHaveProperty('value','');expect(screen.getByLabelText('Last Name')).toHaveProperty('value','');
 });
});
