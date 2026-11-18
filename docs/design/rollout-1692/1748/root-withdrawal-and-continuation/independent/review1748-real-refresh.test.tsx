/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const external = vi.hoisted(() => ({ readConversion: vi.fn(), convert: vi.fn(), push: vi.fn(), routerRefresh: vi.fn() }));
vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ isPending: false, data: { user: { id: "synthetic-reader" }, session: { activeOrganizationId: "synthetic-org" } } }),
  authClient: { $store: { atoms: { session: {
    get: () => ({ isPending: false, data: { user: { id: "synthetic-reader" }, session: { activeOrganizationId: "synthetic-org" } } }),
    subscribe: () => () => {},
  } } } },
}));
vi.mock("@/navigation", () => ({
  useRouter: () => ({ push: external.push, refresh: vi.fn(), replace: vi.fn() }),
  Link: ({ children, ...props }: { children: ReactNode; href: string }) => <a {...props}>{children}</a>,
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/legacy-draft-actions", () => ({
  getLegacyTravelExpenseConversion: external.readConversion,
  convertLegacyTravelExpenseDraftAction: external.convert,
}));

import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { TravelExpenseClaimDetail } from "@/components/travel-expenses/travel-expense-claim-detail";
import { HeaderRefreshButton } from "@/components/header-refresh-button";
import { ViewRefreshProvider } from "@/components/providers/view-refresh-provider";
import { SWRConfig } from "swr";

const claimId = "4053401f-806e-4839-ae66-96b9fa36c054";
const employee = { employeeId: "synthetic-employee", organizationId: "synthetic-org", role: "employee" as const };
const detail = {
  claim: {
    id: claimId, organizationId: "synthetic-org", employeeId: employee.employeeId,
    type: "receipt", status: "draft", tripStartDate: null, tripEndDate: null, tripDateTimeZone: null,
    originalAmount: "12.50", originalCurrency: "EUR", calculatedAmount: "12.50", calculatedCurrency: "EUR",
    destinationCity: null, destinationCountry: null, notes: "Synthetic original draft evidence",
    createdAt: "2026-04-01T10:00:00Z", submittedAt: null, decidedAt: null,
  },
  attachments: [{ id: "synthetic-receipt", fileName: "synthetic-receipt.pdf", checksumSha256: null }],
  decisions: [], intermediateDecisions: [],
};
const clients: QueryClient[] = [];
let contextStatus=200; const statuses:number[]=[];
const available = { success: true, data: { reportId: "synthetic-converted-report" } };
const outage = { success: false, error: "Synthetic temporary service outage" };
const unavailableText = "Draft continuation is not available for the current reader.";
const outageText = "Unable to check this draft. Please retry.";
const reportLink = () => screen.queryByRole("link", { name: "Open the report" });

afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.unstubAllGlobals();
  vi.resetAllMocks(); contextStatus=200; statuses.length=0;
});

function mount() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/auth/context") { if (contextStatus !== 200) return Response.json({}, {status:contextStatus}); return Response.json({
      user: { id: "synthetic-reader" }, session: { activeOrganizationId: "synthetic-org" }, employee, organizationSettings: null,
    }); }
    expect(url).toBe(`/api/travel-expenses/${claimId}`);
    const status=statuses.shift() ?? 200; return Response.json(status === 200 ? detail : {},{status});
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const Component = TravelExpenseClaimDetail;
  render(<QueryClientProvider client={client}><SWRConfig value={{provider:()=>new Map(),dedupingInterval:0}}><ViewRefreshProvider><HeaderRefreshButton/>
    <OrganizationContextProvider initialContext={{ userId: "synthetic-reader", organizationId: "synthetic-org", employee, organizationSettings: null, updatedAt: Date.now() }}>
      <Component userId="synthetic-reader" organizationId="synthetic-org" employeeId={employee.employeeId} claimId={claimId} />
    </OrganizationContextProvider>
  </ViewRefreshProvider></SWRConfig></QueryClientProvider>);
  return client;
}
async function refresh(client: QueryClient) {
  await act(() => client.invalidateQueries({ queryKey: ["travel-expenses"] }));
}
function claimEvidenceRemains() {
  expect(screen.getByText(detail.claim.notes)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Download synthetic-receipt.pdf" })).toBeTruthy();
}


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
