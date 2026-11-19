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
import {TeamAbsencesWorkspace} from '@/app/[locale]/(app)/team/absences/team-absences-workspace';
import {RecordAbsenceDialog} from '@/app/[locale]/(app)/team/absences/record-absence-dialog';
import {Toaster, toast} from 'sonner';

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

const deferred=<T,>()=>{let resolve!:(value:T)=>void;let reject!:(reason:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,100))});
const workspace=(p:any=props)=><Providers><TeamAbsencesWorkspace {...p}/></Providers>;
async function openRecord(){await userEvent.setup().click(screen.getByRole('button',{name:'Record absence for Review Person'}));await screen.findByRole('dialog');}
const note=()=>screen.getByRole('textbox',{name:/Notes/i});
const submit=()=>screen.getByRole('button',{name:'Record absence'});
function contextResponse(ctx:any){return new Response(JSON.stringify({user:{id:ctx.userId},session:{activeOrganizationId:ctx.organizationId},employee:ctx.employee,organizationSettings:ctx.organizationSettings}),{status:200,headers:{'content-type':'application/json'}})}

it('raw pending session with retained same-scope data keeps the assembled draft and permits a genuine action',async()=>{
  const view=render(workspace()); await openRecord();await fillDialog();
  transport.session={...transport.session,isPending:true};view.rerender(workspace());
  expect(note()).toHaveProperty('value','Retain review input');
  fireEvent.click(submit()); await waitFor(()=>expect(transport.record).toHaveBeenCalledTimes(1));
  await waitFor(()=>expect(toast.error).toHaveBeenCalledWith('Review refusal'));
  expect(transport.record.mock.calls[0][0]).toMatchObject({employeeId:'review-target',categoryId:'home',notes:'Retain review input'});
});

it.each(['account','organization'])('assembled %s A-B-A retires the draft and old response, then accepts a new action',async(field)=>{
  const pending=deferred<any>();transport.record.mockReturnValueOnce(pending.promise);
  const view=render(workspace());await openRecord();await fillDialog();fireEvent.click(submit());
  await waitFor(()=>expect(transport.record).toHaveBeenCalledTimes(1));
  const original=transport.session;
  transport.context.mockImplementation(()=>new Promise(()=>{}));
  transport.session={data:{user:{id:field==='account'?'other-actor':'review-actor'},session:{activeOrganizationId:field==='organization'?'other-org':'review-org'}},isPending:true};
  view.rerender(workspace());expect(screen.queryByRole('dialog')).toBeNull();expect(screen.queryByText('Review Person')).toBeNull();
  transport.session=original;view.rerender(workspace());await screen.findByText('Review Person');
  expect(screen.queryByRole('dialog')).toBeNull();await openRecord();expect(note()).toHaveProperty('value','');
  pending.resolve({success:true,data:{absenceId:'obsolete'}});await settle();
  expect(screen.getByRole('dialog')).toBeTruthy();expect(toast.success).not.toHaveBeenCalled();expect(transport.refresh).not.toHaveBeenCalled();
  await fillDialog();fireEvent.click(submit());await waitFor(()=>expect(transport.record).toHaveBeenCalledTimes(2));
  await waitFor(()=>expect(toast.error).toHaveBeenCalledWith('Review refusal'));
});

it('independent list/calendar errors retain the actual form and recover through local Retry',async()=>{
  const view=render(workspace());await openRecord();await fillDialog();
  const failed={...props,listResult:{success:false,error:'List unavailable'},calendarResult:{success:false,error:'Calendar unavailable'}};
  view.rerender(workspace(failed));expect(note()).toHaveProperty('value','Retain review input');expect(submit()).toHaveProperty('disabled',true);
  // Close only the overlay for access to the actual page Retry controls.
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  expect(screen.getByText('Review Person')).toBeTruthy();expect(screen.getByText('Unable to load absences')).toBeTruthy();expect(screen.getByText('Unable to load calendar')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button',{name:'Retry'})[0]);expect(transport.refresh).toHaveBeenCalledTimes(1);
  view.rerender(workspace());expect(screen.queryByRole('alert')).toBeNull();
});

it('initial canonical context failure is distinct from healthy list/calendar; local retry coalesces and restores',async()=>{
  currentBootstrap=null;
  transport.context.mockRejectedValueOnce(new Error('Synthetic context unavailable'));
  const view=render(workspace());await screen.findByText('Unable to load the current team scope');
  expect(screen.queryByText('Review Person')).toBeNull();expect(screen.queryByText('No employees found')).toBeNull();
  const next=deferred<Response>();transport.context.mockReturnValue(next.promise);
  const calls=transport.context.mock.calls.length;
  const retry=screen.getByRole('button',{name:'Retry'});fireEvent.click(retry);fireEvent.click(retry);await waitFor(()=>expect(transport.context).toHaveBeenCalledTimes(calls+1));
  expect(screen.getByText(/Loading the current team scope/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Retry'})).toBeNull();expect(transport.context).toHaveBeenCalledTimes(calls+1);
  next.resolve(contextResponse(bootstrap));await screen.findByText('Review Person');view.rerender(workspace());expect(screen.queryByRole('alert')).toBeNull();
});

it.each(['role','employee'])('canonical %s change retires the assembled form and does not dispatch queued work',async(field)=>{
  const view=render(workspace());await openRecord();await fillDialog();
  act(()=>{
    fireEvent.click(submit());expect(transport.record).toHaveBeenCalledTimes(0);
    currentBootstrap={...bootstrap,updatedAt:Date.now()+1000,employee:{...bootstrap.employee,...(field==='role'?{role:'employee'}:{employeeId:'other-manager'})}};
    flushSync(()=>view.rerender(workspace()));
    expect(screen.queryByRole('dialog')).toBeNull();expect(screen.queryByText('Review Person')).toBeNull();
  });await settle();expect(transport.record).toHaveBeenCalledTimes(0);expect(toast.error).not.toHaveBeenCalled();
});

it('selected employee absence then return retires a queued action and permits a new public submit',async()=>{
  const view=render(workspace());await openRecord();await fillDialog();
  act(()=>{
    fireEvent.click(submit());expect(transport.record).toHaveBeenCalledTimes(0);
    flushSync(()=>view.rerender(workspace({...props,listResult:{success:true,data:{...props.listResult.data,rows:[],total:0}}})));
    expect(submit()).toHaveProperty('disabled',true);
    flushSync(()=>view.rerender(workspace()));
  });await settle();expect(transport.record).toHaveBeenCalledTimes(0);expect(note()).toHaveProperty('value','Retain review input');
  fireEvent.click(submit());await waitFor(()=>expect(transport.record).toHaveBeenCalledTimes(1));await waitFor(()=>expect(toast.error).toHaveBeenCalledWith('Review refusal'));
});

it.each(['success','refusal','rejection'])('real pending command ignores late %s after Activity return and permits a new command',async(kind)=>{
  const pending=deferred<any>();transport.record.mockReturnValueOnce(pending.promise);
  const dialog=<RecordAbsenceDialog open employee={{id:'review-target',name:'Review Person'}} categories={[category]} onOpenChange={transport.push}/>;
  const tree=(mode:'hidden'|'visible')=><Providers><Activity mode={mode}>{dialog}</Activity></Providers>;
  const view=render(tree('visible'));await fillDialog();const submitButton=submit();fireEvent.click(submitButton);
  await waitFor(()=>expect(transport.record).toHaveBeenCalledTimes(1));
  expect(submitButton).toHaveProperty('disabled',true);fireEvent.click(submitButton);fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(transport.record).toHaveBeenCalledTimes(1);expect(transport.push).not.toHaveBeenCalled();
  view.rerender(tree('hidden'));expect(screen.queryByRole('dialog')).toBeNull();view.rerender(tree('visible'));await settle();
  expect(note()).toHaveProperty('value','Retain review input');
  if(kind==='rejection')pending.reject(new Error('Synthetic late rejection'));else pending.resolve(kind==='success'?{success:true,data:{absenceId:'retired'}}:{success:false,error:'Retired refusal'});
  await settle();expect(toast.error).not.toHaveBeenCalled();expect(toast.success).not.toHaveBeenCalled();expect(transport.refresh).not.toHaveBeenCalled();expect(transport.push).not.toHaveBeenCalled();
  fireEvent.click(submit());await waitFor(()=>expect(transport.record).toHaveBeenCalledTimes(2));await waitFor(()=>expect(toast.error).toHaveBeenCalledWith('Review refusal'));
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
  expect(transport.record).toHaveBeenCalledTimes(0);
  expect(toast.error).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox',{name:/Notes/i})).toHaveProperty('value','Retain review input');
  fireEvent.click(screen.getByRole('button',{name:'Record absence'}));
  await waitFor(()=>expect(transport.record).toHaveBeenCalledTimes(1));
  expect(transport.record.mock.calls[0][0].employeeId).toBe('review-target');
  await waitFor(()=>expect(toast.error).toHaveBeenCalledWith('Review refusal'));
});
