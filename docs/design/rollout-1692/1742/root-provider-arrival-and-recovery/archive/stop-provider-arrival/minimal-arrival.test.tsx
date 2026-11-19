// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity, type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HeaderRefreshButton } from "@/components/header-refresh-button";
import { OrganizationContextProvider, useOrganization } from "@/components/providers/organization-context-provider";
import { ViewRefreshProvider } from "@/components/providers/view-refresh-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PeriodSubmissionsClient } from "./period-submissions-client";

// Only external transports, routing and translation are substituted. All state owners,
// query machinery, public hooks, controls, overview/table and read controller are real.
const seam = vi.hoisted(() => ({ read: vi.fn(), fetch: vi.fn(), push: vi.fn(), refresh: vi.fn(), replace: vi.fn(),
  session: { data: { user: { id: "reader" }, session: { activeOrganizationId: "org-a" } }, isPending: false },
}));
vi.mock("./actions", () => ({ readPeriodSubmissionOverview: seam.read }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => seam.session }));
vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: (_key: string, fallback: string, params?: Record<string, string | number>) => Object.entries(params ?? {}).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), fallback) }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: seam.refresh }) }));
vi.mock("@/navigation", () => ({ useRouter: () => ({ push: seam.push, replace: seam.replace }), Link: ({href, children, ...props}: ComponentProps<"a"> & {href: string}) => <a href={href} {...props}>{children}</a> }));
const access = { userId: "reader", organizationId: "org-a", scope: "all" as const };
const period = { startDate: "2026-03-02", endDate: "2026-03-08", cadence: "weekly" as const };
const nextPeriod = { startDate: "2026-03-09", endDate: "2026-03-15", cadence: "weekly" as const };
const statuses = ["awaiting_submission", "submitted", "approved", "rejected", "sent_back_after_change"] as const;
function result(name = "Canonical", scope: "all" | "managed" = "all") {
  return { status: "ok" as const, scope, overview: { kind: "ok" as const, timezone: "Pacific/Auckland", periods: [period, nextPeriod], selected: period, running: false,
    rows: statuses.map((status, i) => ({employeeId: `employee-${i}`, name: `${name} ${i}`, ...period, startDate: i === 0 ? "2026-03-04" : period.startDate, status, highlighted: i === 0, submittedAt: null, opensOn: "2026-03-08"})),
    counts: { awaiting_submission: 1, submitted: 1, approved: 1, rejected: 1, sent_back_after_change: 1 } } };
}
function context(employeeId = "employee-reader", role: "admin" | "manager" | "employee" = "admin") {
  return { userId: seam.session.data.user.id, organizationId: seam.session.data.session.activeOrganizationId,
    employee: { employeeId, organizationId: seam.session.data.session.activeOrganizationId, role }, organizationSettings: null, updatedAt: Date.now() };
}
function contextResponse(employeeId = "employee-reader", role: "admin" | "manager" | "employee" = "admin") {
  const c = context(employeeId, role);
  return new Response(JSON.stringify({ user: { id: c.userId }, session: { activeOrganizationId: c.organizationId }, employee: c.employee, organizationSettings: null }), {status: 200, headers: { "Content-Type": "application/json" }});
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((res, rej) => {resolve = res; reject = rej;}); return {promise, resolve, reject}; }
let client: QueryClient;
function ObserveContext() { const c = useOrganization(); return <output aria-label="Display context">{JSON.stringify({employeeId: c.employeeId, role: c.role, error: c.error, loading: c.isLoading})}</output>; }
function Mount({ children, bootstrap = true }: {children: ReactNode; bootstrap?: boolean}) {
 return <QueryClientProvider client={client}><OrganizationContextProvider initialContext={bootstrap ? context() : null}><ViewRefreshProvider><TooltipProvider><HeaderRefreshButton/><ObserveContext/>{children}</TooltipProvider></ViewRefreshProvider></OrganizationContextProvider></QueryClientProvider>;
}
function page(props: {requestedPeriod?: string | null; scope?: "all" | "managed"; mode?: "visible" | "hidden"; bootstrap?: boolean} = {}) {
 return <Mount bootstrap={props.bootstrap}><Activity mode={props.mode ?? "visible"}><PeriodSubmissionsClient access={{...access, scope: props.scope ?? "all"}} requestedPeriod={props.requestedPeriod ?? null}/></Activity></Mount>;
}
beforeEach(() => { client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}}); vi.stubGlobal("fetch", seam.fetch); seam.fetch.mockReset().mockImplementation(() => Promise.resolve(contextResponse())); seam.read.mockReset(); seam.push.mockReset(); seam.refresh.mockReset(); seam.replace.mockReset(); seam.session.isPending = false; seam.session.data.user.id = "reader"; seam.session.data.session.activeOrganizationId = "org-a"; });
afterEach(() => {cleanup(); client.clear(); vi.unstubAllGlobals();});


it("control: unchanged employee and role accepts its current queued read", async () => {
  seam.read.mockResolvedValueOnce(result("WIDE")); render(page()); await screen.findByText("WIDE 0");
  const old = deferred<unknown>(); seam.read.mockReturnValueOnce(old.promise);
  fireEvent.click(screen.getByRole("button", {name: "Refresh submissions"}));
  fireEvent.click(screen.getByRole("button", {name: "Refresh data"}));
  await waitFor(() => expect(seam.fetch).toHaveBeenCalledTimes(1));
  await act(async () => old.resolve(result("CURRENT")));
  await screen.findByText("CURRENT 0");
  expect(screen.getByLabelText("Display context").textContent).toContain('"role":"admin"');
});
it("control: changed canonical server scope replaces the workspace and refuses the old queued read", async () => {
  seam.read.mockResolvedValueOnce(result("WIDE")); const view = render(page()); await screen.findByText("WIDE 0");
  const old = deferred<unknown>(); seam.read.mockReturnValueOnce(old.promise);
  fireEvent.click(screen.getByRole("button", {name: "Refresh submissions"}));
  seam.fetch.mockResolvedValueOnce(contextResponse("replacement-reader", "employee"));
  fireEvent.click(screen.getByRole("button", {name: "Refresh data"}));
  await waitFor(() => expect(seam.fetch).toHaveBeenCalledTimes(1));
  seam.read.mockResolvedValueOnce({status: "forbidden"}); view.rerender(page({scope: "managed"}));
  await screen.findByText(/Period submissions are unavailable/);
  await act(async () => old.resolve(result("LATE WIDE")));
  expect(screen.queryByText("LATE WIDE 0")).toBeNull();
  expect(screen.queryByRole("link", {name: "Open the approval inbox"})).toBeNull();
});
it("blocker: changed employee and role from actual provider still accepts wider queued success", async () => {
  seam.read.mockResolvedValueOnce(result("WIDE")); render(page()); await screen.findByText("WIDE 0");
  const old = deferred<unknown>(); seam.read.mockReturnValueOnce(old.promise);
  fireEvent.click(screen.getByRole("button", {name: "Refresh submissions"}));
  seam.fetch.mockResolvedValueOnce(contextResponse("replacement-reader", "employee"));
  fireEvent.click(screen.getByRole("button", {name: "Refresh data"}));
  await waitFor(() => expect(seam.fetch).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByLabelText("Display context").textContent).toContain('"employeeId":"replacement-reader"'));
  const display = screen.getByLabelText("Display context").textContent;
  expect(display).toContain('"employeeId":"replacement-reader"');
  expect(display).toContain('"role":"employee"');
  await act(async () => old.resolve(result("LATE WIDE")));
  const late = screen.queryByText("LATE WIDE 0");
  const message = JSON.stringify({display: JSON.parse(display!), readCalls: seam.read.mock.calls.length, lateWiderRowPresent: Boolean(late), inboxPresent: Boolean(screen.queryByRole("link", {name: "Open the approval inbox"})), allScopeStillVisible: Boolean(screen.queryByText("All covered employees")), sessionUserUnchanged: seam.session.data.user.id === access.userId, sessionOrgUnchanged: seam.session.data.session.activeOrganizationId === access.organizationId});
  expect(late, message).toBeNull();
});
