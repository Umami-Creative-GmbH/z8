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
import {TeamAbsencesWorkspace} from '@/app/[locale]/(app)/team/absences/team-absences-workspace';

const transport=vi.hoisted(()=>({
  session:{data:{user:{id:'review-actor'},session:{activeOrganizationId:'review-org'}},isPending:false},
  discard:vi.fn(async()=>({success:true})),record:vi.fn(),refresh:vi.fn(),replace:vi.fn(),push:vi.fn(),context:vi.fn(),
}));
vi.mock('@/lib/auth-client',()=>({useSession:()=>transport.session}));
vi.mock('@/navigation',()=>({useRouter:()=>({refresh:transport.refresh,replace:transport.replace,push:transport.push}),Link:({children,...p}:any)=><a {...p}>{children}</a>}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:transport.refresh,replace:transport.replace,push:transport.push}),useSearchParams:()=>new URLSearchParams(),usePathname:()=>'/en/team/absences'}));
vi.mock('@/app/[locale]/(app)/team/absences/actions',()=>({recordAbsenceForEmployee:transport.record,recordAbsenceWithSickNotes:transport.record}));
vi.mock('@/app/[locale]/(app)/absences/deputy-actions',()=>({getDeputyCandidates:vi.fn(async()=>({success:true,data:[]})),getDeputyDecisionCapability:vi.fn(async()=>({success:true,data:{canDecide:false}})),changeAbsenceDeputy:vi.fn()}));
vi.mock('@/app/[locale]/(app)/absences/sick-note-actions',()=>({discardStagedSickNoteUploadsAction:transport.discard}));
vi.mock('@/app/[locale]/(app)/settings/vacation/reconciliation-actions',()=>({previewHistoricalVacationReconciliation:vi.fn()}));

const category={id:'home',name:'Review home office',type:'other',color:null,requiresApproval:false,countsAgainstVacation:false};
const bootstrap={userId:'review-actor',organizationId:'review-org',employee:{employeeId:'review-manager',organizationId:'review-org',role:'manager' as const},organizationSettings:{organizationId:'review-org',shiftsEnabled:false,projectsEnabled:false,surchargesEnabled:false,demoDataEnabled:false,worksCouncilEnabled:false,billableTimeEnabled:false,personnelFilesEnabled:true,equipmentEnabled:false,timezone:'UTC',deletedAt:null},updatedAt:Date.now()};
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
  transport.discard.mockClear();
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

const row={id:'review-target',userId:'review-target-user',name:'Review Person',email:'review-person@example.invalid',image:null,employeeNumber:null,position:null,role:'employee' as const,teamName:null,vacationAllowance:null,usedVacationDays:null,pendingVacationDays:null,remainingVacationDays:null,overdrawnVacationDays:null,sickDays:0};
const sick={...category,id:'sick',name:'Review sick leave',type:'sick'};
const props={actor:{userId:'review-actor',organizationId:'review-org',employeeId:'review-manager',role:'manager'},requestKey:'2026',search:'',categories:[category,sick],sickNotesEnabled:true,listResult:{success:true as const,data:{rows:[row],teams:[],total:1,page:1,pageSize:25,year:2026,teamId:null,sort:'employee' as const,direction:'asc' as const,pageCount:1}},calendarResult:{success:true as const,data:{year:2026,teamId:null,entries:[]}}};

const deferred=()=>{let resolve!:(v:any)=>void;let reject!:(e:Error)=>void;const promise=new Promise<any>((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
it.each(['success','refusal','rejection'])('assembled uploaded command late %s after list return cannot settle replacement',async(kind)=>{
 const old=deferred(),fresh=deferred();transport.record.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
 const methods=new WeakMap<XMLHttpRequest,string>();const realOpen=XMLHttpRequest.prototype.open;vi.spyOn(XMLHttpRequest.prototype,'open').mockImplementation(function(this:XMLHttpRequest,...args:any[]){methods.set(this,args[0]);return (realOpen as any).apply(this,args)});
 const requests:XMLHttpRequest[]=[];vi.spyOn(XMLHttpRequest.prototype,'send').mockImplementation(function(this:XMLHttpRequest){requests.push(this);console.info('SAFE method',requests.length,methods.get(this))});
 const tree=(failed=false)=><Providers><TeamAbsencesWorkspace {...props} listResult={failed?{success:false,error:'List unavailable'}:props.listResult}/></Providers>;
 const view=render(tree());const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'Record absence for Review Person'}));await fillDialog();
 await user.click(screen.getByRole('combobox',{name:/Category/i}));await user.click(await screen.findByRole('option',{name:'Review sick leave'}));
 await user.click(screen.getByRole('combobox',{name:/Sick detail/i}));await user.click(await screen.findByRole('option',{name:'Without certificate'}));
 const file=new File(['%PDF synthetic'],'review-note.pdf',{type:'application/pdf'});fireEvent.change(screen.getByTestId('sick-note-file-input'),{target:{files:[file]}});
 const submit=()=>screen.getByRole('button',{name:/^(Record absence|Recording)/});
 const complete=async(index:number,key:string)=>{await waitFor(()=>expect(requests.length).toBe(index+1));if(methods.get(requests[index])==='HEAD'){await act(async()=>respond(requests[index],404,{'tus-resumable':'1.0.0'}));index++;await waitFor(()=>expect(requests.length).toBe(index+1));}expect(methods.get(requests[index])).toBe('POST');await act(async()=>respond(requests[index],201,{location:'http://localhost:3000/api/tus/'+key,'tus-resumable':'1.0.0'}));await waitFor(()=>expect(requests.length).toBe(index+2));expect(methods.get(requests[index+1])).toBe('PATCH');await act(async()=>respond(requests[index+1],204,{'upload-offset':String(file.size),'tus-resumable':'1.0.0'}));};
 fireEvent.click(submit());await complete(0,'old-command');await waitFor(()=>expect(transport.record).toHaveBeenCalledTimes(1));
 view.rerender(tree(true));view.rerender(tree());await settle();fireEvent.click(submit());await complete(2,'new-command');await waitFor(()=>expect(transport.record).toHaveBeenCalledTimes(2));
 await act(async()=>{if(kind==='rejection')old.reject(new Error('Old rejection'));else old.resolve(kind==='success'?{success:true,data:{absenceId:'old'}}:{success:false,error:'Old refusal'});});await settle();
 expect(screen.getByRole('dialog')).toBeTruthy();expect(screen.getByRole('textbox',{name:/Notes/i})).toHaveProperty('value','Retain review input');expect(submit()).toHaveProperty('disabled',true);
 expect(toast.error).not.toHaveBeenCalled();expect(toast.success).not.toHaveBeenCalled();expect(transport.refresh).not.toHaveBeenCalled();
 expect(transport.discard.mock.calls).toEqual(kind==='rejection'?[[['old-command']]]:[]);
 fireEvent.click(submit());expect(transport.record).toHaveBeenCalledTimes(2);
 fresh.resolve({success:false,error:'Fresh refusal'});await waitFor(()=>expect(toast.error).toHaveBeenCalledExactlyOnceWith('Fresh refusal'));expect(submit()).toHaveProperty('disabled',false);
 expect(transport.record.mock.calls[1][1]).toEqual([expect.objectContaining({tusFileKey:'new-command'})]);
});
