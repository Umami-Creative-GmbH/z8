/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { OrganizationContextProvider } from '@/components/providers/organization-context-provider';
import { ViewRefreshProvider, useViewRefreshAction } from '@/components/providers/view-refresh-provider';
import { TravelExpenseManagement } from './travel-expense-management';

const edge=vi.hoisted(()=>({history:vi.fn(),receipt:vi.fn(),mileage:vi.fn(),trip:vi.fn(),push:vi.fn(),refresh:vi.fn(),replace:vi.fn(),session:{pending:false,user:'fixture-user',org:'fixture-org'}}));
vi.mock('@/app/[locale]/(app)/travel-expenses/history-actions',()=>({getMyTravelExpenseHistory:edge.history}));
vi.mock('@/app/[locale]/(app)/travel-expenses/report-actions',()=>({createStandaloneReceiptReportAction:edge.receipt,createTripReportAction:edge.trip,deleteDraftTravelExpenseReportAction:vi.fn()}));
vi.mock('@/app/[locale]/(app)/travel-expenses/mileage-actions',()=>({createStandaloneMileageReportAction:edge.mileage}));
vi.mock('@/app/[locale]/(app)/travel-expenses/legacy-draft-actions',()=>({getLegacyTravelExpenseConversion:vi.fn(),convertLegacyTravelExpenseDraftAction:vi.fn()}));
vi.mock('@/lib/auth-client',()=>({useSession:()=>({isPending:edge.session.pending,data:{user:{id:edge.session.user},session:{activeOrganizationId:edge.session.org}}}),authClient:{getSession:vi.fn()}}));
vi.mock('@/navigation',()=>({Link:({children,...props}:React.ComponentProps<'a'>)=><a {...props}>{children}</a>,useRouter:()=>({push:edge.push,refresh:edge.refresh,replace:edge.replace})}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:edge.refresh})}));
vi.mock('@tolgee/react',()=>({useTranslate:()=>({t:(_k:string,f:string)=>f})}));
vi.mock('next-intl',()=>({useLocale:()=>'en-US',useTranslations:()=>((k:string)=>k)}));
vi.mock('sonner',()=>({toast:{success:vi.fn(),error:vi.fn()}}));
const initial={userId:'fixture-user',organizationId:'fixture-org',employee:{employeeId:'fixture-employee',organizationId:'fixture-org',role:'employee' as const},organizationSettings:null,updatedAt:1};
const row={source:'report',id:'fixture-report',href:'/travel-expenses/reports/fixture-report',stage:'needs_action',activityAt:'2026-10-05T10:00:00.000Z',balance:null,reimbursement:null,dates:{start:'2026-09-14',end:'2026-09-14'},kind:'standalone',status:'draft',itemType:'receipt',title:'Public fixture receipt',itemCount:1,receiptCount:1,totals:{currency:'EUR',reimbursable:'129.90',companyPaid:'0.00',excludedItemCount:0},adjustmentOf:null,continuedFromClaimId:null,deletable:false};
const success=()=>({success:true,data:[row]});
const clients:QueryClient[]=[];
function Refresh(){const {refresh}=useViewRefreshAction();return <button onClick={refresh}>Review header refresh</button>}
function mount(child?:ReactNode){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});clients.push(client); const view=render(<QueryClientProvider client={client}><OrganizationContextProvider initialContext={initial}><ViewRefreshProvider><Refresh/>{child??<TravelExpenseManagement userId='fixture-user' organizationId='fixture-org' employeeId='fixture-employee'/>}</ViewRefreshProvider></OrganizationContextProvider></QueryClientProvider>);return {client,view};}
beforeEach(()=>{vi.clearAllMocks();edge.session.pending=false;edge.history.mockReset();edge.history.mockResolvedValue(success());vi.stubGlobal('fetch',vi.fn(async(url)=>{expect(String(url)).toBe('/api/auth/context');return new Response(JSON.stringify({user:{id:'fixture-user'},session:{activeOrganizationId:'fixture-org'},employee:initial.employee,organizationSettings:null}),{status:200});}));});
afterEach(()=>{cleanup();for(const c of clients.splice(0))c.clear();vi.unstubAllGlobals();});

import { TravelExpenseManagement as RootManagement } from './r165-root-management';
it('initial canonical refusal remains unknown and local Retry restores only fresh evidence',async()=>{
 edge.history.mockResolvedValueOnce({success:false,error:'Unauthorized'}); mount();
 await screen.findByRole('alert'); expect(screen.queryByText('Public fixture receipt')).toBeNull();
 expect(screen.queryByText('No travel expenses yet')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));
 expect(await screen.findByText('Public fixture receipt')).toBeTruthy();
 expect(edge.history).toHaveBeenCalledTimes(2);
});
it.each(['incoming','premerge-root'] as const)('minimal repeat and classification %s: refusal then outage cannot retain retired rows; fresh success recovers',async(owner)=>{
 mount(owner==='premerge-root'?<RootManagement organizationId='fixture-org' employeeId='fixture-employee'/>:undefined);
 await screen.findByText('Public fixture receipt');
 edge.history.mockResolvedValueOnce({success:false,error:'Unauthorized'});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Review header refresh'}));await new Promise(r=>setTimeout(r,25));});
 await screen.findByRole('alert');
 const afterRefusal=Boolean(screen.queryByRole('link',{name:'Public fixture receipt'}));
 edge.history.mockRejectedValueOnce(new Error('Fixture transport offline'));
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Retry'}));await new Promise(r=>setTimeout(r,25));});
 await screen.findByRole('alert');
 const afterOutage=Boolean(screen.queryByRole('link',{name:'Public fixture receipt'}));
 edge.history.mockResolvedValueOnce({success:true,data:[{...row,title:'Fresh authorized fixture'}]});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Retry'}));await new Promise(r=>setTimeout(r,25));});
 expect(await screen.findByRole('link',{name:'Fresh authorized fixture'})).toBeTruthy();
 expect(screen.queryByText('Public fixture receipt')).toBeNull();
 expect(screen.queryByRole('alert')).toBeNull();expect(edge.history).toHaveBeenCalledTimes(4);
 console.info(JSON.stringify({owner,afterRefusal,afterOutage,freshSuccessRecovered:true,historyReads:4}));
 expect({afterRefusal,afterOutage}).toEqual({afterRefusal:false,afterOutage:false});
});
