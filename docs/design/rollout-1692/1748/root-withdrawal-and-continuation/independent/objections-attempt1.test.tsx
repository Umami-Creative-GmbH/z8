/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const external = vi.hoisted(() => ({ readConversion: vi.fn(), convert: vi.fn(), push: vi.fn(), refresh: vi.fn(), pending: false }));
vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ isPending: external.pending, data: { user: { id: "synthetic-reader" }, session: { activeOrganizationId: "synthetic-org" } } }),
  authClient: { $store: { atoms: { session: {
    get: () => ({ isPending: external.pending, data: { user: { id: "synthetic-reader" }, session: { activeOrganizationId: "synthetic-org" } } }),
    subscribe: () => () => {},
  } } } },
}));
vi.mock("@/navigation", () => ({
  useRouter: () => ({ push: external.push, refresh: external.refresh, replace: vi.fn() }),
  Link: ({ children, ...props }: { children: ReactNode; href: string }) => <a {...props}>{children}</a>,
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/legacy-draft-actions", () => ({
  getLegacyTravelExpenseConversion: external.readConversion,
  convertLegacyTravelExpenseDraftAction: external.convert,
}));

import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { TravelExpenseClaimDetail } from "@/components/travel-expenses/travel-expense-claim-detail";
import { TravelExpenseClaimDetail as BaselineDetail } from "@/components/travel-expenses/review1748-independent-baseline-detail";

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
  vi.resetAllMocks(); external.pending = false;
});

function mount(options: { statuses?: (number | Error)[]; mode?: "visible" | "hidden" } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/auth/context") return Response.json({
      user: { id: "synthetic-reader" }, session: { activeOrganizationId: "synthetic-org" }, employee, organizationSettings: null,
    });
    expect(url).toBe(`/api/travel-expenses/${claimId}`);
    const status = options.statuses?.shift() ?? 200;
    if (status instanceof Error) throw status;
    return Response.json(status === 200 ? detail : {}, {status});
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const Component = TravelExpenseClaimDetail;
  const tree = (mode: "visible" | "hidden" = "visible") => (<QueryClientProvider client={client}>
    <OrganizationContextProvider initialContext={{ userId: "synthetic-reader", organizationId: "synthetic-org", employee, organizationSettings: null, updatedAt: Date.now() }}>
      <Activity mode={mode}><Component userId="synthetic-reader" organizationId="synthetic-org" employeeId={employee.employeeId} claimId={claimId} /></Activity>
    </OrganizationContextProvider>
  </QueryClientProvider>);
  const view = render(tree());
  return {client, view, tree};
}
async function refresh(client: QueryClient) {
  await act(() => client.invalidateQueries({ queryKey: ["travel-expenses"] }));
}
function claimEvidenceRemains() {
  expect(screen.getByText(detail.claim.notes)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Download synthetic-receipt.pdf" })).toBeTruthy();
}


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
