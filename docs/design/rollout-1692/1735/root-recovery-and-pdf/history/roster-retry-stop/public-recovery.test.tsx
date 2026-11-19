// @vitest-environment jsdom
// Fresh independent public seam. Context HTTP, identity and server-action transports
// are synthetic. Provider, settings store, query client, filters, roster and report
// workspace are the actual candidate implementations.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { ReportsContainer } from "@/components/reports/reports-container";

const boundary = vi.hoisted(() => ({
  fetch: vi.fn(), read: vi.fn(), generate: vi.fn(),
  session: { data: { user: { id: "actor-independent" }, session: { activeOrganizationId: "org-independent" } }, isPending: false },
}));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => boundary.session,
  authClient: { $store: { atoms: { session: { subscribe: () => () => {} } } } },
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock("@/app/[locale]/(app)/reports/actions", () => ({ getAccessibleEmployeesAction: boundary.read, generateReport: boundary.generate }));
vi.mock("@/components/providers/app-locale-provider", () => ({ useAppLocale: () => "en" }));
vi.mock("@/hooks/use-display-context", () => ({ useDisplayContext: () => ({ locale: "en-US", timezone: "Europe/Berlin", timeFormat: "24h" }) }));
vi.mock("@/lib/reports/exporters/pdf-exporter", () => ({ exportToPDF: vi.fn(), generatePDFFilename: () => "independent.pdf" }));
vi.mock("@/components/closed-months/month-closure-strip", () => ({ MonthClosureStrip: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function contextResponse() {
  return new Response(JSON.stringify({
    user: boundary.session.data.user,
    session: boundary.session.data.session,
    employee: { employeeId: "employee-independent", organizationId: "org-independent", role: "admin" },
    organizationSettings: {
      organizationId: "org-independent", timezone: "Europe/Berlin", shiftsEnabled: false, projectsEnabled: false,
      surchargesEnabled: false, demoDataEnabled: false, worksCouncilEnabled: false, billableTimeEnabled: false,
      personnelFilesEnabled: false, equipmentEnabled: false, deletedAt: null,
    },
  }));
}
function employee(id: string, name: string) {
  return { id, name, firstName: name, lastName: null, email: `${id}@example.test`, role: "employee", image: null, pronouns: null, position: null };
}
const healthyRoster = () => ({ success: true, data: [employee("employee-independent", "Synthetic Admin"), employee("colleague-independent", "Synthetic Colleague")] });
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  boundary.fetch.mockImplementation(async () => contextResponse());
  boundary.read.mockImplementation(async () => healthyRoster());
  vi.stubGlobal("fetch", boundary.fetch);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
function mount() {
  const tree = <QueryClientProvider client={client}><OrganizationContextProvider initialContext={null}><ReportsContainer currentEmployeeId="employee-independent" userId="actor-independent" organizationId="org-independent" /></OrganizationContextProvider></QueryClientProvider>;
  return { ...render(tree), tree };
}

it("independent healthy-control: actual settings Retry recovers its failed transport", async () => {
  boundary.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Synthetic independent context failure" }), { status: 503 }));
  mount();
  await screen.findByText("Synthetic independent context failure");
  expect(screen.getByRole("button", { name: "Generate Report" })).toHaveProperty("disabled", true);
  const retry = screen.getByRole("button", { name: "Retry" });
  await act(async () => fireEvent.click(retry));
  await waitFor(() => expect(screen.getByRole("button", { name: "Generate Report" })).toHaveProperty("disabled", false));
  expect(boundary.fetch).toHaveBeenCalledTimes(2);
  expect(boundary.generate).not.toHaveBeenCalled();
});

it.each(["refusal", "rejection"])("independent roster %s exposes a local public Retry and recovers without a page reset", async (outcome) => {
  if (outcome === "refusal") boundary.read.mockResolvedValue({ success: false, error: "Synthetic independent roster refusal" });
  else boundary.read.mockRejectedValue(new Error("Synthetic independent roster rejection"));
  const mounted = mount();
  await screen.findByText("Unable to load team members");
  await waitFor(() => expect(screen.getByRole("button", { name: "Generate Report" })).toHaveProperty("disabled", false));
  const before = {
    outcome, contextCalls: boundary.fetch.mock.calls.length, rosterCalls: boundary.read.mock.calls.length,
    buttons: screen.queryAllByRole("button").map(button => button.textContent),
    contextStates: client.getQueryCache().findAll({ queryKey: ["organization-context"] }).map(query => query.state.status),
    rosterStates: client.getQueryCache().findAll({ queryKey: ["reports", "employees"] }).map(query => query.state.status),
    errorVisible: screen.queryByText("Unable to load team members") !== null,
    colleagueVisible: screen.queryByText("Synthetic Colleague") !== null,
  };
  boundary.read.mockImplementation(async () => healthyRoster());
  mounted.rerender(mounted.tree);
  await act(async () => {});
  const retry = screen.queryByRole("button", { name: "Retry" });
  writeFileSync(`../../.tmp/1735-independent-checks/roster-${outcome}-observation-01.json`, JSON.stringify({
    ...before, transportNowHealthy: true, callsAfterSameArrivalRerender: boundary.read.mock.calls.length,
    retryAvailable: retry !== null, stillFailedAfterRerender: screen.queryByText("Unable to load team members") !== null,
  }, null, 2));
  expect(retry, "The failed roster read must have a local public retry; a healthy settings read is not its recovery.").not.toBeNull();
  await act(async () => fireEvent.click(retry!));
  await screen.findByText("Synthetic Admin");
  expect(boundary.read).toHaveBeenCalledTimes(2);
});
