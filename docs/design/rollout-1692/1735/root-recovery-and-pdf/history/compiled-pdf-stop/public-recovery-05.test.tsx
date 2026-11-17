// @vitest-environment jsdom
// Independent public seam: actual provider/store/QueryClient/report components/hooks.
// Synthetic identity, HTTP/action transports, PDF work and browser-only API shims.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Activity, useLayoutEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { ReportsContainer } from "@/components/reports/reports-container";
import { ReportEmployeeSelector } from "@/components/reports/report-employee-selector";
import { useReportEmployees } from "@/hooks/use-report-employees";
import type { ReportData } from "@/lib/reports/types";

const b = vi.hoisted(() => ({
  fetch: vi.fn(), read: vi.fn(), generate: vi.fn(), pdf: vi.fn(), success: vi.fn(), error: vi.fn(),
  listeners: new Set<(value: unknown) => void>(),
  sessionSubscribers: new Set<()=>void>(),
  session: { data: {user:{id:"actor-a"}, session:{activeOrganizationId:"org-a"}}, isPending:false },
}));
vi.mock("@/lib/auth-client", async () => { const {useSyncExternalStore}=await import("react"); return {useSession:()=>useSyncExternalStore((fn)=>{b.sessionSubscribers.add(fn);return()=>b.sessionSubscribers.delete(fn);},()=>b.session,()=>b.session), authClient:{$store:{atoms:{session:{subscribe:(fn:(value:unknown)=>void)=>{ b.listeners.add(fn); return ()=>b.listeners.delete(fn); }}}}}}; });
vi.mock("@/navigation", () => ({useRouter:()=>({replace:vi.fn()})}));
vi.mock("@tolgee/react", () => ({useTranslate:()=>({t:(_:string,fallback:string)=>fallback})}));
vi.mock("@/app/[locale]/(app)/reports/actions", () => ({getAccessibleEmployeesAction:b.read, generateReport:b.generate}));
vi.mock("@/components/providers/app-locale-provider", () => ({useAppLocale:()=>"en"}));
vi.mock("@/hooks/use-display-context", () => ({useDisplayContext:()=>({locale:"en-US",timezone:"Europe/Berlin",timeFormat:"24h"})}));
vi.mock("@/components/closed-months/month-closure-strip", () => ({MonthClosureStrip:()=>null}));
vi.mock("@/lib/reports/exporters/pdf-exporter", () => ({exportToPDF:b.pdf,generatePDFFilename:()=>"synthetic.pdf"}));
vi.mock("sonner", () => ({toast:{success:b.success,error:b.error}}));

function person(id:string,name:string) { return {id,name,firstName:name,lastName:null,email:`${id}@example.test`,image:null,pronouns:null,position:null,role:"employee" as const}; }
function roster(label="Current") { return {success:true as const,data:[person("employee-a",`${label} Self`),person("colleague-a",`${label} Colleague`)]}; }
function context() {
  return new Response(JSON.stringify({user:b.session.data.user,session:b.session.data.session,employee:{employeeId:"employee-a",organizationId:b.session.data.session.activeOrganizationId,role:"admin"},organizationSettings:{organizationId:b.session.data.session.activeOrganizationId,timezone:"Europe/Berlin",shiftsEnabled:false,projectsEnabled:false,surchargesEnabled:false,demoDataEnabled:false,worksCouncilEnabled:false,billableTimeEnabled:false,personnelFilesEnabled:false,equipmentEnabled:false,deletedAt:null}}));
}
function outage(message="Synthetic settings unavailable") { return new Response(JSON.stringify({error:message}),{status:503}); }
const report:ReportData = {employee:{id:"employee-a",name:"Applied Self",customFields:[]},period:{startDate:"2025-01-01",endDate:"2025-12-31",label:"2025 fixed report"},workHours:{totalHours:16,totalMinutes:960,workDays:2,averagePerDay:8,byMonth:new Map([["2025-01",{hours:16,days:2}]])},absences:{totalDays:1,byCategory:new Map([["Vacation",{days:1}]]),vacation:{approved:1,pending:0},sick:{approved:0,pending:0},homeOffice:{days:1,hoursWorked:8,dateDetails:[{date:"2025-01-08",hours:8}]},other:{approved:0,pending:0}},complianceMetrics:{attendancePercentage:100,overtimeMinutes:0,underTimeMinutes:0}};
const clients:QueryClient[]=[];
beforeEach(()=>{
  vi.resetAllMocks(); b.listeners.clear(); b.sessionSubscribers.clear();
  b.session={data:{user:{id:"actor-a"},session:{activeOrganizationId:"org-a"}},isPending:false};
  b.fetch.mockImplementation(async()=>context()); b.read.mockResolvedValue(roster());
  b.generate.mockResolvedValue({success:true,data:report});
  vi.stubGlobal("fetch",b.fetch);
  vi.stubGlobal("ResizeObserver",class {observe(){} unobserve(){} disconnect(){}});
  Element.prototype.scrollIntoView=vi.fn();
});
afterEach(()=>{cleanup();for(const c of clients)c.clear();clients.length=0;vi.unstubAllGlobals();vi.restoreAllMocks();});
function mount(content?:React.ReactNode) {
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);
  client.setQueryData(["reports","peer"],"peer retained");
  const tree=(mode:"visible"|"hidden"="visible")=><QueryClientProvider client={client}><OrganizationContextProvider initialContext={null}><Activity mode={mode}>{content??<ReportsContainer currentEmployeeId="employee-a" userId="actor-a" organizationId="org-a"/>}</Activity></OrganizationContextProvider></QueryClientProvider>;
  const view=render(tree());return {client,view,tree};
}
async function ready(){await waitFor(()=>expect(screen.getByRole("button",{name:"Generate Report"})).toHaveProperty("disabled",false));}
async function retryIn(text:string) {const node=await screen.findByText(text);const alert=node.closest('[role="alert"]');if(!alert)throw Error("Expected local alert");return within(alert).getByRole("button",{name:"Retry"});}
async function selectPeriod(){fireEvent.click(screen.getByRole("combobox",{name:"Period"}));fireEvent.click(await screen.findByRole("option",{name:"Last Year"}));}
function publish(actor:string,org:string,pending=false){b.session={data:{user:{id:actor},session:{activeOrganizationId:org}},isPending:pending};for(const fn of b.listeners)fn(b.session);for(const fn of b.sessionSubscribers)fn();}

it("independent settings 503 and pending rejection retain the selected period and block native submission until local recovery",async()=>{
  const {client}=mount();await ready();await selectPeriod();
  const selected=screen.getByRole("combobox",{name:"Period"}).textContent;
  b.fetch.mockResolvedValueOnce(outage());
  await act(async()=>client.refetchQueries({queryKey:["organization-context"]}));
  const retry=await retryIn("Synthetic settings unavailable");
  const generate=screen.getByRole("button",{name:"Generate Report"});expect(generate).toHaveProperty("disabled",true);
  await act(async()=>fireEvent.submit(generate.closest("form")!));expect(b.generate).not.toHaveBeenCalled();
  const held=Promise.withResolvers<Response>();b.fetch.mockReturnValueOnce(held.promise);
  await act(async()=>{fireEvent.click(retry);fireEvent.click(retry);});expect(b.fetch).toHaveBeenCalledTimes(3);
  expect(screen.getByRole("button",{name:/^Retrying/})).toHaveProperty("disabled",true);
  await act(async()=>held.reject(new Error("Synthetic retry connection lost")));
  await act(async()=>fireEvent.click(await retryIn("Synthetic retry connection lost")));
  await ready();expect(screen.getByRole("combobox",{name:"Period"}).textContent).toBe(selected);
  expect(b.fetch).toHaveBeenCalledTimes(4);expect(b.generate).not.toHaveBeenCalled();
});

it.each(["refusal","rejection"])("independent roster %s recovers actual dialog options and submits selected colleague only after explicit Generate",async(outcome)=>{
  if(outcome==="refusal")b.read.mockResolvedValueOnce({success:false,error:"Synthetic refused roster"});else b.read.mockRejectedValueOnce(new Error("Synthetic rejected roster"));
  mount();const retry=await retryIn("Unable to load team members");await ready();expect(retry.getAttribute("type")).toBe("button");
  await act(async()=>fireEvent.click(retry));const employee=await screen.findByRole("combobox",{name:"Employee"});
  fireEvent.click(employee);const option=await screen.findByRole("option",{name:/Current Colleague/});
  await act(async()=>fireEvent.click(option));await waitFor(()=>expect(screen.getByRole("combobox",{name:"Employee"}).textContent).toContain("Current Colleague"));
  expect(b.generate).not.toHaveBeenCalled();await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Generate Report"})));
  await waitFor(()=>expect(b.generate).toHaveBeenCalledTimes(1));expect(b.generate.mock.calls[0][0]).toBe("colleague-a");expect(b.read).toHaveBeenCalledTimes(2);
});

it("independent repeated roster Retry coalesces held transport and remains recoverable after another refusal",async()=>{
  b.read.mockResolvedValue({success:false,error:"Synthetic initial roster refusal"});mount();
  const retry=await retryIn("Unable to load team members");const held=Promise.withResolvers<unknown>();b.read.mockReturnValueOnce(held.promise);
  await act(async()=>{fireEvent.click(retry);fireEvent.click(retry);fireEvent.click(retry);});expect(b.read).toHaveBeenCalledTimes(2);
  await waitFor(()=>{const status=screen.queryByRole("status",{name:"Loading team members"});const pending=screen.queryByRole("button",{name:/^Retrying/});expect(status??pending).not.toBeNull();if(status)expect(status.getAttribute("aria-busy")).toBe("true");if(pending)expect(pending).toHaveProperty("disabled",true);});
  await act(async()=>held.resolve({success:false,error:"Still refused"}));const again=await retryIn("Unable to load team members");b.read.mockResolvedValue(roster("Recovered"));
  await act(async()=>fireEvent.click(again));expect((await screen.findByRole("combobox",{name:"Employee"})).textContent).toContain("Recovered Self");expect(b.read).toHaveBeenCalledTimes(3);expect(b.generate).not.toHaveBeenCalled();
});

it.each(["success","refusal","rejection"])("independent Activity retires pending roster Retry %s and preserves exact peer cache",async(outcome)=>{
  b.read.mockResolvedValueOnce({success:false,error:"Synthetic initial refusal"});const held=Promise.withResolvers<unknown>();b.read.mockReturnValueOnce(held.promise);b.read.mockResolvedValue(roster("New"));
  const {client,view,tree}=mount();await act(async()=>fireEvent.click(await retryIn("Unable to load team members")));expect(b.read).toHaveBeenCalledTimes(2);
  const oldKeys=client.getQueryCache().findAll({queryKey:["reports","employees"]}).map(q=>q.queryKey);
  await act(async()=>view.rerender(tree("hidden")));await act(async()=>view.rerender(tree("visible")));
  expect((await screen.findByRole("combobox",{name:"Employee"})).textContent).toContain("New Self");expect(b.read).toHaveBeenCalledTimes(3);
  await act(async()=>{if(outcome==="rejection")held.reject(new Error("Retired rejected"));else held.resolve(outcome==="success"?roster("Retired"):{success:false,error:"Retired refused"});});
  expect(screen.getByRole("combobox",{name:"Employee"}).textContent).toContain("New Self");expect(screen.queryByText(/Retired/)).toBeNull();
  await waitFor(()=>{for(const key of oldKeys)expect(client.getQueryCache().find({queryKey:key,exact:true})).toBeUndefined();});expect(client.getQueryData(["reports","peer"])).toBe("peer retained");
});

it("independent old public refetch cannot dispatch after actor/org A-B-A or pending retained session retirement",async()=>{
  const callbacks:Array<()=>Promise<void>>=[];
  function Probe(){const state=useReportEmployees("employee-a");useLayoutEffect(()=>{callbacks.push(state.refetch);},[state.refetch]);return <ReportEmployeeSelector currentEmployeeId="employee-a" selectedEmployeeId="employee-a" onEmployeeChange={()=>{}}/>;}
  const {client,view,tree}=mount(<Probe/>);await screen.findByRole("combobox",{name:"Employee"});const retired=callbacks.at(-1)!;console.info("independent-refetch-stage: admitted",b.read.mock.calls.length);
  b.read.mockImplementation(()=>new Promise(()=>{}));
  await act(async()=>{publish("actor-b","org-b");view.rerender(tree());});
  await act(async()=>{publish("actor-a","org-a");view.rerender(tree());});
  console.info("independent-refetch-stage: ABA",b.read.mock.calls.length);const before=b.read.mock.calls.length;await act(async()=>retired());expect(b.read).toHaveBeenCalledTimes(before);expect(screen.queryByRole("combobox",{name:"Employee"})).toBeNull();
  console.info("independent-refetch-stage: retired callback settled",b.read.mock.calls.length);const current=callbacks.at(-1)!;await act(async()=>{publish("actor-a","org-a",true);view.rerender(tree());});
  console.info("independent-refetch-stage: pending",b.read.mock.calls.length);const pendingCalls=b.read.mock.calls.length;await act(async()=>current());expect(b.read).toHaveBeenCalledTimes(pendingCalls);expect(client.getQueryData(["reports","peer"])).toBe("peer retained");
});

it("independent Activity and batched actor/org retirement suppress held generation and late PDF download effects",async()=>{
  const {view,tree}=mount();await ready();await selectPeriod();await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Generate Report"})));
  await screen.findByRole("heading",{name:"Applied Self"});const held=Promise.withResolvers<Uint8Array>();b.pdf.mockReturnValueOnce(held.promise);
  const create=vi.fn();Object.defineProperty(URL,"createObjectURL",{configurable:true,value:create});
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Export PDF"})));expect(b.pdf).toHaveBeenCalledTimes(1);
  await act(async()=>{publish("actor-b","org-b");publish("actor-a","org-a");view.rerender(tree());});
  await act(async()=>held.resolve(new Uint8Array([37,80,68,70])));expect(create).not.toHaveBeenCalled();expect(screen.queryByRole("heading",{name:"Applied Self"})).toBeNull();
  await ready();const generation=Promise.withResolvers<unknown>();b.generate.mockReturnValueOnce(generation.promise);
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Generate Report"})));await act(async()=>view.rerender(tree("hidden")));await act(async()=>view.rerender(tree("visible")));
  await act(async()=>generation.resolve({success:true,data:report}));expect(screen.queryByRole("heading",{name:"Applied Self"})).toBeNull();
});
