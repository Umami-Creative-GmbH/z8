// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { OrganizationContextProvider } from '@/components/providers/organization-context-provider';
import { TeamDirectory } from '@/app/[locale]/(app)/team/team-directory';

const boundary=vi.hoisted(()=>({fetch:vi.fn(),current:vi.fn(),managed:vi.fn(),presence:vi.fn(),refresh:vi.fn(),replace:vi.fn(),section:vi.fn(),session:{data:{user:{id:'actor-a'},session:{activeOrganizationId:'org-a'}},isPending:false}}));
vi.mock('@/lib/auth-client',()=>({useSession:()=>boundary.session,authClient:{$store:{atoms:{session:{subscribe:()=>()=>{}}}}}}));
vi.mock('@/app/[locale]/(app)/team/actions',()=>({getCurrentEmployee:boundary.current,getManagedEmployees:boundary.managed}));
vi.mock('@/app/[locale]/(app)/settings/employees/employee-clock-status.actions',()=>({getEmployeeClockStatuses:boundary.presence}));
vi.mock('@/app/[locale]/(app)/settings/employees/work-balance-actions',()=>({getEmployeeWorkBalanceSectionAction:boundary.section,cancelBalanceAdjustmentAction:vi.fn(),recordOvertimePayoutAction:vi.fn(),setOpeningBalanceAction:vi.fn()}));
vi.mock('@/app/[locale]/(app)/time-tracking/actions',()=>({addBreakToActiveSession:vi.fn(),resumeBreakInProgress:vi.fn(),startBreakInProgress:vi.fn(),updateTimeEntryNotes:vi.fn()}));
vi.mock('@/navigation',()=>({useRouter:()=>({refresh:boundary.refresh,replace:boundary.replace}),Link:(props:ComponentProps<'a'>)=><a {...props}/> }));
vi.mock('@/tolgee/server',()=>({getTranslate:async()=>(_key:string,fallback:string)=>fallback}));
vi.mock('@tolgee/react',()=>({useTranslate:()=>({t:(_key:string,fallback:string)=>fallback})}));
vi.mock('@/lib/navigation/locale-redirect',()=>({redirectWithLocale:vi.fn()}));

function response(){return new Response(JSON.stringify({user:{id:'actor-a'},session:{activeOrganizationId:'org-a'},employee:{employeeId:'manager-a',organizationId:'org-a',role:'manager'},organizationSettings:null}));}
const clients:QueryClient[]=[];
beforeEach(()=>{
 vi.clearAllMocks();
 boundary.fetch.mockReset().mockImplementation(async()=>response());
 vi.stubGlobal('fetch',boundary.fetch);
 boundary.current.mockResolvedValue({id:'manager-a',userId:'actor-a',organizationId:'org-a',role:'manager'});
 boundary.managed.mockImplementation(async()=>({success:true,data:[{id:'report-a',role:'employee',isFormer:false,user:{id:'person-a',name:'Admitted Synthetic Employee',email:'synthetic@example.test',image:null},timeBalance:null,team:null}]}));
 boundary.presence.mockResolvedValue({success:true,data:{}});
});
afterEach(()=>{cleanup();for(const client of clients)client.clear();clients.length=0;vi.unstubAllGlobals();});
async function mount(){
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});clients.push(client);
 const tree=async()=> <QueryClientProvider client={client}><OrganizationContextProvider initialContext={null}>{await TeamDirectory({searchParams:Promise.resolve({})})}</OrganizationContextProvider></QueryClientProvider>;
 const view=render(await tree());
 // Model a successful RSC refresh while preserving the actual shared provider and QueryClient.
 boundary.refresh.mockImplementation(async()=>view.rerender(await tree()));
 return client;
}
it('healthy real provider admits the public team directory and its employee link',async()=>{
 await mount();
 expect(await screen.findByRole('link',{name:'Admitted Synthetic Employee'})).toBeTruthy();
 expect(boundary.fetch).toHaveBeenCalledTimes(1);
 expect(boundary.fetch.mock.calls[0][0]).toBe('/api/auth/context');
});
it('local Retry refetches failed canonical context and admits records after successful RSC refresh',async()=>{
 boundary.fetch.mockImplementation(async()=>new Response(JSON.stringify({error:'Synthetic context outage'}),{status:503}));
 const client=await mount();
 await waitFor(()=>expect(client.getQueryCache().findAll({queryKey:['organization-context']}).some(q=>q.state.status==='error')).toBe(true));
 expect(screen.queryByRole('link',{name:'Admitted Synthetic Employee'})).toBeNull();
 const retry=screen.getByRole('button',{name:'Retry'});
 boundary.fetch.mockImplementation(async()=>response());
 await act(async()=>fireEvent.click(retry));
 await waitFor(()=>expect(boundary.refresh).toHaveBeenCalledTimes(1));
 await waitFor(()=>expect(boundary.managed).toHaveBeenCalledTimes(2));
 console.info('MERGE1739_CONTEXT_RETRY',JSON.stringify({contextFetches:boundary.fetch.mock.calls.length,successfulRscRefreshes:boundary.refresh.mock.calls.length,managedReads:boundary.managed.mock.calls.length,scopeFeedbackVisible:!!screen.queryByText('Your organization or access changed. Refresh to load your team.'),employeeVisible:!!screen.queryByRole('link',{name:'Admitted Synthetic Employee'})}));
 await waitFor(()=>expect(boundary.fetch).toHaveBeenCalledTimes(2));
 expect(await screen.findByRole('link',{name:'Admitted Synthetic Employee'})).toBeTruthy();
});
