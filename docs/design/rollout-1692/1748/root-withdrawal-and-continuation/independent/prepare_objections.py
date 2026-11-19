from review import *
def bridge(path,text):
 p=ROOT/path; assert not p.exists(); data=text.encode(); p.write_bytes(data)
 entries=json.loads((SAFE/'bridges.json').read_text()); entries.append(dict(path=path,bytes=len(data),sha256=digest(data))); save('bridges.json',entries)
src=(SAFE/'conversion-review.test.tsx').read_text()
src=src[:src.index('it("independent positive control:')]
src=src.replace('import type { ReactNode } from "react";', 'import { Activity, type ReactNode } from "react";')
src=src.replace('push: vi.fn() }','push: vi.fn(), refresh: vi.fn(), pending: false }')
src=src.replace('isPending: false, data:', 'isPending: external.pending, data:')
src=src.replace('refresh: vi.fn()', 'refresh: external.refresh',1) if False else src
src=src.replace('push: external.push, refresh: vi.fn()', 'push: external.push, refresh: external.refresh')
src=src.replace('  vi.resetAllMocks();','  vi.resetAllMocks(); external.pending = false;')
src=src.replace('function mount(baseline = false)', 'function mount(options: { statuses?: (number | Error)[]; mode?: "visible" | "hidden" } = {})')
src=src.replace('    return Response.json(detail);','    const status = options.statuses?.shift() ?? 200;\n    if (status instanceof Error) throw status;\n    return Response.json(status === 200 ? detail : {}, {status});')
src=src.replace('  const Component = baseline ? BaselineDetail : TravelExpenseClaimDetail;\n  render(', '  const Component = TravelExpenseClaimDetail;\n  const tree = (mode: "visible" | "hidden" = "visible") => (')
src=src.replace('      <Component userId=', '      <Activity mode={mode}><Component userId=')
src=src.replace('claimId={claimId} />','claimId={claimId} /></Activity>')
src=src.replace('  return client;','  const view = render(tree());\n  return {client, view, tree};')
src+='''
it.each(["Unauthorized", "Travel expense claim not found"].flatMap(error => ["report", "null"].map(initial => ({error, initial}))))(
  "assembled withdrawal $initial / $error survives repeated failures, then fresh local Retry", async ({error, initial}) => {
  external.readConversion.mockResolvedValueOnce(initial === "report" ? available : {success:true,data:null})
    .mockResolvedValueOnce({success:false,error}).mockResolvedValueOnce(outage)
    .mockRejectedValueOnce(new TypeError("Synthetic rejected transport")).mockResolvedValueOnce(outage)
    .mockResolvedValueOnce(initial === "report" ? {success:true,data:{reportId:"fresh-report"}} : {success:true,data:null});
  const {client} = mount();
  await screen.findByRole(initial === "report" ? "link" : "button", {name:initial === "report" ? "Open the report" : "Continue as report"});
  await refresh(client); await screen.findByText(unavailableText);
  const hidden = () => { expect(reportLink()).toBeNull(); expect(screen.queryByRole("button",{name:"Continue as report"})).toBeNull(); claimEvidenceRemains(); };
  hidden();
  for (let i=0;i<3;i++) { await refresh(client); await screen.findByText(outageText); hidden(); }
  // Each family refresh obtained a fresh successful detail, never authorizing the conversion reader.
  expect(external.readConversion).toHaveBeenCalledTimes(5);
  fireEvent.click(screen.getByRole("button",{name:"Retry"}));
  await screen.findByRole(initial === "report" ? "link" : "button", {name:initial === "report" ? "Open the report" : "Continue as report"});
  if (initial === "report") expect(reportLink()?.getAttribute("href")).toBe("/travel-expenses/reports/fresh-report");
  expect(external.readConversion).toHaveBeenCalledTimes(6); expect(external.convert).not.toHaveBeenCalled(); expect(external.push).not.toHaveBeenCalled();
});

it("assembled detail withdrawal retires pending conversion and only fresh independent reads restore", async () => {
  const pending=Promise.withResolvers<any>(); external.convert.mockReturnValueOnce(pending.promise);
  external.readConversion.mockResolvedValueOnce({success:true,data:null}).mockResolvedValueOnce(outage).mockResolvedValueOnce(available);
  const {client}=mount({statuses:[200,404,503,503,200]});
  fireEvent.click(await screen.findByRole("button",{name:"Continue as report"}));
  await vi.waitFor(()=>expect(external.convert).toHaveBeenCalledTimes(1));
  await refresh(client); await screen.findByText("Claim not found or access is no longer available.");
  await act(async()=>{pending.resolve({success:true,data:{kind:"converted",reportId:"retired"}}); await pending.promise;});
  await vi.waitFor(()=>expect(client.isFetching()).toBe(0));
  expect(external.push).not.toHaveBeenCalled(); expect(reportLink()).toBeNull(); expect(screen.queryByText(detail.claim.notes)).toBeNull();
  // Failed detail retry cannot revive either reader.
  fireEvent.click(screen.getByRole("button",{name:"Retry"})); await vi.waitFor(()=>expect(client.isFetching()).toBe(0));
  expect(reportLink()).toBeNull(); expect(screen.queryByText(detail.claim.notes)).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Retry"}));
  await screen.findByText(detail.claim.notes); await screen.findByText(outageText); expect(reportLink()).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Retry"})); await screen.findByRole("link",{name:"Open the report"});
});

it.each(["Activity", "pending session"])("assembled %s retirement blocks an earlier conversion and reads fresh on return", async kind => {
  const pending=Promise.withResolvers<any>(); external.convert.mockReturnValueOnce(pending.promise);
  external.readConversion.mockResolvedValueOnce({success:true,data:null}).mockResolvedValueOnce(outage).mockResolvedValueOnce(available);
  const {client,view,tree}=mount();
  fireEvent.click(await screen.findByRole("button",{name:"Continue as report"})); await vi.waitFor(()=>expect(external.convert).toHaveBeenCalledTimes(1));
  if (kind === "pending session") external.pending=true;
  view.rerender(tree(kind === "Activity" ? "hidden" : "visible"));
  await act(async()=>{pending.resolve({success:true,data:{kind:"converted",reportId:"retired"}}); await pending.promise;});
  expect(external.push).not.toHaveBeenCalled();
  external.pending=false; view.rerender(tree());
  await screen.findByText(outageText); expect(reportLink()).toBeNull(); claimEvidenceRemains();
  fireEvent.click(screen.getByRole("button",{name:"Retry"})); await screen.findByRole("link",{name:"Open the report"});
  expect(external.push).not.toHaveBeenCalled();
});

it("assembled removal followed by a new observer cannot revive withdrawn evidence", async()=>{
  external.readConversion.mockResolvedValueOnce(available).mockResolvedValueOnce({success:false,error:"Unauthorized"}).mockResolvedValueOnce(outage);
  const {client,view,tree}=mount(); await screen.findByRole("link",{name:"Open the report"}); await refresh(client); await screen.findByText(unavailableText);
  view.rerender(tree("hidden")); act(()=>client.removeQueries({queryKey:["travel-expenses"]})); view.rerender(tree());
  await screen.findByText(outageText); expect(reportLink()).toBeNull(); expect(screen.queryByRole("button",{name:"Continue as report"})).toBeNull(); claimEvidenceRemains();
});
'''
bridge('apps/webapp/src/test/review1748-assembled-objections.test.tsx',src)
# Original detail predicates and controls use the real provider and real readers.
src=(ROOT/'apps/webapp/src/components/travel-expenses/travel-expense-claim-withdrawal.test.tsx').read_text()
src=src[:src.index('it("control:')]
src=src.replace('import { TravelExpenseClaimDetail } from "@/components/travel-expenses/travel-expense-claim-detail";', 'import { TravelExpenseClaimDetail } from "@/components/travel-expenses/travel-expense-claim-detail";\nimport { TravelExpenseClaimDetail as BaselineDetail } from "@/components/travel-expenses/review1748-independent-baseline-detail";')
src=src.replace('function mount(statuses: (number | Error)[]) {','function mount(statuses: (number | Error)[], baseline = false) {\n const Component = baseline ? BaselineDetail : TravelExpenseClaimDetail;')
src=src.replace('<TravelExpenseClaimDetail','<Component')
src+='''
it("original detail authorized outage control retains original notes and receipt links",async()=>{
 const client=mount([200,503]); await screen.findByText(record.claim.notes); await act(()=>client.invalidateQueries({queryKey:["travel-expenses"]})); await screen.findByText("Unable to load this claim. Please retry.");
 expect(screen.getByText(record.claim.notes)).toBeTruthy(); expect(screen.getByRole("link",{name:"Download review-receipt.pdf"})).toBeTruthy();
});
it("original detail critical sequence 200 -> 404 -> 503 keeps evidence withdrawn",async()=>{
 const client=mount([200,404,503]); await screen.findByText(record.claim.notes); await act(()=>client.invalidateQueries({queryKey:["travel-expenses"]})); await screen.findByText("Claim not found or access is no longer available.");
 expect(screen.queryByText(record.claim.notes)).toBeNull(); expect(screen.queryByRole("link",{name:"Download review-receipt.pdf"})).toBeNull();
 await act(()=>client.invalidateQueries({queryKey:["travel-expenses"]})); await screen.findByText("Unable to load this claim. Please retry."); await vi.waitFor(()=>expect(client.isFetching()).toBe(0));
 expect(screen.queryByText(record.claim.notes)).toBeNull(); expect(screen.queryByRole("link",{name:"Download review-receipt.pdf"})).toBeNull();
});
it("pinned baseline detail control confirms inherited evidence retention on 404 and later outage",async()=>{
 const client=mount([200,404,503],true); await screen.findByText(record.claim.notes); await act(()=>client.invalidateQueries({queryKey:["travel-expenses"]})); await vi.waitFor(()=>expect(client.isFetching()).toBe(0));
 expect(screen.getByText(record.claim.notes)).toBeTruthy(); expect(screen.getByRole("link",{name:"Download review-receipt.pdf"})).toBeTruthy();
 await act(()=>client.invalidateQueries({queryKey:["travel-expenses"]})); await vi.waitFor(()=>expect(client.isFetching()).toBe(0));
 expect(screen.getByText(record.claim.notes)).toBeTruthy(); expect(screen.getByRole("link",{name:"Download review-receipt.pdf"})).toBeTruthy();
});
'''
bridge('apps/webapp/src/test/review1748-original-detail.test.tsx',src)
