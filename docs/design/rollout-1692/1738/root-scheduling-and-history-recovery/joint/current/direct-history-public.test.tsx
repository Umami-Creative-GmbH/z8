// @vitest-environment jsdom
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {NextIntlClientProvider} from 'next-intl';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {UserPreferencesProvider} from '@/components/providers/user-preferences-provider';
import {BalanceAdjustmentHistoryDialog} from '@/components/work-balance/balance-adjustment-history-button';
const edge=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('@/app/[locale]/(app)/settings/employees/work-balance-actions',()=>({
 getEmployeeWorkBalanceSectionAction:edge.read,cancelBalanceAdjustmentAction:vi.fn(),recordOvertimePayoutAction:vi.fn(),setOpeningBalanceAction:vi.fn()
}));
vi.mock('@tolgee/react',()=>({useTranslate:()=>({t:(_key:string,fallback:string)=>fallback})}));
const clients:QueryClient[]=[];
const empty={success:true,data:{balance:null,adjustments:[],today:'2026-11-17',timezone:'Europe/Berlin',canManage:false}};
const records={...empty,data:{...empty.data,adjustments:[{id:'synthetic-adjustment',kind:'opening_balance',day:'2026-11-01',minutes:120,reason:'SYNTHETIC PUBLIC RECOVERED RECORD',recordedAt:'2026-11-01T08:00:00Z',recordedBy:{userId:'synthetic-actor',name:'Synthetic Admin'},cancellation:null}]}};
beforeEach(()=>{edge.read.mockReset();});
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());});
async function open(){
 const client=new QueryClient({defaultOptions:{queries:{staleTime:60_000,refetchOnWindowFocus:false,retryDelay:0}}});clients.push(client);
 render(<NextIntlClientProvider locale='en' messages={{}} timeZone='Europe/Berlin'><UserPreferencesProvider timezone='Europe/Berlin'><QueryClientProvider client={client}><BalanceAdjustmentHistoryDialog employeeId='synthetic-employee' trigger={<button type='button'>Synthetic balance history</button>}/></QueryClientProvider></UserPreferencesProvider></NextIntlClientProvider>);
 await userEvent.setup().click(screen.getByRole('button',{name:'Synthetic balance history'}));
 return client;
}
it('actual history hook serializes duplicate activation through failed read, held local Retry and nonempty recovery',async()=>{
 edge.read.mockRejectedValue(new Error('Synthetic transport failure'));
 await open();
 expect(await screen.findByRole('alert')).toBeTruthy();
 expect(screen.queryByText('No balance adjustments yet.')).toBeNull();
 expect(edge.read).toHaveBeenCalledTimes(4);
 let finish!:(v:unknown)=>void;
 edge.read.mockImplementation(()=>new Promise(r=>{finish=r;}));
 const retry=screen.getByRole('button',{name:'Retry'});
 await act(async()=>{fireEvent.click(retry);fireEvent.click(retry);fireEvent.click(retry);});
 await waitFor(()=>expect(edge.read).toHaveBeenCalledTimes(5));
 expect(screen.getAllByRole('dialog')).toHaveLength(1);
 expect(screen.getByLabelText('Loading balance adjustments')).toBeTruthy();
 await act(async()=>{finish(records);});
 expect(await screen.findByText('SYNTHETIC PUBLIC RECOVERED RECORD')).toBeTruthy();
 expect(screen.queryByRole('alert')).toBeNull();
 await userEvent.setup().keyboard('{Escape}');
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'Synthetic balance history'}));
 expect(edge.read).toHaveBeenCalledTimes(5);
});
it('successful empty and canonical refusal stay distinct without leaked refusal details',async()=>{
 edge.read.mockResolvedValue(empty);await open();
 expect(await screen.findByText('No balance adjustments yet.')).toBeTruthy();
 expect(screen.queryByRole('alert')).toBeNull();
 cleanup();clients.splice(0).forEach(c=>c.clear());edge.read.mockReset().mockResolvedValue({success:false,code:'AuthorizationError',error:'SYNTHETIC UNDISCLOSED REFUSAL DETAIL'});
 await open();
 expect((await screen.findByRole('alert')).textContent).toContain('employees you manage');
 expect(screen.queryByText('No balance adjustments yet.')).toBeNull();
 expect(screen.queryByText('SYNTHETIC UNDISCLOSED REFUSAL DETAIL')).toBeNull();
 expect(screen.queryByRole('button',{name:'Retry'})).toBeNull();
 expect(edge.read).toHaveBeenCalledTimes(1);
});
