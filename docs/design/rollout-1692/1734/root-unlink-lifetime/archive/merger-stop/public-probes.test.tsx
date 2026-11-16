// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Activity, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbsenceSickNotesPanel } from '@/components/absences/sick-notes/absence-sick-notes-panel';
import { SickLeaveOverview } from '@/components/personnel-file/sick-leave-overview';
import { Temporal } from 'temporal-polyfill';
import { parseSickLeaveOverviewParams } from '@/lib/personnel-file/sick-leave-overview';
const actions=vi.hoisted(()=>({list:vi.fn(),unlink:vi.fn()}));
const feedback=vi.hoisted(()=>({success:vi.fn(),error:vi.fn()}));
const scope=vi.hoisted(()=>({userId:'actor-a',activeOrganizationId:'org-a'}));
vi.mock('sonner',()=>({toast:feedback}));
vi.mock('@/components/providers/organization-context-provider',()=>({useOrganization:()=>scope}));
vi.mock('@/app/[locale]/(app)/absences/sick-note-actions',()=>({listAbsenceSickNotesAction:actions.list}));
vi.mock('@/app/[locale]/(app)/personnel-files/sick-note-actions',()=>({unlinkSickNoteAction:actions.unlink,linkSickNoteAction:vi.fn(),listSickLeaveForLinkingAction:vi.fn()}));
vi.mock('@tolgee/react',()=>({useTranslate:()=>({t:(_key:string,fallback:string,values?:Record<string,unknown>)=>fallback.replace(/\{(\w+)\}/g,(_,key)=>String(values?.[key]??`{${key}}`))})}));
vi.mock('@/components/providers/app-locale-provider',()=>({useAppLocale:()=> 'en-GB'}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock('@/navigation',()=>({Link:({href,children,...props}:{href:string;children:ReactNode})=><a href={href} {...props}>{children}</a>,useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
const note={id:'note-1',employeeId:'employee-1',category:'sick_note',title:'Synthetic current note',documentDate:'2026-11-01',visibility:'hr_only',fileName:'synthetic.pdf',mimeType:'application/pdf',sizeBytes:12,createdAt:'2026-11-01T00:00:00Z',absence:null};
const target={id:'absence-1',employeeId:'employee-1',startDate:'2026-11-01',endDate:'2026-11-02'};
const row={absenceId:target.id,employeeId:target.employeeId,employeeName:'Synthetic employee',employeeNumber:'0001',isFormer:false,startDate:target.startDate,startPeriod:'full_day',endDate:target.endDate,endPeriod:'full_day',status:'approved',sickDetail:'with_certificate',absenceDays:1,sickNoteCount:1,sickNotes:[{id:note.id,title:'Synthetic row note'}]} as const;
const defaults=parseSickLeaveOverviewParams({},Temporal.PlainDate.from('2026-11-16'));
const clients:QueryClient[]=[];
function makeClient(){const c=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(c);return c;}
function overview(){return <SickLeaveOverview userId="actor-a" organizationId="org-a" filters={defaults} defaultRange={defaults} rows={[row]} total={1} page={1} pageCount={1} employees={[]} teams={[]}/>;}
beforeEach(()=>{scope.userId='actor-a';scope.activeOrganizationId='org-a';vi.clearAllMocks();actions.list.mockReset().mockResolvedValue({success:true,data:[note]});actions.unlink.mockReset();});
afterEach(()=>{cleanup();for(const c of clients.splice(0))c.clear();});
describe('fresh public R051 lifetime probes',()=>{
 it.each(['hidden','target','actor','organization'] as const)('holds one shared-panel unlink reservation across %s retirement',async(kind)=>{
  const client=makeClient();let resolve:(v:unknown)=>void=()=>{};actions.unlink.mockImplementation(()=>new Promise(r=>resolve=r));const onChanged=vi.fn();
  const content=(mode:'visible'|'hidden'='visible',id=target.id)=><QueryClientProvider client={client}><Activity mode={mode}><AbsenceSickNotesPanel absence={{...target,id}} open onOpenChange={vi.fn()} canAttach={false} manage onChanged={onChanged}/></Activity></QueryClientProvider>;
  const view=render(content());fireEvent.click(await screen.findByRole('button',{name:'Unlink Synthetic current note'}));expect(actions.unlink).toHaveBeenCalledTimes(1);
  if(kind==='hidden'){view.rerender(content('hidden'));view.rerender(content());}
  if(kind==='target'){view.rerender(content('visible','absence-2'));}
  if(kind==='actor'){scope.userId='actor-b';view.rerender(content());scope.userId='actor-a';view.rerender(content());}
  if(kind==='organization'){scope.activeOrganizationId='org-b';view.rerender(content());scope.activeOrganizationId='org-a';view.rerender(content());}
  fireEvent.click(await screen.findByRole('button',{name:'Unlink Synthetic current note'}));expect(actions.unlink).toHaveBeenCalledTimes(1);
  await act(async()=>resolve({success:true}));expect(onChanged).not.toHaveBeenCalled();expect(feedback.success).not.toHaveBeenCalled();
 });
 it('keeps the assembled overview command reserved during displayed organization A-B-A',async()=>{
  const client=makeClient();let resolve:(v:unknown)=>void=()=>{};actions.unlink.mockImplementation(()=>new Promise(r=>resolve=r));const content=()=> <QueryClientProvider client={client}>{overview()}</QueryClientProvider>;
  const view=render(content());fireEvent.click(screen.getByRole('button',{name:/Attach or link sick notes for/}));fireEvent.click(await screen.findByRole('button',{name:'Unlink Synthetic current note'}));expect(actions.unlink).toHaveBeenCalledTimes(1);
  scope.activeOrganizationId='org-b';view.rerender(content());expect(screen.queryByRole('dialog')).toBeNull();scope.activeOrganizationId='org-a';view.rerender(content());
  fireEvent.click(screen.getByRole('button',{name:/Attach or link sick notes for/}));fireEvent.click(await screen.findByRole('button',{name:'Unlink Synthetic current note'}));
  const count=actions.unlink.mock.calls.length;await act(async()=>resolve({success:false,error:'Synthetic refusal'}));expect(count).toBe(1);
 });
});
