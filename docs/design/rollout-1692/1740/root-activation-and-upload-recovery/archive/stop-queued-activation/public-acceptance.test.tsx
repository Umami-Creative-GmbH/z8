// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '../../apps/webapp/node_modules/@testing-library/user-event';
import {Activity, type ReactNode} from 'react';
import {flushSync} from 'react-dom';
import {beforeEach, afterEach, expect, it, vi} from 'vitest';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {NextIntlClientProvider} from 'next-intl';
import {TolgeeProvider} from '@tolgee/react';
import {createTestTolgee} from '@/test/render-with-translations';
import {OrganizationContextProvider} from '@/components/providers/organization-context-provider';
import {ViewRefreshProvider} from '@/components/providers/view-refresh-provider';
import {TeamAbsencesWorkspace} from '@/app/[locale]/(app)/team/absences/team-absences-workspace';
import {RecordAbsenceDialog} from '@/app/[locale]/(app)/team/absences/record-absence-dialog';
import {Toaster} from 'sonner';

const transport=vi.hoisted(()=>({
  session:{data:{user:{id:'review-actor'},session:{activeOrganizationId:'review-org'}},isPending:false},
  record:vi.fn(),refresh:vi.fn(),replace:vi.fn(),push:vi.fn(),context:vi.fn(),
}));
vi.mock('@/lib/auth-client',()=>({useSession:()=>transport.session}));
vi.mock('@/navigation',()=>({useRouter:()=>({refresh:transport.refresh,replace:transport.replace,push:transport.push}),Link:({children,...p}:any)=><a {...p}>{children}</a>}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:transport.refresh,replace:transport.replace,push:transport.push}),useSearchParams:()=>new URLSearchParams(),usePathname:()=>'/en/team/absences'}));
vi.mock('@/app/[locale]/(app)/team/absences/actions',()=>({recordAbsenceForEmployee:transport.record,recordAbsenceWithSickNotes:vi.fn()}));
vi.mock('@/app/[locale]/(app)/absences/deputy-actions',()=>({getDeputyCandidates:vi.fn(async()=>({success:true,data:[]})),getDeputyDecisionCapability:vi.fn(async()=>({success:true,data:{canDecide:false}})),changeAbsenceDeputy:vi.fn()}));
vi.mock('@/app/[locale]/(app)/absences/sick-note-actions',()=>({discardStagedSickNoteUploadsAction:vi.fn(async()=>({success:true}))}));
vi.mock('@/app/[locale]/(app)/settings/vacation/reconciliation-actions',()=>({previewHistoricalVacationReconciliation:vi.fn()}));

const category={id:'home',name:'Review home office',type:'other',color:null,requiresApproval:false,countsAgainstVacation:false};
const bootstrap={userId:'review-actor',organizationId:'review-org',employee:{employeeId:'review-manager',organizationId:'review-org',role:'manager' as const},organizationSettings:null,updatedAt:Date.now()};
const row={id:'review-target',userId:'review-target-user',name:'Review Person',email:'review-person@example.invalid',image:null,employeeNumber:null,position:null,role:'employee' as const,teamName:null,vacationAllowance:null,usedVacationDays:null,pendingVacationDays:null,remainingVacationDays:null,overdrawnVacationDays:null,sickDays:0};
const props={actor:{userId:'review-actor',organizationId:'review-org',employeeId:'review-manager',role:'manager'},requestKey:'2026',search:'',categories:[category],sickNotesEnabled:false,listResult:{success:true as const,data:{rows:[row],teams:[],total:1,page:1,pageSize:25,year:2026,teamId:null,sort:'employee' as const,direction:'asc' as const,pageCount:1}},calendarResult:{success:true as const,data:{year:2026,teamId:null,entries:[]}}};
let client:QueryClient;
let tolgee:ReturnType<typeof createTestTolgee>;
function Providers({children}:{children:ReactNode}){return <NextIntlClientProvider locale="en" messages={{}}><TolgeeProvider tolgee={tolgee}><QueryClientProvider client={client}><OrganizationContextProvider initialContext={bootstrap}><ViewRefreshProvider>{children}<Toaster/></ViewRefreshProvider></OrganizationContextProvider></QueryClientProvider></TolgeeProvider></NextIntlClientProvider>}
beforeEach(()=>{
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  tolgee=createTestTolgee();
  transport.session={data:{user:{id:'review-actor'},session:{activeOrganizationId:'review-org'}},isPending:false};
  transport.record.mockReset().mockResolvedValue({success:false,error:'Review refusal'});
  vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
  Object.defineProperty(window,'matchMedia',{configurable:true,value:()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}})});
  vi.stubGlobal('fetch',transport.context.mockReset().mockImplementation(async()=>{throw Error('Unexpected transport')}));
});
afterEach(()=>{cleanup();client.clear();vi.unstubAllGlobals();});

async function fillDialog(){
  const user=userEvent.setup();
  await user.click(screen.getByRole('combobox',{name:/Category/i}));
  await user.click(await screen.findByRole('option',{name:'Review home office'}));
  await user.click(screen.getByRole('button',{name:/Start date/i}));
  const today=String(new Date().getDate());
  const dateButtons=screen.getAllByRole('button').filter(b=>b.textContent===today&&b.closest('[role="grid"]'));
  if(dateButtons.length!==1)throw Error('Expected unique current calendar day, got '+dateButtons.length);
  await user.click(dateButtons[0]);
  await user.type(screen.getByRole('textbox',{name:/Notes/i}),'Retain review input');
}

it('assembled current workspace retains list on calendar read failure and retires on organization switch',async()=>{
  const view=render(<Providers><TeamAbsencesWorkspace {...props}/></Providers>);
  expect(await screen.findByText('Review Person')).toBeTruthy();
  view.rerender(<Providers><TeamAbsencesWorkspace {...props} calendarResult={{success:false,error:'Offline'}}/></Providers>);
  expect(screen.getByText('Review Person')).toBeTruthy();
  expect(screen.getByText('Unable to load calendar')).toBeTruthy();
  transport.session={...transport.session,data:{user:{id:'review-actor'},session:{activeOrganizationId:'review-org-b'}}};
  view.rerender(<Providers><TeamAbsencesWorkspace {...props}/></Providers>);
  expect(screen.queryByText('Review Person')).toBeNull();
});

it('a queued public submit must not run after Activity hides and returns before onSubmit',async()=>{
  const dialog=<RecordAbsenceDialog open employee={{id:'review-target',name:'Review Person'}} categories={[category]} onOpenChange={()=>{}}/>;
  const view=render(<Providers><Activity mode="visible">{dialog}</Activity></Providers>);
  await fillDialog();
  // No artificial validation or form API replacement: the real TanStack submit
  // crosses its natural async validation boundary after the public click.
  act(()=>{
    fireEvent.click(screen.getByRole('button',{name:'Record absence'}));
    expect(transport.record).toHaveBeenCalledTimes(0);
    flushSync(()=>view.rerender(<Providers><Activity mode="hidden">{dialog}</Activity></Providers>));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(transport.record).toHaveBeenCalledTimes(0);
    flushSync(()=>view.rerender(<Providers><Activity mode="visible">{dialog}</Activity></Providers>));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(transport.record).toHaveBeenCalledTimes(0);
  });
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,100));});
  expect.soft(transport.record).toHaveBeenCalledTimes(0);
  expect(transport.record).toHaveBeenCalledTimes(1);
  expect(transport.record.mock.calls[0][0].employeeId).toBe('review-target');
  expect(screen.getByRole('textbox',{name:/Notes/i})).toHaveProperty('value','Retain review input');
  fireEvent.click(screen.getByRole('button',{name:'Record absence'}));
  await waitFor(()=>expect(transport.record).toHaveBeenCalledTimes(2));
  expect(transport.record.mock.calls[1][0].employeeId).toBe('review-target');
  console.info('1740 safe reproduction: no command at click/hide/return; one retired command after return; genuine new submit sends second command to same synthetic target.');
});
