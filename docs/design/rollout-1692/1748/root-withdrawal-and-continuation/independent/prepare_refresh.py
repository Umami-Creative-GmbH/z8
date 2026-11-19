from review import *
src=(SAFE/'conversion-review.test.tsx').read_text().split('it("independent positive control:')[0]
src=src.replace('import { TravelExpenseClaimDetail as BaselineDetail } from "@/components/travel-expenses/review1748-independent-baseline-detail";','import { HeaderRefreshButton } from "@/components/header-refresh-button";\nimport { ViewRefreshProvider } from "@/components/providers/view-refresh-provider";\nimport { SWRConfig } from "swr";')
src=src.replace('push: vi.fn() }','push: vi.fn(), routerRefresh: vi.fn() }')
src=src.replace('const clients: QueryClient[] = [];','const clients: QueryClient[] = [];\nlet contextStatus=200; const statuses:number[]=[];')
src=src.replace('  vi.resetAllMocks();','  vi.resetAllMocks(); contextStatus=200; statuses.length=0;')
src=src.replace('function mount(baseline = false)', 'function mount()')
src=src.replace('    if (url === "/api/auth/context") return Response.json({','    if (url === "/api/auth/context") { if (contextStatus !== 200) return Response.json({}, {status:contextStatus}); return Response.json({')
src=src.replace('organizationSettings: null,\n    });','organizationSettings: null,\n    }); }')
src=src.replace('    return Response.json(detail);','    const status=statuses.shift() ?? 200; return Response.json(status === 200 ? detail : {},{status});')
src=src.replace('  const Component = baseline ? BaselineDetail : TravelExpenseClaimDetail;','  const Component = TravelExpenseClaimDetail;')
src=src.replace('  render(<QueryClientProvider client={client}>','  render(<QueryClientProvider client={client}><SWRConfig value={{provider:()=>new Map(),dedupingInterval:0}}><ViewRefreshProvider><HeaderRefreshButton/>')
src=src.replace('  </QueryClientProvider>);','  </ViewRefreshProvider></SWRConfig></QueryClientProvider>);')
src+='''
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:external.routerRefresh})}));
vi.mock("sonner",()=>({toast:{error:vi.fn()}}));
async function header(){
 const b=screen.getByRole("button",{name:"Refresh data"}); fireEvent.click(b);
 await vi.waitFor(()=>expect(b).toHaveProperty("disabled",false));
}
it("real HeaderRefreshButton preserves conversion withdrawal on outage and recovers only fresh successful conversion",async()=>{
 external.readConversion.mockResolvedValueOnce(available).mockResolvedValueOnce({success:false,error:"Unauthorized"}).mockResolvedValueOnce(outage).mockResolvedValueOnce({success:true,data:{reportId:"fresh-header-report"}});
 const client=mount(); await screen.findByRole("link",{name:"Open the report"});
 await header(); await screen.findByText(unavailableText); expect(reportLink()).toBeNull(); claimEvidenceRemains();
 await header(); await screen.findByText(outageText); expect(reportLink()).toBeNull(); claimEvidenceRemains();
 await header(); await screen.findByRole("link",{name:"Open the report"}); expect(reportLink()?.getAttribute("href")).toBe("/travel-expenses/reports/fresh-header-report");
 expect(external.routerRefresh).toHaveBeenCalledTimes(3); expect(external.convert).not.toHaveBeenCalled(); expect(client.isFetching()).toBe(0);
});
it("real HeaderRefreshButton preserves detail withdrawal on outage and recovers only fresh successful detail",async()=>{
 statuses.push(200,404,503,200); external.readConversion.mockResolvedValue(available);
 mount(); await screen.findByText(detail.claim.notes);
 await header(); await screen.findByText("Claim not found or access is no longer available."); expect(screen.queryByText(detail.claim.notes)).toBeNull(); expect(reportLink()).toBeNull();
 await header(); await screen.findByText("Unable to load this claim. Please retry."); expect(screen.queryByText(detail.claim.notes)).toBeNull(); expect(reportLink()).toBeNull();
 await header(); await screen.findByText(detail.claim.notes); await screen.findByRole("link",{name:"Open the report"}); claimEvidenceRemains(); expect(external.routerRefresh).toHaveBeenCalledTimes(3);
});
it("real organization provider refusal retires private conversion view and scope Retry requires fresh conversion evidence",async()=>{
 external.readConversion.mockResolvedValue(available); mount(); await screen.findByRole("link",{name:"Open the report"});
 contextStatus=403; await header(); await screen.findByText("Refresh this claim to confirm your current access."); expect(reportLink()).toBeNull(); expect(screen.queryByText(detail.claim.notes)).toBeNull();
 contextStatus=200; external.readConversion.mockResolvedValue(outage); fireEvent.click(screen.getByRole("button",{name:"Retry"}));
 await screen.findByText(outageText); expect(reportLink()).toBeNull(); claimEvidenceRemains();
 external.readConversion.mockResolvedValue({success:true,data:{reportId:"fresh-scope-report"}}); fireEvent.click(screen.getByRole("button",{name:"Retry"}));
 await screen.findByRole("link",{name:"Open the report"}); expect(reportLink()?.getAttribute("href")).toBe("/travel-expenses/reports/fresh-scope-report"); expect(external.push).not.toHaveBeenCalled();
});
'''
p='apps/webapp/src/test/review1748-real-refresh.test.tsx'; assert not (ROOT/p).exists(); (ROOT/p).write_text(src)
e=json.loads((SAFE/'bridges.json').read_text()); b=(ROOT/p).read_bytes(); e.append(dict(path=p,bytes=len(b),sha256=digest(b))); save('bridges.json',e)
