// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Activity } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { EmployeeBalanceWorkspace } from '@/components/payroll/employee-balance-workspace';
import { RecordOvertimePayoutDialog } from '@/components/settings/work-balance/record-overtime-payout-dialog';
import { CancelBalanceAdjustmentDialog } from '@/components/settings/work-balance/cancel-balance-adjustment-dialog';
import Page from '@/app/[locale]/(app)/payroll/work-balances/[employeeId]/page';

const mocks = vi.hoisted(() => ({read:vi.fn(),opening:vi.fn(),payout:vi.fn(),cancel:vi.fn(),saved:vi.fn(),scope:{userId:'holder',activeOrganizationId:'org',isLoading:false}}));
vi.mock('sonner',()=>({toast:{success:mocks.saved,error:vi.fn()}}));
vi.mock('@/app/[locale]/(app)/settings/employees/work-balance-actions',()=>({getEmployeeWorkBalanceSectionAction:mocks.read,setOpeningBalanceAction:mocks.opening,recordOvertimePayoutAction:mocks.payout,cancelBalanceAdjustmentAction:mocks.cancel}));
vi.mock('@/app/[locale]/(app)/payroll/work-balances/[employeeId]/actions',()=>({getPayrollEmployeeBalanceAction:mocks.read}));
vi.mock('@/hooks/use-organization',()=>({useOrganization:()=>mocks.scope}));
vi.mock('@/lib/auth-helpers',()=>({getAuthContext:vi.fn()}));
vi.mock('@/app/[locale]/(app)/payroll/work-balances/coverage',()=>({loadPayrollWorkBalanceEmployees:vi.fn()}));
vi.mock('@tolgee/react',()=>({useTolgee:()=>({getLanguage:()=> 'en'}),useTranslate:()=>({t:(_key:string,fallback:string,values?:Record<string,unknown>)=>fallback.replace(/\{(\w+)\}/g,(_,key:string)=>String(values?.[key]??key))})}));
vi.mock('@/hooks/use-display-context',()=>({useDisplayContext:()=>({locale:'en',timezone:'UTC'})}));
vi.mock('@/navigation',()=>({Link:(props:React.ComponentProps<'a'>)=><a {...props}/> }));
const employee={id:'employee',name:'Former covered employee',isActive:false,employeeNumber:'0044'};
const adjustment={id:'opening',kind:'opening_balance',day:'2026-11-01',minutes:600,reason:'Original evidence',recordedAt:'2026-11-01T10:00:00Z',recordedBy:{userId:'holder',name:'Payroll holder'},cancellation:null};
const data={balance:null,adjustments:[adjustment],today:'2026-11-15',timezone:'Europe/Berlin',canManage:true};
const clients:QueryClient[]=[];
function mount() {
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});clients.push(client);
 const route=(mode:'visible'|'hidden'='visible')=><QueryClientProvider client={client}><Activity mode={mode}><EmployeeBalanceWorkspace employee={employee} organizationId="org" userId="holder"/></Activity></QueryClientProvider>;
 return {client,route,...render(route())};
}
async function openPayout() {
 fireEvent.click(await screen.findByRole('button',{name:'Record overtime payout'}));
 const panel=await screen.findByRole('dialog');
 fireEvent.change(within(panel).getByRole('spinbutton',{name:/^Hours/}),{target:{value:'1'}});
 fireEvent.change(within(panel).getByRole('textbox',{name:/^Reason/}),{target:{value:'Retained payroll evidence'}});
 const form=panel.querySelector('form');if(!form)throw Error('Missing real form');return {panel,form};
}
afterEach(()=>{cleanup();for(const client of clients.splice(0))client.clear();vi.resetAllMocks();mocks.scope={userId:'holder',activeOrganizationId:'org',isLoading:false};});

it('retains the R044 task main heading during its actual server suspense fallback',()=>{
 const page=Page({params:Promise.resolve({employeeId:'employee'})});
 render(page.props.fallback);
 expect(screen.getByRole('status',{name:'Loading the work balance'})).toBeTruthy();
 expect(screen.queryAllByRole('heading',{level:1})).toHaveLength(1);
});

it('retains a safe task main heading while the R044 server arrival mismatches current actor scope',()=>{
 mocks.scope={userId:'holder',activeOrganizationId:'different-org',isLoading:false};mount();
 expect(screen.getByRole('status').textContent).toContain('Loading the current payroll scope');
 expect(screen.queryByText(employee.name)).toBeNull();
 expect(screen.queryAllByRole('heading',{level:1})).toHaveLength(1);
});

it('does not duplicate a still-pending payroll command after cached Activity reveal',async()=>{
 mocks.read.mockResolvedValue({success:true,data});let finish!:(value:unknown)=>void;
 mocks.payout.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const view=mount();const {form}=await openPayout();fireEvent.submit(form);
 await waitFor(()=>expect(mocks.payout).toHaveBeenCalledTimes(1));
 view.rerender(view.route('hidden'));view.rerender(view.route());
 const returned=await screen.findByRole('dialog');
 fireEvent.submit(returned.querySelector('form')!);
 await act(async()=>{await Promise.resolve();});
 expect(mocks.payout).toHaveBeenCalledTimes(1);
 await act(async()=>finish({success:false,code:'ValidationError',refusal:'exceeds_balance',error:'hidden diagnostic'}));
});

it.each(['hidden','revealed'])('recovers a cached payout draft when its departed completion settles while %s',async(phase)=>{
 mocks.read.mockResolvedValue({success:true,data});let finish!:(value:unknown)=>void;
 mocks.payout.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const view=mount();const {form}=await openPayout();fireEvent.submit(form);
 await waitFor(()=>expect(mocks.payout).toHaveBeenCalledTimes(1));
 view.rerender(view.route('hidden'));
 if(phase==='revealed')view.rerender(view.route());
 await act(async()=>finish({success:true,data:{adjustmentId:'saved-before-hide'}}));
 if(phase==='hidden')view.rerender(view.route());
 const returned=await screen.findByRole('dialog');
 expect((within(returned).getByRole('textbox',{name:/^Reason/}) as HTMLTextAreaElement).value).toBe('Retained payroll evidence');
 await waitFor(()=>expect(within(returned).getByRole('button',{name:'Record payout'}).hasAttribute('disabled')).toBe(false));
 expect(mocks.saved).not.toHaveBeenCalled();
 fireEvent.click(within(returned).getByRole('button',{name:'Cancel'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});

it('retains the opening draft across ordinary shared-prefix invalidation',async()=>{
 mocks.read.mockResolvedValue({success:true,data});const view=mount();
 fireEvent.click(await screen.findByRole('button',{name:'Set opening balance'}));
 const panel=await screen.findByRole('dialog');
 fireEvent.change(within(panel).getByRole('textbox',{name:/^Reason/}),{target:{value:'Keep this reason during global refresh'}});
 await act(async()=>view.client.invalidateQueries({queryKey:['employeeWorkBalanceSection']}));
 expect((screen.getByRole('textbox',{name:/^Reason/}) as HTMLTextAreaElement).value).toBe('Keep this reason during global refresh');
 expect(mocks.read).toHaveBeenCalledTimes(2);
});

it('keeps a late cancellation completion from a departed actor out of its returned arrival',async()=>{
 mocks.read.mockResolvedValue({success:true,data});let finish!:(value:unknown)=>void;
 mocks.cancel.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const view=mount();await screen.findByText('Original evidence');
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));const panel=await screen.findByRole('dialog');
 fireEvent.change(within(panel).getByRole('textbox',{name:/^Why is it cancelled/}),{target:{value:'Cancellation evidence'}});
 fireEvent.submit(panel.querySelector('form')!);await waitFor(()=>expect(mocks.cancel).toHaveBeenCalledTimes(1));
 mocks.scope={userId:'other',activeOrganizationId:'org',isLoading:false};view.rerender(view.route());
 expect(screen.queryByText('Original evidence')).toBeNull();
 mocks.scope={userId:'holder',activeOrganizationId:'org',isLoading:false};view.rerender(view.route());
 await screen.findByText('Original evidence');await act(async()=>finish({success:true,data:{}}));
 expect(mocks.saved).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();
});

it('preserves offboarding final-payout Dialog title, typed default amount and refusal draft',async()=>{
 const record=vi.fn().mockRejectedValue(Error('transport private'));const changed=vi.fn();
 render(<RecordOvertimePayoutDialog open onOpenChange={changed} today="2026-11-15" initial={{day:'2026-11-14',amountMinutes:95}} title="Record final overtime payout" onRecord={record}/>);
 const panel=await screen.findByRole('dialog');expect(within(panel).getByText('Record final overtime payout')).toBeTruthy();
 expect((within(panel).getByRole('spinbutton',{name:/^Hours/}) as HTMLInputElement).value).toBe('1');
 expect((within(panel).getByRole('spinbutton',{name:/^Minutes/}) as HTMLInputElement).value).toBe('35');
 fireEvent.change(within(panel).getByRole('textbox',{name:/^Reason/}),{target:{value:'Final wages evidence'}});
 fireEvent.submit(panel.querySelector('form')!);await screen.findByRole('alert');
 expect(record).toHaveBeenCalledWith({day:'2026-11-14',hours:1,minutes:35,reason:'Final wages evidence'});
 expect(changed).not.toHaveBeenCalled();expect(screen.queryByText('transport private')).toBeNull();
});

it('keeps the existing cancellation Dialog reason validation and evidence identity',async()=>{
 const cancel=vi.fn();render(<CancelBalanceAdjustmentDialog adjustment={{id:'adjustment-44',summary:'Overtime payout -1:00h, 14 November'}} onOpenChange={vi.fn()} onCancelAdjustment={cancel}/>);
 const panel=await screen.findByRole('dialog');fireEvent.submit(panel.querySelector('form')!);
 await waitFor(()=>expect(within(panel).getByRole('textbox',{name:/^Why is it cancelled/}).getAttribute('aria-invalid')).toBe('true'));
 expect(cancel).not.toHaveBeenCalled();expect(document.activeElement).toBe(within(panel).getByRole('textbox',{name:/^Why is it cancelled/}));
 expect(within(panel).getByText(/^Overtime payout -1:00h, 14 November\./)).toBeTruthy();
});
