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

it("01 initial context failure plus independent read failure stays unknown; local Retry and header recover their actual owners", async () => {
  seam.fetch.mockResolvedValueOnce(new Response(JSON.stringify({message: "Display unavailable"}), {status: 503}));
  seam.read.mockResolvedValueOnce({status: "unavailable"});
  render(page({bootstrap: false}));
  await screen.findByRole("alert");
  await waitFor(() => expect(screen.getByLabelText("Display context").textContent).toContain("Display unavailable"));
  expect(screen.queryByRole("table")).toBeNull(); expect(screen.queryByText(/No one you can see/)).toBeNull();
  const pending = deferred<ReturnType<typeof result>>(); seam.read.mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole("button", {name: "Retry"})); fireEvent.click(screen.getByRole("button", {name: "Retry"}));
  expect(seam.read).toHaveBeenCalledTimes(2); expect((screen.getByRole("button", {name: "Retry"}) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => pending.resolve(result())); await screen.findByText("Canonical 0");
  seam.read.mockResolvedValueOnce(result()); fireEvent.click(screen.getByRole("button", {name: "Refresh data"}));
  await waitFor(() => expect(seam.fetch).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByLabelText("Display context").textContent).toContain('"error":null'));
  await waitFor(() => expect(seam.read).toHaveBeenCalledTimes(3)); expect(seam.refresh).toHaveBeenCalledTimes(1);
});
it("02 canonical five outcomes, clipped calendar ranges, same-scope DOM retention, pending/coalesced header and local refresh", async () => {
  seam.read.mockResolvedValueOnce(result()); const view = render(page()); await screen.findByText("Canonical 0");
  const row = screen.getByRole("link", {name: "Open the calendar of Canonical 0"}); expect(row.getAttribute("href")).toBe("/calendar/employee-0?date=2026-03-04");
  const counts = screen.getByRole("list", {name: "Statuses"}); expect(counts.children).toHaveLength(5); for (const item of counts.children) expect(item.textContent).toMatch(/1$/);
  const next = deferred<ReturnType<typeof result>>(); seam.read.mockReturnValueOnce(next.promise);
  fireEvent.click(screen.getByRole("button", {name: "Refresh data"})); fireEvent.click(screen.getByRole("button", {name: "Refresh data"}));
  await waitFor(() => expect(seam.read).toHaveBeenCalledTimes(2)); fireEvent.click(screen.getByRole("button", {name: "Refresh submissions"}));
  view.rerender(page()); expect(screen.getByRole("link", {name: "Open the calendar of Canonical 0"})).toBe(row);
  await act(async () => next.reject(new Error("private transport"))); await screen.findByRole("alert");
  expect(screen.getByText("Canonical 0")).toBeTruthy(); expect(screen.queryByText("private transport")).toBeNull(); expect(seam.read).toHaveBeenCalledTimes(2);
});
it("03 cadence-disabled all and managed guidance and healthy no-employee state remain distinct", async () => {
  seam.read.mockResolvedValueOnce({status: "ok", scope: "all", overview: {kind: "off"}});
  const view = render(page()); await screen.findByText("Your organization does not collect period submissions."); expect(screen.getByRole("link", {name: /Choose a submission cadence/})).toBeTruthy();
  seam.read.mockResolvedValueOnce({status: "ok", scope: "managed", overview: {kind: "off"}}); view.rerender(page({scope: "managed"}));
  await screen.findByText("Your organization does not collect period submissions."); expect(screen.queryByRole("link", {name: /Choose a submission cadence/})).toBeNull();
  const empty = result(); empty.overview.rows = []; seam.read.mockResolvedValueOnce(empty); fireEvent.click(screen.getByRole("button", {name: "Refresh submissions"}));
  await screen.findByText("No one you can see is expected to submit this period."); expect(screen.queryByRole("alert")).toBeNull(); expect(screen.queryByRole("list", {name: "Statuses"})).toBeNull();
});
it("04 URL period selection invalidates queued old period responses", async () => {
  seam.read.mockResolvedValueOnce(result()); const view = render(page()); await screen.findByText("Canonical 0");
  fireEvent.mouseDown(screen.getByRole("combobox", {name: "Submission period"}));
  // Native keyboard opens the real Select; routing transport is the only replacement.
  fireEvent.keyDown(screen.getByRole("combobox", {name: "Submission period"}), {key: "ArrowDown"});
  const options = await screen.findAllByRole("option"); fireEvent.click(options[1]);
  expect(seam.push).toHaveBeenCalledWith("/team/period-submissions?period=2026-03-09");
  const old = deferred<ReturnType<typeof result>>(); seam.read.mockReturnValueOnce(old.promise); fireEvent.click(screen.getByRole("button", {name: "Refresh submissions"}));
  const fresh = deferred<ReturnType<typeof result>>(); seam.read.mockReturnValueOnce(fresh.promise); view.rerender(page({requestedPeriod: nextPeriod.startDate}));
  expect(screen.queryByText("Canonical 0")).toBeNull(); await act(async () => old.resolve(result("OLD PERIOD"))); expect(screen.queryByText("OLD PERIOD 0")).toBeNull();
  await act(async () => fresh.resolve(result("NEW PERIOD"))); await screen.findByText("NEW PERIOD 0"); expect(seam.read).toHaveBeenLastCalledWith("2026-03-09", {userId: "reader", organizationId: "org-a"});
});
it("05 retained pending session and account/org ABA suppress old success/refusal/rejection; Activity reactivation reads fresh", async () => {
  seam.read.mockResolvedValueOnce(result()); const view = render(page()); await screen.findByText("Canonical 0");
  const old = deferred<ReturnType<typeof result>>(); seam.read.mockReturnValueOnce(old.promise); fireEvent.click(screen.getByRole("button", {name: "Refresh submissions"}));
  seam.session.isPending = true; view.rerender(page()); expect(screen.queryByText("Canonical 0")).toBeNull();
  await act(async () => old.resolve(result("OLD PENDING"))); expect(screen.queryByText("OLD PENDING 0")).toBeNull();
  seam.session.isPending = false; seam.read.mockResolvedValueOnce(result("FRESH")); view.rerender(page()); await screen.findByText("FRESH 0");
  const hidden = deferred<ReturnType<typeof result>>(); seam.read.mockReturnValueOnce(hidden.promise); fireEvent.click(screen.getByRole("button", {name: "Refresh submissions"}));
  const button = screen.getByRole("button", {name: "Refresh submissions"}); view.rerender(page({mode: "hidden"})); fireEvent.click(button); await act(async () => hidden.reject(new Error("late hidden")));
  seam.read.mockResolvedValueOnce(result("RETURNED")); view.rerender(page()); await screen.findByText("RETURNED 0"); expect(screen.queryByRole("alert")).toBeNull();
  for (const kind of ["account", "organization"] as const) {
    const late = deferred<unknown>(); seam.read.mockReturnValueOnce(late.promise); fireEvent.click(screen.getByRole("button", {name: "Refresh submissions"}));
    if (kind === "account") seam.session.data.user.id = "other"; else seam.session.data.session.activeOrganizationId = "org-b";
    view.rerender(page()); expect(screen.queryByText("RETURNED 0")).toBeNull();
    if (kind === "account") seam.session.data.user.id = "reader"; else seam.session.data.session.activeOrganizationId = "org-a";
    seam.read.mockResolvedValueOnce(result("RETURNED")); view.rerender(page()); await screen.findByText("RETURNED 0");
    await act(async () => late.resolve({status: "forbidden"})); expect(screen.getByText("RETURNED 0")).toBeTruthy();
  }
});
it("06 narrower server access envelope drops wider records and authoritative refusal clears all destinations", async () => {
  seam.read.mockResolvedValueOnce(result("WIDE")); const view = render(page()); await screen.findByText("WIDE 0");
  const pending = deferred<unknown>(); seam.read.mockReturnValueOnce(pending.promise); view.rerender(page({scope: "managed"})); expect(screen.queryByText("WIDE 0")).toBeNull();
  await act(async () => pending.resolve(result("MANAGED", "managed"))); await screen.findByText("MANAGED 0");
  seam.read.mockResolvedValueOnce({status: "forbidden"}); fireEvent.click(screen.getByRole("button", {name: "Refresh submissions"}));
  await screen.findByText(/Period submissions are unavailable/); expect(screen.queryByText("MANAGED 0")).toBeNull(); expect(screen.queryByRole("link", {name: "Open the approval inbox"})).toBeNull();
  seam.read.mockResolvedValueOnce(result("RECOVERED", "managed")); fireEvent.click(screen.getByRole("button", {name: "Retry"})); await screen.findByText("RECOVERED 0");
});
it("07 canonical display employee/role arrival invalidates a queued wider read before new server authorization", async () => {
  seam.read.mockResolvedValueOnce(result("WIDE")); render(page()); await screen.findByText("WIDE 0");
  const old = deferred<unknown>(); seam.read.mockReturnValueOnce(old.promise); fireEvent.click(screen.getByRole("button", {name: "Refresh submissions"}));
  seam.fetch.mockResolvedValueOnce(contextResponse("replacement-reader", "employee"));
  await act(async () => { await client.invalidateQueries(); });
  await waitFor(() => expect(screen.getByLabelText("Display context").textContent).toContain('"employeeId":"replacement-reader"'));
  expect(screen.getByLabelText("Display context").textContent).toContain('"role":"employee"');
  expect(screen.queryByText("WIDE 0")).toBeNull();
  await act(async () => old.resolve(result("LATE WIDE")));
  expect(screen.queryByText("LATE WIDE 0")).toBeNull();
});
