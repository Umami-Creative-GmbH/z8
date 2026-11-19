/* @vitest-environment jsdom */
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {Activity} from 'react';
import {flushSync} from 'react-dom';
import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({save:vi.fn(),skip:vi.fn(),check:vi.fn(),push:vi.fn(),success:vi.fn(),error:vi.fn(),listeners:new Set<(v:unknown)=>void>(),session:{data:{user:{id:'a'},session:{activeOrganizationId:'org-a' as string|null}},isPending:false}}));
vi.mock('@tolgee/react',()=>({useTranslate:()=>({t:(_key:string,fallback?:string)=>fallback??_key})}));
vi.mock('next-intl',()=>({useLocale:()=> 'en'}));
vi.mock('sonner',()=>({toast:{success:mocks.success,error:mocks.error}}));
vi.mock('@/navigation',()=>({useRouter:()=>({push:mocks.push})}));
vi.mock('@/lib/auth-client',()=>({useSession:()=>mocks.session,authClient:{$store:{atoms:{session:{subscribe:(f:(v:unknown)=>void)=>{mocks.listeners.add(f);return()=>mocks.listeners.delete(f)}}}}}}));
vi.mock('@/app/[locale]/onboarding/vacation-policy/actions',()=>({createVacationPolicyOnboarding:mocks.save,skipVacationPolicySetup:mocks.skip,checkIsAdmin:mocks.check}));
import VacationPage from '@/app/[locale]/onboarding/vacation-policy/page-client';
function deferred<T>(){let resolve!:(v:T)=>void;let reject!:(e:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
const page=(mode:'visible'|'hidden'='visible')=><Activity mode={mode}><main><VacationPage/></main></Activity>;
const save=()=>screen.getByRole('button',{name:'Save and continue'});
const skip=()=>screen.getByRole('button',{name:'Skip for now'});
const field=()=>screen.getByLabelText('Policy Name');
const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,30))});
function scope(user:string,org:string|null){mocks.session.data={user:{id:user},session:{activeOrganizationId:org}};for(const f of mocks.listeners)f({data:mocks.session.data});}
beforeAll(()=>{global.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}}});
beforeEach(()=>{vi.clearAllMocks();mocks.save.mockReset();mocks.skip.mockReset();mocks.check.mockReset();mocks.session={data:{user:{id:'a'},session:{activeOrganizationId:'org-a'}},isPending:false};mocks.check.mockResolvedValue({success:true,data:true});mocks.save.mockResolvedValue({success:true});mocks.skip.mockResolvedValue({success:true})});
afterEach(()=>cleanup());
describe('Independent assembled vacation route',()=>{
 it.each(['pending-session','held-access'])('keeps one semantic task heading during %s',state=>{if(state==='pending-session')mocks.session.isPending=true;else mocks.check.mockReturnValue(new Promise(()=>{}));render(page());expect(within(screen.getByRole('main')).queryAllByRole('heading',{level:1})).toHaveLength(1);expect(screen.queryByLabelText('Policy Name')).toBeNull()});
 it('keeps one task heading and real onboarding progress after admission',async()=>{render(page());await screen.findByLabelText('Policy Name');expect(within(screen.getByRole('main')).getAllByRole('heading',{level:1})).toHaveLength(1);expect(screen.getByRole('navigation',{name:'Onboarding progress'})).toBeTruthy()});
 it.each(['organization','account','pending','hidden','unmount'])('retires save queued before %s boundary',async boundary=>{
  const view=render(page());await screen.findByLabelText('Policy Name');
  act(()=>{fireEvent.click(save());flushSync(()=>{if(boundary==='organization')scope('a','org-b');else if(boundary==='account')scope('b','org-a');else if(boundary==='pending')mocks.session.isPending=true;else if(boundary==='hidden'){view.rerender(page('hidden'));return}else{view.unmount();return}view.rerender(page())})});
  await settle();expect(mocks.save).not.toHaveBeenCalled();expect(mocks.push).not.toHaveBeenCalled();
 });
 it.each(['account','organization'])('retires same-turn queued save across %s A-B-A',async kind=>{render(page());await screen.findByLabelText('Policy Name');act(()=>{fireEvent.click(save());scope(kind==='account'?'b':'a',kind==='organization'?'org-b':'org-a');scope('a','org-a')});await settle();expect(mocks.save).not.toHaveBeenCalled();expect(mocks.push).not.toHaveBeenCalled()});
 it.each(['save','skip'])('discards old %s completion after Activity re-entry and admits intentional retry',async action=>{const held=deferred<{success:true}>();(action==='save'?mocks.save:mocks.skip).mockReturnValueOnce(held.promise);const view=render(page());await screen.findByLabelText('Policy Name');fireEvent.change(field(),{target:{value:'Retained draft'}});fireEvent.click(action==='save'?save():skip());await waitFor(()=>expect(action==='save'?mocks.save:mocks.skip).toHaveBeenCalledOnce());view.rerender(page('hidden'));view.rerender(page());await screen.findByLabelText('Policy Name');await act(async()=>held.resolve({success:true}));expect(mocks.push).not.toHaveBeenCalled();expect(field()).toHaveProperty('value','Retained draft');fireEvent.click(action==='save'?save():skip());await waitFor(()=>expect(mocks.push).toHaveBeenCalledWith('/onboarding/work-templates'))});
 it('allows one operation from same-turn native save/skip/submit re-entry',async()=>{mocks.save.mockReturnValue(new Promise(()=>{}));mocks.skip.mockReturnValue(new Promise(()=>{}));render(page());await screen.findByLabelText('Policy Name');act(()=>{fireEvent.submit(save().closest('form')!);fireEvent.click(skip());fireEvent.submit(save().closest('form')!)});await settle();expect(mocks.save.mock.calls.length+mocks.skip.mock.calls.length).toBe(1)});
 it('focuses a required-name error and preserves the annual allowance',async()=>{render(page());await screen.findByLabelText('Policy Name');fireEvent.change(field(),{target:{value:''}});fireEvent.click(save());await waitFor(()=>expect(document.activeElement).toBe(field()));expect(screen.getByLabelText('Annual Vacation Days')).toHaveProperty('value','25');expect(mocks.save).not.toHaveBeenCalled()});
 it.each([-1,366])('refuses out-of-range annual days %s and preserves policy draft',async days=>{render(page());await screen.findByLabelText('Policy Name');fireEvent.change(field(),{target:{value:'Preserved'}});fireEvent.change(screen.getByLabelText('Annual Vacation Days'),{target:{value:String(days)}});fireEvent.submit(save().closest('form')!);await settle();expect(mocks.save).not.toHaveBeenCalled();expect(field()).toHaveProperty('value','Preserved')});
 it('preserves draft on transport refusal and succeeds on intentional retry',async()=>{mocks.save.mockRejectedValueOnce(new Error('private failure'));render(page());await screen.findByLabelText('Policy Name');fireEvent.change(field(),{target:{value:'Retry policy'}});fireEvent.click(save());await waitFor(()=>expect(save()).toHaveProperty('disabled',false));expect(field()).toHaveProperty('value','Retry policy');expect(mocks.error).toHaveBeenCalledWith('Failed to create vacation policy');fireEvent.click(save());await waitFor(()=>expect(mocks.push).toHaveBeenCalledWith('/onboarding/work-templates'))});
 it('keeps controls unavailable while access is held then routes a refused administrator',async()=>{const held=deferred<{success:true,data:false}>();mocks.check.mockReturnValueOnce(held.promise);render(page());expect(screen.queryByLabelText('Policy Name')).toBeNull();await act(async()=>held.resolve({success:true,data:false}));expect(mocks.push).toHaveBeenCalledWith('/onboarding/notifications');expect(screen.queryByLabelText('Policy Name')).toBeNull()});
 it('does not reuse an old queued save after immediate Activity hide/re-entry and a fresh save',async()=>{const view=render(page());await screen.findByLabelText('Policy Name');act(()=>{fireEvent.click(save());flushSync(()=>view.rerender(page('hidden')));flushSync(()=>view.rerender(page()))});await screen.findByLabelText('Policy Name');fireEvent.click(save());await waitFor(()=>expect(mocks.save).toHaveBeenCalledOnce());expect(mocks.save.mock.calls[0][0].name).toBe('Standard')});
});
