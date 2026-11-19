// @vitest-environment jsdom
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {Activity,type ReactNode} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {AbsenceSickNotesPanel} from '@/components/absences/sick-notes/absence-sick-notes-panel';
import {useOwnAbsenceSickNotes} from '@/components/absences/sick-notes/use-own-absence-sick-notes';
import {OrganizationContextProvider} from '@/components/providers/organization-context-provider';
import {PersonnelFilePanel} from '@/components/personnel-file/personnel-file-panel';
import {useEmployeeSickLeave} from '@/components/personnel-file/sick-note-links';
import {SickLeaveLoadingHeading} from '@/components/personnel-file/sick-leave-overview';
const transport=vi.hoisted(()=>({list:vi.fn(),own:vi.fn(),leave:vi.fn(),documents:vi.fn(),unlink:vi.fn()}));
const identity=vi.hoisted(()=>({actor:'independent-actor-a',org:'independent-org-a',pending:false,retained:true}));
const feedback=vi.hoisted(()=>({success:vi.fn(),error:vi.fn()}));
vi.mock('@/lib/auth-client',()=>({useSession:()=>({isPending:identity.pending,data:identity.retained?{user:{id:identity.actor},session:{activeOrganizationId:identity.org}}:null})}));
vi.mock('sonner',()=>({toast:feedback}));
vi.mock('@/app/[locale]/(app)/personnel-files/actions',()=>({getPersonnelFileAction:transport.documents,updateEmployeeDocumentAction:vi.fn(),deleteEmployeeDocumentAction:vi.fn()}));
vi.mock('@/app/[locale]/(app)/personnel-files/skill-certificate-actions',()=>({listCertificateSkillOptionsAction:vi.fn(),setCertificateSkillAction:vi.fn()}));
vi.mock('@/app/[locale]/(app)/absences/sick-note-actions',()=>({listAbsenceSickNotesAction:transport.list,getOwnAbsenceSickNotesAction:transport.own}));
vi.mock('@/app/[locale]/(app)/personnel-files/sick-note-actions',()=>({unlinkSickNoteAction:transport.unlink,linkSickNoteAction:vi.fn(),listSickLeaveForLinkingAction:transport.leave}));
vi.mock('@tolgee/react',()=>({useTranslate:()=>({t:(_k:string,f:string,v?:Record<string,unknown>)=>f.replace(/\{(\w+)\}/g,(_,k)=>String(v?.[k]??`{${k}}`))})}));
vi.mock('@/components/providers/app-locale-provider',()=>({useAppLocale:()=> 'en-GB'}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock('@/navigation',()=>({Link:({href,children,...props}:{href:string;children:ReactNode})=><a href={href} {...props}>{children}</a>,useRouter:()=>({push:vi.fn(),replace:vi.fn(),refresh:vi.fn()})}));
const target={id:'independent-absence-1',employeeId:'independent-employee-1',startDate:'2026-11-02',endDate:'2026-11-03'};
const capability={employeeId:target.employeeId,categories:['sick_note' as const],today:'2026-11-16',timezone:'Europe/Berlin'};
let linked=true;
const document=()=>({id:'independent-document-1',employeeId:target.employeeId,category:'sick_note',title:'Synthetic independent note',documentDate:'2026-11-02',visibility:'shared',fileName:'synthetic.pdf',mimeType:'application/pdf',sizeBytes:17,createdAt:'2026-11-02T00:00:00Z',payPeriod:null,expiryDate:null,skill:null,absence:linked?target:null});
const clients:QueryClient[]=[];
const client=()=>{const c=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(c);return c;};
function Scope({client,children}:{client:QueryClient;children:ReactNode}){return <QueryClientProvider client={client}><OrganizationContextProvider initialContext={{userId:identity.actor,organizationId:identity.org,employee:null,organizationSettings:null,updatedAt:Date.now()}}>{children}</OrganizationContextProvider></QueryClientProvider>;}
function Readers(){const self=useOwnAbsenceSickNotes([{id:target.id,category:{type:'sick'}}]);const employee=useEmployeeSickLeave(target.employeeId);return <><output aria-label="Independent self marker">{self.markers[target.id]?.count??0}</output><output aria-label="Independent employee count">{employee.data?.find(x=>x.id===target.id)?.sickNoteCount??'loading'}</output><section aria-label="Independent document reader"><PersonnelFilePanel capability={capability}/></section></>;}
const panel=(changed=vi.fn(),absence=target)=><AbsenceSickNotesPanel absence={absence} open onOpenChange={vi.fn()} canAttach={false} manage onChanged={changed}/>;
const sharedButton=()=>screen.findByRole('button',{name:'Unlink Synthetic independent note'});
const selectedButton=()=>screen.findByRole('button',{name:'Unlink Synthetic independent note from its sick leave'});
function held(){let resolve!:(v:unknown)=>void;let reject!:(v:Error)=>void;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
beforeEach(()=>{linked=true;identity.actor='independent-actor-a';identity.org='independent-org-a';identity.pending=false;identity.retained=true;vi.clearAllMocks();transport.list.mockReset().mockImplementation(async()=>({success:true,data:linked?[document()]:[]}));transport.documents.mockReset().mockImplementation(async()=>({success:true,data:{capability,documents:[document()]}}));transport.own.mockReset().mockImplementation(async()=>({success:true,data:{canAttach:true,markers:linked?{[target.id]:{count:1,viewable:true}}:{}}}));transport.leave.mockReset().mockImplementation(async()=>({success:true,data:[{...target,status:'approved',sickDetail:'with_certificate',sickNoteCount:linked?1:0}]}));transport.unlink.mockReset();});
afterEach(()=>{cleanup();for(const c of clients.splice(0))c.clear();});
it.each(['refusal','rejection'] as const)('reserves selected to shared across actor A-B-A and releases after %s',async outcome=>{
 const c=client(),pending=held();transport.unlink.mockReturnValue(pending.promise);
 const content=(selected:boolean)=><Scope client={c}>{selected?<PersonnelFilePanel capability={capability}/>:panel()}</Scope>;
 const view=render(content(true));fireEvent.click(await selectedButton());expect(transport.unlink).toHaveBeenCalledTimes(1);
 identity.actor='independent-actor-b';view.rerender(content(false));await sharedButton();
 identity.actor='independent-actor-a';view.rerender(content(false));const replacement=await sharedButton();expect(replacement.hasAttribute('disabled')).toBe(true);fireEvent.click(replacement);expect(transport.unlink).toHaveBeenCalledTimes(1);
 await act(async()=>{if(outcome==='rejection')pending.reject(new Error('Synthetic rejected transport'));else pending.resolve({success:false,error:'Synthetic retired refusal'});});
 await waitFor(()=>expect(replacement.hasAttribute('disabled')).toBe(false));expect(feedback.error).not.toHaveBeenCalled();expect(feedback.success).not.toHaveBeenCalled();
 transport.unlink.mockResolvedValueOnce({success:false,error:'Synthetic current refusal'});fireEvent.click(replacement);await waitFor(()=>expect(feedback.error).toHaveBeenCalledWith('Synthetic current refusal'));expect(transport.unlink).toHaveBeenCalledTimes(2);
});
it.each(['target','unmount'] as const)('accepted shared unlink refreshes visible public readers after %s retirement',async retirement=>{
 const c=client(),pending=held(),changed=vi.fn();transport.unlink.mockReturnValue(pending.promise);
 const content=(retired=false)=><Scope client={c}><Readers/>{retired&&retirement==='unmount'?null:panel(changed,retired?{...target,id:'independent-absence-2'}:target)}</Scope>;
 const view=render(content());await waitFor(()=>{expect(screen.getByLabelText('Independent self marker').textContent).toBe('1');expect(screen.getByLabelText('Independent employee count').textContent).toBe('1');});fireEvent.click(await sharedButton());view.rerender(content(true));
 await act(async()=>{linked=false;pending.resolve({success:true,data:document()});});
 await waitFor(()=>{expect(screen.getByLabelText('Independent self marker').textContent).toBe('0');expect(screen.getByLabelText('Independent employee count').textContent).toBe('0');expect(within(screen.getByLabelText('Independent document reader')).getByRole('button',{name:'Link Synthetic independent note to sick leave',hidden:true})).toBeTruthy();});
 expect(transport.unlink).toHaveBeenCalledTimes(1);expect(changed).not.toHaveBeenCalled();expect(feedback.success).not.toHaveBeenCalled();expect(feedback.error).not.toHaveBeenCalled();
});
it.each([true,false])('retains current pending unlink through session refresh (retained=%s)',async retained=>{
 const c=client(),pending=held(),changed=vi.fn();transport.unlink.mockReturnValue(pending.promise);const content=()=> <Scope client={c}>{panel(changed)}</Scope>;
 const view=render(content());fireEvent.click(await sharedButton());identity.pending=true;identity.retained=retained;view.rerender(content());const button=await sharedButton();expect(button.hasAttribute('disabled')).toBe(true);fireEvent.click(button);expect(transport.unlink).toHaveBeenCalledTimes(1);
 await act(async()=>{linked=false;pending.resolve({success:true,data:document()});});await waitFor(()=>expect(feedback.success).toHaveBeenCalledWith('Sick note unlinked'));expect(changed).toHaveBeenCalledTimes(1);
});
it('keeps separate QueryClient lifetimes independent for the same actor organization document',async()=>{
 const a=client(),b=client(),first=held(),second=held();transport.unlink.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
 const view=render(<Scope client={a}>{panel()}</Scope>);fireEvent.click(await sharedButton());view.unmount();render(<Scope client={b}>{panel()}</Scope>);const button=await sharedButton();expect(button.hasAttribute('disabled')).toBe(false);fireEvent.click(button);expect(transport.unlink).toHaveBeenCalledTimes(2);await act(async()=>{first.resolve({success:false,error:'Synthetic first refusal'});second.resolve({success:false,error:'Synthetic second refusal'});});expect(feedback.error).toHaveBeenCalledTimes(1);
});
it('retries an actual failed panel read locally and retires an older held target read',async()=>{
 const c=client(),read=held();let oldReads=0;transport.list.mockImplementation((id:string)=>id===target.id?(++oldReads===1?Promise.resolve({success:false,error:'Synthetic failed read'}):read.promise):Promise.resolve({success:true,data:[]}));
 const content=(other=false)=><Scope client={c}>{panel(vi.fn(),other?{...target,id:'independent-new-target'}:target)}</Scope>;
 const view=render(content());await screen.findByRole('alert');expect(screen.queryByText('No sick notes you can open.')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Retry'}));expect(transport.list).toHaveBeenCalledTimes(2);view.rerender(content(true));await screen.findByText('No sick notes you can open.');await act(async()=>read.resolve({success:true,data:[document()]}));expect(screen.queryByText('Synthetic independent note')).toBeNull();expect(transport.unlink).not.toHaveBeenCalled();
});
it('keeps the public loading heading safe while no session identity is available',()=>{
 identity.pending=true;identity.retained=false;
 render(<SickLeaveLoadingHeading/>);
 expect(screen.getAllByRole('heading',{level:1}).map(h=>h.textContent)).toEqual(['Sick leave']);
 expect(screen.queryByRole('table')).toBeNull();
 expect(screen.queryByRole('button',{name:/Attach|Unlink|Link sick/})).toBeNull();
 expect(transport.list).not.toHaveBeenCalled();
});
