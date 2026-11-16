/* @vitest-environment jsdom */
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Activity} from 'react';
import {flushSync} from 'react-dom';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const boundary=vi.hoisted(()=>({session:{data:{user:{id:'audit-a'},session:{activeOrganizationId:'audit-org-a'}},isPending:false},check:vi.fn(),save:vi.fn(),skip:vi.fn(),push:vi.fn(),success:vi.fn(),error:vi.fn()}));
vi.mock('@tolgee/react',()=>({useTranslate:()=>({t:(_k:string,f?:string,v?:Record<string,unknown>)=>v?Object.entries(v).reduce((s,[k,x])=>s.replace(`{${k}}`,String(x)),f??_k):f??_k})}));
vi.mock('next-intl',()=>({useLocale:()=> 'en'}));
vi.mock('@/lib/auth-client',()=>({useSession:()=>boundary.session}));
vi.mock('@/navigation',()=>({useRouter:()=>({push:boundary.push})}));
vi.mock('sonner',()=>({toast:{success:boundary.success,error:boundary.error}}));
vi.mock('@/app/[locale]/onboarding/work-templates/actions',()=>({checkIsAdmin:boundary.check,createWorkTemplateOnboarding:boundary.save,skipWorkTemplateSetup:boundary.skip}));
import WorkTemplatesPage from '@/app/[locale]/onboarding/work-templates/page-client';
beforeEach(()=>{vi.clearAllMocks();boundary.session={data:{user:{id:'audit-a'},session:{activeOrganizationId:'audit-org-a'}},isPending:false};boundary.check.mockResolvedValue({success:true,data:true});boundary.save.mockResolvedValue({success:true});boundary.skip.mockResolvedValue({success:true});});
afterEach(()=>vi.useRealTimers());
describe('R040 public native submission arrival contract',()=>{
 it.each(['Activity-return','session-reconnect','account-return','organization-return'] as const)('retires Save queued before %s and permits a fresh save',async(change)=>{
  const page=(mode:'visible'|'hidden'='visible')=><Activity mode={mode}><WorkTemplatesPage/></Activity>;
  const view=render(page());const input=await screen.findByLabelText('Template Name');fireEvent.change(input,{target:{value:'Audit retained draft'}});
  act(()=>{
   fireEvent.submit(input.closest('form')!);
   flushSync(()=>{if(change==='session-reconnect')boundary.session.isPending=true;else if(change==='account-return')boundary.session.data.user.id='audit-b';else if(change==='organization-return')boundary.session.data.session.activeOrganizationId='audit-org-b';view.rerender(page(change==='Activity-return'?'hidden':'visible'));});
   flushSync(()=>{boundary.session.isPending=false;boundary.session.data.user.id='audit-a';boundary.session.data.session.activeOrganizationId='audit-org-a';view.rerender(page());});
  });
  await act(async()=>{});
  expect(boundary.save).not.toHaveBeenCalled();expect(boundary.push).not.toHaveBeenCalled();expect(boundary.success).not.toHaveBeenCalled();
  await screen.findByLabelText('Template Name');fireEvent.submit(screen.getByLabelText('Template Name').closest('form')!);await waitFor(()=>expect(boundary.save).toHaveBeenCalledOnce());
 });
 it('reserves a native Save before TanStack validation so Skip cannot win the same gesture',async()=>{
  render(<WorkTemplatesPage/>);const input=await screen.findByLabelText('Template Name');
  act(()=>{fireEvent.submit(input.closest('form')!);fireEvent.click(screen.getByRole('button',{name:'Skip for now'}));});
  await act(async()=>{});expect(boundary.skip).not.toHaveBeenCalled();expect(boundary.save).toHaveBeenCalledOnce();
 });
 it('keeps the safe task heading while the initial account session is pending',()=>{
  boundary.session.isPending=true;render(<WorkTemplatesPage/>);expect(screen.getByRole('heading',{level:1}).textContent).toBe('Create work schedule template');expect(screen.queryByLabelText('Template Name')).toBeNull();expect(boundary.check).not.toHaveBeenCalled();
 });
});
