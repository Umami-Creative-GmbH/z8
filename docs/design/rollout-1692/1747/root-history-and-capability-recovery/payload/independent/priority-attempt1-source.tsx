/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Activity, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HeaderRefreshButton } from "@/components/header-refresh-button";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { ViewRefreshProvider } from "@/components/providers/view-refresh-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { LegacyClaimHistoryRow, ReportHistoryRow } from "@/lib/travel-expenses/expense-history";
import { TravelExpenseManagement } from "@/components/travel-expenses/travel-expense-management";

const edge = vi.hoisted(() => ({
  history: vi.fn(), convert: vi.fn(), receipt: vi.fn(), mileage: vi.fn(), trip: vi.fn(),
  push: vi.fn(), refresh: vi.fn(), replace: vi.fn(),
  session: { isPending: false, data: { user: { id: "probe-user" }, session: { activeOrganizationId: "probe-org" } } },
  listeners: new Set<(value: unknown) => void>(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/history-actions", () => ({ getMyTravelExpenseHistory: edge.history }));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-actions", () => ({
  createStandaloneReceiptReportAction: edge.receipt, createTripReportAction: edge.trip, deleteDraftTravelExpenseReportAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/mileage-actions", () => ({ createStandaloneMileageReportAction: edge.mileage }));
vi.mock("@/app/[locale]/(app)/travel-expenses/legacy-draft-actions", () => ({
  getLegacyTravelExpenseConversion: vi.fn(), convertLegacyTravelExpenseDraftAction: edge.convert,
}));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => edge.session,
  authClient: { $store: { atoms: { session: {
    get: () => edge.session,
    subscribe: (cb: (value: unknown) => void) => { edge.listeners.add(cb); return () => edge.listeners.delete(cb); },
  } } }, getSession: vi.fn() },
}));
vi.mock("@/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: edge.push, refresh: edge.refresh, replace: edge.replace }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: edge.refresh }) }));
vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string, p?: Record<string, unknown>) =>
  fallback.replace(/\{(\w+)\}/g, (s, k) => p?.[k] === undefined ? s : String(p[k])) }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en-US", useTranslations: () => (k: string) => k }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const report: ReportHistoryRow = {
  source: "report", id: "probe-report", href: "/travel-expenses/reports/probe-report", stage: "needs_action",
  activityAt: "2026-10-05T10:00:00Z", balance: null, reimbursement: null,
  dates: { start: "2026-09-14", end: "2026-09-14" }, kind: "standalone", status: "draft", itemType: "receipt",
  title: "Independent receipt", itemCount: 1, receiptCount: 1,
  totals: { currency: "EUR", reimbursable: "129.90", companyPaid: "32.40", excludedItemCount: 1 },
  adjustmentOf: { reportId: "probe-original", title: "Original report", kind: "standalone" },
  continuedFromClaimId: "probe-origin-claim", deletable: true,
};
const legacy: LegacyClaimHistoryRow = {
  source: "legacy_claim", id: "probe-legacy", href: "/travel-expenses/probe-legacy", stage: "needs_action",
  activityAt: "2026-10-04T10:00:00Z", balance: null, reimbursement: null, dates: { start: null, end: null },
  claimType: "receipt", status: "draft", amount: { amount: "237.60", currency: "EUR" }, destination: "Independent legacy", canContinue: true,
};
const ok = () => ({ success: true, data: [report, legacy] });
const refusal = { success: false, error: "Unauthorized" };
const outage = { success: false, error: "Failed to load your travel expenses" };
const clients: QueryClient[] = [];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  let mode: "visible" | "hidden" = "visible";
  let provider = 0;
  let employee = "probe-employee";
  let updatedAt = 1;
  const tree = () => <QueryClientProvider client={client}>
    <OrganizationContextProvider key={provider} initialContext={{ userId: "probe-user", organizationId: "probe-org",
      employee: { employeeId: employee, organizationId: "probe-org", role: "employee" }, organizationSettings: null, updatedAt }}>
      <ViewRefreshProvider><TooltipProvider><HeaderRefreshButton /></TooltipProvider>
        <Activity mode={mode}><TravelExpenseManagement userId="probe-user" organizationId="probe-org" employeeId="probe-employee" /></Activity>
      </ViewRefreshProvider>
    </OrganizationContextProvider>
  </QueryClientProvider>;
  const view = render(tree());
  return { client, view, rerender: () => view.rerender(tree()),
    activity: (m: typeof mode) => { mode = m; view.rerender(tree()); },
    provider: () => { provider++; view.rerender(tree()); },
    employee: (id: string) => { employee = id; updatedAt = Date.now() + 1000; view.rerender(tree()); },
  };
}
beforeEach(() => {
  vi.resetAllMocks(); edge.listeners.clear();
  edge.session.isPending = false; edge.session.data.user.id = "probe-user"; edge.session.data.session.activeOrganizationId = "probe-org";
  edge.history.mockResolvedValue(ok());
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    expect(String(url)).toBe("/api/auth/context");
    return new Response(JSON.stringify({ ...edge.session.data,
      employee: { employeeId: "probe-employee", organizationId: edge.session.data.session.activeOrganizationId, role: "employee" },
      organizationSettings: null }), { status: 200 });
  }));
});
afterEach(() => { cleanup(); for (const client of clients.splice(0)) client.clear(); vi.unstubAllGlobals(); expect(edge.listeners.size).toBe(0); });
async function settled(client: QueryClient, count: number) {
  await vi.waitFor(() => { expect(edge.history).toHaveBeenCalledTimes(count); expect(client.isFetching()).toBe(0); });
}
async function refresh(client: QueryClient, count: number) {
  const button = screen.getByRole("button", { name: "Refresh data" });
  await vi.waitFor(() => expect(button).toHaveProperty("disabled", false));
  fireEvent.click(button); await settled(client, count);
  await vi.waitFor(() => expect(button).toHaveProperty("disabled", false));
}
async function retry(client: QueryClient, count: number) {
  fireEvent.click(screen.getByRole("button", { name: "Retry" })); await settled(client, count);
}
function available() {
  expect(screen.getByRole("link", { name: "Independent receipt" }).getAttribute("href")).toBe(report.href);
  expect(screen.getByRole("link", { name: /Independent legacy/ }).getAttribute("href")).toBe(legacy.href);
  expect(screen.getByRole("link", { name: /Adjustment of/ }).getAttribute("href")).toBe("/travel-expenses/reports/probe-original");
  expect(screen.getByRole("link", { name: "Continued from an earlier claim" }).getAttribute("href")).toBe("/travel-expenses/probe-origin-claim");
  expect(screen.getByText(/€129.90/)).toBeTruthy(); expect(screen.getByText(/€237.60/)).toBeTruthy();
  expect(screen.getByText(/Company-paid €32.40/)).toBeTruthy();
  expect(screen.getByRole("radio", { name: "All 2" })).toBeTruthy();
  expect(screen.getByRole("radio", { name: "To finish 2" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Delete draft/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Continue as report" })).toBeTruthy();
}
function withdrawn() {
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.queryAllByRole("link")).toHaveLength(0);
  for (const value of [/€129.90/, /€237.60/, /Company-paid/, /Original report/, /Independent legacy/]) expect(screen.queryByText(value)).toBeNull();
  expect(screen.queryByRole("group", { name: "Show expenses" })).toBeNull();
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
  expect(screen.queryByRole("button", { name: /Delete draft/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Continue as report" })).toBeNull();
  expect(screen.queryByText("No travel expenses yet")).toBeNull();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
}
it("independent durable withdrawal removes report and legacy provenance, amounts, counts and controls through both outages, then recovers fresh rows", async () => {
  const { client } = mount(); await screen.findByText("Independent receipt"); await settled(client, 1); available();
  edge.history.mockResolvedValueOnce(refusal); await refresh(client, 2); withdrawn();
  edge.history.mockResolvedValueOnce(outage); await retry(client, 3); withdrawn();
  edge.history.mockRejectedValueOnce(new Error("Independent transport outage")); await refresh(client, 4); withdrawn();
  edge.history.mockResolvedValueOnce({ success: true, data: [{ ...report, id: "fresh", href: "/travel-expenses/reports/fresh", title: "Fresh receipt", adjustmentOf: null, continuedFromClaimId: null }] });
  await retry(client, 5); expect(screen.getByRole("link", { name: "Fresh receipt" })).toBeTruthy();
  expect(screen.queryByText("Independent receipt")).toBeNull(); expect(screen.queryByRole("alert")).toBeNull();
});
it.each(["structured", "transport"])("independent ordinary %s outage retains available row evidence and controls", async kind => {
  const { client } = mount(); await screen.findByText("Independent receipt"); await settled(client, 1);
  if (kind === "structured") edge.history.mockResolvedValueOnce(outage); else edge.history.mockRejectedValueOnce(new Error("Offline"));
  await refresh(client, 2); available(); expect(screen.getByRole("alert")).toBeTruthy();
  await retry(client, 3); available(); expect(screen.queryByRole("alert")).toBeNull();
});
it("independent initial refusal stays unknown through outages and fresh empty success alone restores healthy empty counts", async () => {
  edge.history.mockResolvedValueOnce(refusal); const { client } = mount(); await screen.findByRole("alert"); await settled(client, 1); withdrawn();
  edge.history.mockResolvedValueOnce(outage); await retry(client, 2); withdrawn();
  edge.history.mockRejectedValueOnce(new Error("Offline")); await refresh(client, 3); withdrawn();
  edge.history.mockResolvedValueOnce({ success: true, data: [] }); await retry(client, 4);
  expect(screen.getByText("No travel expenses yet")).toBeTruthy(); expect(screen.getByRole("radio", { name: "All 0" })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull(); expect(screen.queryAllByRole("link")).toHaveLength(0);
});
it("independent no-match filter cannot conceal refusal; recovery preserves the selected filter", async () => {
  const { client } = mount(); await screen.findByText("Independent receipt"); await settled(client, 1);
  fireEvent.click(screen.getByRole("radio", { name: "Approved 0" })); expect(screen.getByText("No expenses with this status.")).toBeTruthy();
  edge.history.mockResolvedValueOnce(refusal); await refresh(client, 2); withdrawn();
  edge.history.mockResolvedValueOnce(outage); await retry(client, 3); withdrawn();
  await retry(client, 4); expect(screen.getByRole("radio", { name: "Approved 0" }).getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Show all expenses" })); available();
});
it("independent held row continuation is retired by history refusal, even after same-scope fresh recovery", async () => {
  let complete!: (v: unknown) => void; edge.convert.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const { client } = mount(); await screen.findByText("Independent receipt"); await settled(client, 1);
  const button = screen.getByRole("button", { name: "Continue as report" }); await vi.waitFor(() => expect(button).toHaveProperty("disabled", false));
  fireEvent.click(button); await vi.waitFor(() => expect(edge.convert).toHaveBeenCalledTimes(1));
  edge.history.mockResolvedValueOnce(refusal); await refresh(client, 2); withdrawn();
  await retry(client, 3); available();
  await act(async () => complete({ success: true, data: { kind: "converted", reportId: "retired-held" } }));
  await settled(client, 4); expect(edge.push).not.toHaveBeenCalled();
});
it("independent positive continuation control navigates once while its arrival remains active", async () => {
  edge.convert.mockResolvedValueOnce({ success: true, data: { kind: "converted", reportId: "positive" } });
  const { client } = mount(); await screen.findByText("Independent receipt"); await settled(client, 1);
  const button = screen.getByRole("button", { name: "Continue as report" }); await vi.waitFor(() => expect(button).toHaveProperty("disabled", false));
  fireEvent.click(button); await vi.waitFor(() => expect(edge.push).toHaveBeenCalledWith("/travel-expenses/reports/positive"));
  expect(edge.convert).toHaveBeenCalledTimes(1); expect(edge.push).toHaveBeenCalledTimes(1);
});
it.each(["pending", "account", "organization", "employee", "provider", "Activity"])("independent held read cannot restore old rows after %s arrival retirement", async boundary => {
  let complete!: (v: unknown) => void;
  const m = mount(); await screen.findByText("Independent receipt"); await settled(m.client, 1);
  edge.history.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh data" })); await vi.waitFor(() => expect(edge.history).toHaveBeenCalledTimes(2));
  if (boundary === "pending") edge.session.isPending = true;
  if (boundary === "account") edge.session.data.user.id = "other-user";
  if (boundary === "organization") edge.session.data.session.activeOrganizationId = "other-org";
  if (["pending", "account", "organization"].includes(boundary)) { for (const listener of edge.listeners) listener(edge.session); m.rerender(); }
  if (boundary === "employee") m.employee("other-employee");
  if (boundary === "provider") m.provider();
  if (boundary === "Activity") m.activity("hidden");
  await act(async () => complete({ success: true, data: [{ ...report, title: "Retired private read" }] }));
  edge.session.isPending = false; edge.session.data.user.id = "probe-user"; edge.session.data.session.activeOrganizationId = "probe-org";
  edge.history.mockResolvedValue({ success: true, data: [] });
  if (boundary === "employee") m.employee("probe-employee");
  else if (boundary === "provider") m.provider();
  else if (boundary === "Activity") m.activity("visible");
  else m.rerender();
  await screen.findByText("No travel expenses yet");
  expect(screen.queryByText("Retired private read")).toBeNull(); expect(screen.queryByText("Independent receipt")).toBeNull();
});
