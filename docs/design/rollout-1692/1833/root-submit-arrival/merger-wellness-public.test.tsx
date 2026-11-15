/* @vitest-environment jsdom */
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Activity} from 'react';
import {flushSync} from 'react-dom';
import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
const {save,skip,push,success,error,session}=vi.hoisted(()=>({save:vi.fn(),skip:vi.fn(),push:vi.fn(),success:vi.fn(),error:vi.fn(),session:vi.fn()}));
vi.mock('@/lib/auth-client',()=>({useSession:session}));
vi.mock('@/navigation',()=>({useRouter:()=>({push})}));
vi.mock('sonner',()=>({toast:{success,error}}));
vi.mock('@tolgee/react',()=>({useTranslate:()=>({t:(_key:string,fallback?:string)=>fallback??_key})}));
vi.mock('@/app/[locale]/onboarding/wellness/actions',()=>({configureWellnessOnboarding:save,skipWellnessSetup:skip}));
import WellnessPage from '@/app/[locale]/onboarding/wellness/page-client';
type SessionValue={data:{user:{id:string};session:{activeOrganizationId:string|null}}|null;isPending:boolean};
let current:SessionValue;
const arrival=(user='account-a',org:string|null='org-a',pending=false):SessionValue=>({data:{user:{id:user},session:{activeOrganizationId:org}},isPending:pending});
const page=(mode:'visible'|'hidden'='visible')=><Activity mode={mode}><WellnessPage/></Activity>;
const continueButton=()=>screen.getByRole('button',{name:'Continue'});
const goal=()=>screen.getByRole('slider',{name:'Daily Goal'});
const settle=async()=>{await act(async()=>{});};
function deferred<T>(){let resolve!:(v:T)=>void;let reject!:(e:unknown)=>void;const promise=new Promise<T>((res,rej)=>{resolve=res;reject=rej});return {promise,resolve,reject};}
beforeAll(()=>{global.ResizeObserver=class ResizeObserver{observe(){} unobserve(){} disconnect(){}};});
afterEach(cleanup);
beforeEach(()=>{vi.resetAllMocks();current=arrival();session.mockImplementation(()=>current);save.mockResolvedValue({success:true});skip.mockResolvedValue({success:true});});
describe('Independent wellness public contract',()=>{
 it.each(['organization','organization-return','account-return','session-reconnect','Activity-return'])('discards a Save queued before %s and accepts a fresh action',async(boundary)=>{
  const view=render(page());fireEvent.keyDown(goal(),{key:'End'});
  act(()=>{
   fireEvent.click(continueButton());
   flushSync(()=>{
    if(boundary==='session-reconnect')current=arrival('account-a','org-a',true);
    else if(boundary==='account-return')current=arrival('account-b');
    else if(boundary!=='Activity-return')current=arrival('account-a','org-b');
    view.rerender(page(boundary==='Activity-return'?'hidden':'visible'));
   });
   if(boundary!=='organization')flushSync(()=>{current=arrival();view.rerender(page());});
  });
  await settle();
  expect(save).not.toHaveBeenCalled();expect(skip).not.toHaveBeenCalled();expect(push).not.toHaveBeenCalled();
  expect(goal().getAttribute('aria-valuenow')).toBe('20');
  fireEvent.click(continueButton());await waitFor(()=>expect(save).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith({enableWaterReminder:true,waterReminderPreset:'moderate',waterReminderIntervalMinutes:45,waterReminderDailyGoal:20});
  expect(push).toHaveBeenCalledWith('/onboarding/notifications');
 });
 it.each(['no-session','stale-session','settled-signed-out'])('retains one heading and no writable controls during %s',async(kind)=>{
  current=kind==='stale-session'?arrival('account-a','org-a',true):{data:null,isPending:kind==='no-session'};
  render(page());expect(screen.getAllByRole('heading',{level:1})).toHaveLength(1);expect(screen.getByRole('heading',{level:1,name:'Stay Hydrated'})).toBeTruthy();expect(screen.queryByRole('switch')).toBeNull();expect(screen.queryByRole('button',{name:'Continue'})).toBeNull();expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');expect(save).not.toHaveBeenCalled();
 });
 it.each(['save','skip'])('blocks a second personal write after pending-session return while %s is held, then permits retry',async(action)=>{
  const request=deferred<{success:false;error:string}>();(action==='save'?save:skip).mockReturnValueOnce(request.promise);
  const view=render(page());fireEvent.keyDown(goal(),{key:'End'});fireEvent.click(screen.getByRole('button',{name:action==='save'?'Continue':'Skip for now'}));await waitFor(()=>expect(action==='save'?save:skip).toHaveBeenCalledOnce());
  current=arrival('account-a','org-a',true);view.rerender(page());expect(screen.getAllByRole('heading',{level:1})).toHaveLength(1);expect(screen.queryByRole('switch')).toBeNull();
  current=arrival();view.rerender(page());expect(goal().getAttribute('aria-valuenow')).toBe('20');expect(continueButton()).toHaveProperty('disabled',true);
  const form=continueButton().closest('form');if(!form)throw Error('Expected real form');fireEvent.submit(form);await settle();expect(save).toHaveBeenCalledTimes(action==='save'?1:0);
  await act(async()=>request.resolve({success:false,error:'Obsolete refusal'}));expect(error).not.toHaveBeenCalled();expect(screen.queryByRole('alert')).toBeNull();expect(push).not.toHaveBeenCalled();
  fireEvent.click(continueButton());await waitFor(()=>expect(save).toHaveBeenCalledTimes(action==='save'?2:1));expect(push).toHaveBeenCalledOnce();
 });
 it('keeps personal saving available without an organization and recovers its exact retained draft',async()=>{
  current=arrival('account-a',null);save.mockResolvedValueOnce({success:false,error:'Sign in again'}).mockResolvedValueOnce({success:true});
  render(page());fireEvent.keyDown(goal(),{key:'End'});fireEvent.click(continueButton());expect(await screen.findByRole('alert')).toHaveProperty('textContent','Sign in again');expect(goal().getAttribute('aria-valuenow')).toBe('20');fireEvent.click(continueButton());await waitFor(()=>expect(push).toHaveBeenCalledOnce());expect(save).toHaveBeenLastCalledWith({enableWaterReminder:true,waterReminderPreset:'moderate',waterReminderIntervalMinutes:45,waterReminderDailyGoal:20});
 });
 it('prevents native Save while Skip is held and leaves every saved preference control unavailable',async()=>{
  const request=deferred<{success:true}>();skip.mockReturnValue(request.promise);render(page());fireEvent.click(screen.getByRole('button',{name:'Skip for now'}));await waitFor(()=>expect(skip).toHaveBeenCalledOnce());
  expect(screen.getByRole('switch')).toHaveProperty('disabled',true);expect(screen.getByLabelText('Reminder Frequency')).toHaveProperty('disabled',true);expect(goal()).toHaveProperty('disabled',true);
  const form=continueButton().closest('form');if(!form)throw Error('Expected real form');fireEvent.submit(form);await settle();expect(save).not.toHaveBeenCalled();await act(async()=>request.resolve({success:true}));expect(push).toHaveBeenCalledOnce();
 });
});
