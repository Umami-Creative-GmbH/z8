// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationContextProvider } from '@/components/providers/organization-context-provider';
import { SickLeaveOverview as CurrentOverview } from '@/components/personnel-file/sick-leave-overview';
import { SickLeaveOverview as ParentOverview } from './parent-overview';
import { parseSickLeaveOverviewParams } from '@/lib/personnel-file/sick-leave-overview';
import { Temporal } from 'temporal-polyfill';
const actions=vi.hoisted(()=>({list:vi.fn(),unlink:vi.fn()}));
const auth=vi.hoisted(()=>({organizationId:'org-a',pending:false}));
const feedback=vi.hoisted(()=>({success:vi.fn(),error:vi.fn()}));
vi.mock('@/lib/auth-client',()=>({useSession:()=>({data:{user:{id:'actor-a'},session:{activeOrganizationId:auth.organizationId}},isPending:auth.pending})}));
vi.mock('sonner',()=>({toast:feedback}));
vi.mock('@/app/[locale]/(app)/absences/sick-note-actions',()=>({listAbsenceSickNotesAction:actions.list}));
vi.mock('@/app/[locale]/(app)/personnel-files/sick-note-actions',()=>({unlinkSickNoteAction:actions.unlink,linkSickNoteAction:vi.fn(),listSickLeaveForLinkingAction:vi.fn()}));
vi.mock('@tolgee/react',()=>({useTranslate:()=>({t:(_key:string,fallback:string,values?:Record<string,unknown>)=>fallback.replace(/\{(\w+)\}/g,(_,key)=>String(values?.[key]??`{${key}}`))})}));
vi.mock('@/components/providers/app-locale-provider',()=>({useAppLocale:()=> 'en-GB'}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock('@/navigation',()=>({Link:({href,children,...props}:{href:string;children:ReactNode})=><a href={href} {...props}>{children}</a>,useRouter:()=>({push:vi.fn(),refresh:vi.fn(),replace:vi.fn()})}));
const note={id:'note-1',employeeId:'employee-1',category:'sick_note',title:'Synthetic current note',documentDate:'2026-11-01',visibility:'hr_only',fileName:'synthetic.pdf',mimeType:'application/pdf',sizeBytes:12,createdAt:'2026-11-01T00:00:00Z',absence:null};
const row={absenceId:'absence-1',employeeId:'employee-1',employeeName:'Synthetic employee',employeeNumber:'0001',isFormer:false,startDate:'2026-11-01',startPeriod:'full_day',endDate:'2026-11-02',endPeriod:'full_day',status:'approved',sickDetail:'with_certificate',absenceDays:1,sickNoteCount:1,sickNotes:[{id:note.id,title:'Synthetic row note'}]} as const;
const defaults=parseSickLeaveOverviewParams({},Temporal.PlainDate.from('2026-11-16'));
const clients:QueryClient[]=[];
beforeEach(()=>{auth.organizationId='org-a';auth.pending=false;vi.clearAllMocks();actions.list.mockReset().mockResolvedValue({success:true,data:[note]});actions.unlink.mockReset();});
afterEach(()=>{cleanup();for(const client of clients.splice(0))client.clear();});
describe('canonical provider original request reservation',()=>{
 it.each(['candidate','parent'] as const)('%s prevents a second same-document unlink after organization A-B-A remount',async(version)=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);const resolves:Array<(v:unknown)=>void>=[];actions.unlink.mockImplementation(()=>new Promise(r=>resolves.push(r)));
  const Overview=version==='candidate'?CurrentOverview:ParentOverview;
  const content=()=> <QueryClientProvider client={client}><OrganizationContextProvider initialContext={{userId:'actor-a',organizationId:auth.organizationId,employee:null,organizationSettings:null,updatedAt:Date.now()}}><Overview userId="actor-a" organizationId="org-a" filters={defaults} defaultRange={defaults} rows={[row]} total={1} page={1} pageCount={1} employees={[]} teams={[]}/></OrganizationContextProvider></QueryClientProvider>;
  const view=render(content());fireEvent.click(screen.getByRole('button',{name:/Attach or link sick notes for/}));fireEvent.click(await screen.findByRole('button',{name:'Unlink Synthetic current note'}));expect(actions.unlink).toHaveBeenCalledTimes(1);
  auth.organizationId='org-b';view.rerender(content());expect(screen.queryByRole('dialog')).toBeNull();auth.organizationId='org-a';view.rerender(content());
  fireEvent.click(screen.getByRole('button',{name:/Attach or link sick notes for/}));fireEvent.click(await screen.findByRole('button',{name:'Unlink Synthetic current note'}));
  const count=actions.unlink.mock.calls.length;await act(async()=>{for(const settle of resolves)settle({success:false,error:'Synthetic refusal'});});expect(count).toBe(1);
 });
});
