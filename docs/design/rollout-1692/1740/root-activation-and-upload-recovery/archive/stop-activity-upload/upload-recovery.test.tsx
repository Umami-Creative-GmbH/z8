// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {Activity, type ReactNode} from 'react';
import {flushSync} from 'react-dom';
import {beforeEach, afterEach, expect, it, vi} from 'vitest';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {NextIntlClientProvider} from 'next-intl';
import {TolgeeProvider} from '@tolgee/react';
import {createTestTolgee} from '@/test/render-with-translations';
import {OrganizationContextProvider} from '@/components/providers/organization-context-provider';
import {ViewRefreshProvider} from '@/components/providers/view-refresh-provider';
import {RecordAbsenceDialog} from '@/app/[locale]/(app)/team/absences/record-absence-dialog';
import {Toaster, toast} from 'sonner';

const transport=vi.hoisted(()=>({
  session:{data:{user:{id:'review-actor'},session:{activeOrganizationId:'review-org'}},isPending:false},
  record:vi.fn(),refresh:vi.fn(),replace:vi.fn(),push:vi.fn(),context:vi.fn(),
}));
vi.mock('@/lib/auth-client',()=>({useSession:()=>transport.session}));
vi.mock('@/navigation',()=>({useRouter:()=>({refresh:transport.refresh,replace:transport.replace,push:transport.push}),Link:({children,...p}:any)=><a {...p}>{children}</a>}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:transport.refresh,replace:transport.replace,push:transport.push}),useSearchParams:()=>new URLSearchParams(),usePathname:()=>'/en/team/absences'}));
vi.mock('@/app/[locale]/(app)/team/absences/actions',()=>({recordAbsenceForEmployee:transport.record,recordAbsenceWithSickNotes:transport.record}));
vi.mock('@/app/[locale]/(app)/absences/deputy-actions',()=>({getDeputyCandidates:vi.fn(async()=>({success:true,data:[]})),getDeputyDecisionCapability:vi.fn(async()=>({success:true,data:{canDecide:false}})),changeAbsenceDeputy:vi.fn()}));
vi.mock('@/app/[locale]/(app)/absences/sick-note-actions',()=>({discardStagedSickNoteUploadsAction:vi.fn(async()=>({success:true}))}));
vi.mock('@/app/[locale]/(app)/settings/vacation/reconciliation-actions',()=>({previewHistoricalVacationReconciliation:vi.fn()}));

const category={id:'home',name:'Review home office',type:'other',color:null,requiresApproval:false,countsAgainstVacation:false};
const bootstrap={userId:'review-actor',organizationId:'review-org',employee:{employeeId:'review-manager',organizationId:'review-org',role:'manager' as const},organizationSettings:null,updatedAt:Date.now()};
let currentBootstrap:any;
let client:QueryClient;
let tolgee:ReturnType<typeof createTestTolgee>;
function Providers({children}:{children:ReactNode}){return <NextIntlClientProvider locale="en" messages={{}}><TolgeeProvider tolgee={tolgee}><QueryClientProvider client={client}><OrganizationContextProvider initialContext={currentBootstrap}><ViewRefreshProvider>{children}<Toaster/></ViewRefreshProvider></OrganizationContextProvider></QueryClientProvider></TolgeeProvider></NextIntlClientProvider>}
beforeEach(()=>{
  currentBootstrap={...bootstrap,updatedAt:Date.now()};
  vi.spyOn(toast,"error"); vi.spyOn(toast,"success"); vi.spyOn(toast,"warning");
  transport.refresh.mockReset(); transport.replace.mockReset(); transport.push.mockReset();
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  tolgee=createTestTolgee();
  transport.session={data:{user:{id:'review-actor'},session:{activeOrganizationId:'review-org'}},isPending:false};
  transport.record.mockReset().mockResolvedValue({success:false,error:'Review refusal'});
  vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
  Object.defineProperty(window,'matchMedia',{configurable:true,value:()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}})});
  vi.stubGlobal('fetch',transport.context.mockReset().mockImplementation(async()=>{throw Error('Unexpected transport')}));
});


afterEach(()=>{cleanup();client.clear();vi.unstubAllGlobals();vi.restoreAllMocks();});

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


const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,100))});
function respond(xhr:XMLHttpRequest,status:number,headers:Record<string,string>){
  Object.defineProperty(xhr,'status',{configurable:true,value:status});
  Object.defineProperty(xhr,'responseText',{configurable:true,value:''});
  vi.spyOn(xhr,'getResponseHeader').mockImplementation(name=>headers[name.toLowerCase()]??null);
  xhr.dispatchEvent(new ProgressEvent('load'));
}
it.each(['steady','Activity'])('real staged-note recovery: %s',async(mode)=>{
  const requests:XMLHttpRequest[]=[];
  vi.spyOn(XMLHttpRequest.prototype,'send').mockImplementation(function(this:XMLHttpRequest){requests.push(this)});
  const sick={...category,id:'sick',name:'Review sick leave',type:'sick'};
  const dialog=<RecordAbsenceDialog open employee={{id:'review-target',name:'Review Person'}} categories={[category,sick]} sickNotesEnabled onOpenChange={()=>{}}/>;
  const tree=(visibility:'visible'|'hidden')=><Providers><Activity mode={visibility}>{dialog}</Activity></Providers>;
  const view=render(tree('visible'));await fillDialog();
  const user=userEvent.setup();await user.click(screen.getByRole('combobox',{name:/Category/i}));await user.click(await screen.findByRole('option',{name:'Review sick leave'}));
  await user.click(screen.getByRole('combobox',{name:/Sick detail/i}));await user.click(await screen.findByRole('option',{name:'Without certificate'}));
  const file=new File(['%PDF-1.4 synthetic'],'review-note.pdf',{type:'application/pdf'});
  fireEvent.change(screen.getByTestId('sick-note-file-input'),{target:{files:[file]}});
  const getSubmit=()=>screen.getByRole('button',{name:/^(Record absence|Recording)/});
  fireEvent.click(getSubmit());await waitFor(()=>expect(requests).toHaveLength(1));
  expect(transport.record).toHaveBeenCalledTimes(0);expect(toast.error).not.toHaveBeenCalled();
  if(mode==='steady'){
    // Positive HTTP-only control proves the real browser uploader can finish.
    await act(async()=>respond(requests[0],201,{location:'http://localhost:3000/api/tus/review-key','tus-resumable':'1.0.0'}));
    await waitFor(()=>expect(requests).toHaveLength(2));
    await act(async()=>respond(requests[1],204,{'upload-offset':String(file.size),'tus-resumable':'1.0.0'}));
    await waitFor(()=>expect(transport.record).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(toast.error).toHaveBeenCalledWith('Review refusal'));
    expect(transport.record.mock.calls[0][0]).toMatchObject({employeeId:'review-target',categoryId:'sick',sickDetail:'without_certificate',notes:'Retain review input'});
    expect(transport.record.mock.calls[0][1]).toEqual([expect.objectContaining({tusFileKey:'review-key',fileName:'review-note.pdf'})]);
    console.info('1740 safe upload positive control: POST and PATCH completed; exactly one synthetic refusal command with staged evidence.');
    return;
  }
  view.rerender(tree('hidden'));expect(screen.queryByRole('dialog')).toBeNull();view.rerender(tree('visible'));await settle();
  expect(screen.getByRole('textbox',{name:/Notes/i})).toHaveProperty('value','Retain review input');expect(screen.getByText('review-note.pdf')).toBeTruthy();
  const disabledBeforeRetry=(getSubmit() as HTMLButtonElement).disabled;
  fireEvent.click(getSubmit());await settle();
  console.info('1740 safe upload Activity observation',JSON.stringify({requests:requests.length,commandCalls:transport.record.mock.calls.length,errorNotifications:vi.mocked(toast.error).mock.calls.length,disabledBeforeRetry,draftRetained:true,fileRetained:true}));
  await waitFor(()=>expect(requests).toHaveLength(2));
  expect(toast.error).not.toHaveBeenCalled();
});
