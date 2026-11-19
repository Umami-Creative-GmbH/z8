// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity, type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HeaderRefreshButton } from "@/components/header-refresh-button";
import {
	OrganizationContextProvider,
	useOrganization,
} from "@/components/providers/organization-context-provider";
import { ViewRefreshProvider } from "@/components/providers/view-refresh-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PeriodSubmissionsClient } from "./period-submissions-client";

// Only external transports, routing and translation are substituted. All state owners,
// query machinery, public hooks, controls, overview/table and read controller are real.
const seam = vi.hoisted(() => ({
	read: vi.fn(),
	fetch: vi.fn(),
	push: vi.fn(),
	refresh: vi.fn(),
	replace: vi.fn(),
	session: {
		data: { user: { id: "reader" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	},
}));
vi.mock("./actions", () => ({ readPeriodSubmissionOverview: seam.read }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => seam.session }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: seam.refresh }) }));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: seam.push, replace: seam.replace }),
	Link: ({ href, children, ...props }: ComponentProps<"a"> & { href: string }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));
const access = { userId: "reader", organizationId: "org-a", scope: "all" as const };
const period = { startDate: "2026-03-02", endDate: "2026-03-08", cadence: "weekly" as const };
const nextPeriod = { startDate: "2026-03-09", endDate: "2026-03-15", cadence: "weekly" as const };
const statuses = [
	"awaiting_submission",
	"submitted",
	"approved",
	"rejected",
	"sent_back_after_change",
] as const;
function result(name = "Canonical", scope: "all" | "managed" = "all") {
	return {
		status: "ok" as const,
		scope,
		overview: {
			kind: "ok" as const,
			timezone: "Pacific/Auckland",
			periods: [period, nextPeriod],
			selected: period,
			running: false,
			rows: statuses.map((status, i) => ({
				employeeId: `employee-${i}`,
				name: `${name} ${i}`,
				...period,
				startDate: i === 0 ? "2026-03-04" : period.startDate,
				status,
				highlighted: i === 0,
				submittedAt: null,
				opensOn: "2026-03-08",
			})),
			counts: {
				awaiting_submission: 1,
				submitted: 1,
				approved: 1,
				rejected: 1,
				sent_back_after_change: 1,
			},
		},
	};
}
function context(employeeId = "employee-reader", role: "admin" | "manager" | "employee" = "admin") {
	return {
		userId: seam.session.data.user.id,
		organizationId: seam.session.data.session.activeOrganizationId,
		employee: { employeeId, organizationId: seam.session.data.session.activeOrganizationId, role },
		organizationSettings: null,
		updatedAt: Date.now(),
	};
}
function contextResponse(
	employeeId = "employee-reader",
	role: "admin" | "manager" | "employee" = "admin",
) {
	const c = context(employeeId, role);
	return new Response(
		JSON.stringify({
			user: { id: c.userId },
			session: { activeOrganizationId: c.organizationId },
			employee: c.employee,
			organizationSettings: null,
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}
let client: QueryClient;
function ObserveContext() {
	const c = useOrganization();
	return (
		<output aria-label="Display context">
			{JSON.stringify({
				employeeId: c.employeeId,
				role: c.role,
				error: c.error,
				loading: c.isLoading,
			})}
		</output>
	);
}
function Mount({ children, bootstrap = true }: { children: ReactNode; bootstrap?: boolean }) {
	return (
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={bootstrap ? context() : null}>
				<ViewRefreshProvider>
					<TooltipProvider>
						<HeaderRefreshButton />
						<ObserveContext />
						{children}
					</TooltipProvider>
				</ViewRefreshProvider>
			</OrganizationContextProvider>
		</QueryClientProvider>
	);
}
function page(
	props: {
		requestedPeriod?: string | null;
		scope?: "all" | "managed";
		mode?: "visible" | "hidden";
		bootstrap?: boolean;
	} = {},
) {
	return (
		<Mount bootstrap={props.bootstrap}>
			<Activity mode={props.mode ?? "visible"}>
				<PeriodSubmissionsClient
					access={{ ...access, scope: props.scope ?? "all" }}
					requestedPeriod={props.requestedPeriod ?? null}
				/>
			</Activity>
		</Mount>
	);
}
beforeEach(() => {
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	vi.stubGlobal("fetch", seam.fetch);
	seam.fetch.mockReset().mockImplementation(() => Promise.resolve(contextResponse()));
	seam.read.mockReset();
	seam.push.mockReset();
	seam.refresh.mockReset();
	seam.replace.mockReset();
	seam.session.isPending = false;
	seam.session.data.user.id = "reader";
	seam.session.data.session.activeOrganizationId = "org-a";
});
afterEach(() => {
	cleanup();
	client.clear();
	vi.unstubAllGlobals();
});

it("independent: employee removal retires a read and null display role accepts canonical all", async () => {
  seam.read.mockResolvedValueOnce(result("BEFORE"));
  render(page());
  await screen.findByText("BEFORE 0");
  const old = deferred<unknown>();
  const fresh = deferred<unknown>();
  seam.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  fireEvent.click(screen.getByRole("button", { name: "Refresh submissions" }));
  seam.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: "reader" }, session: { activeOrganizationId: "org-a" }, employee: null, organizationSettings: null }), { status: 200 }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
  await waitFor(() => expect(seam.read).toHaveBeenCalledTimes(3));
  expect(screen.queryByText("BEFORE 0")).toBeNull();
  expect(screen.queryByRole("link", { name: "Open the approval inbox" })).toBeNull();
  await act(async () => old.resolve(result("RETIRED")));
  expect(screen.queryByText("RETIRED 0")).toBeNull();
  await act(async () => fresh.resolve(result("OWNER")));
  await screen.findByText("OWNER 0");
  expect(screen.getByText("All covered employees")).toBeTruthy();
});

it("independent: retained raw pending IDs retire both rows and outstanding rejection", async () => {
  seam.read.mockResolvedValueOnce(result("RETAINED"));
  const view = render(page());
  await screen.findByText("RETAINED 0");
  const old = deferred<unknown>();
  const fresh = deferred<unknown>();
  seam.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  fireEvent.click(screen.getByRole("button", { name: "Refresh submissions" }));
  seam.session.isPending = true;
  view.rerender(page());
  expect(screen.queryByText("RETAINED 0")).toBeNull();
  expect(screen.queryByRole("link", { name: "Open the approval inbox" })).toBeNull();
  await act(async () => old.reject(new Error("retired private failure")));
  expect(screen.queryByRole("alert")).toBeNull();
  seam.session.isPending = false;
  view.rerender(page());
  await waitFor(() => expect(seam.read).toHaveBeenCalledTimes(3));
  expect(screen.queryByText("RETAINED 0")).toBeNull();
  await act(async () => fresh.resolve(result("RECONCILED", "managed")));
  await screen.findByText("RECONCILED 0");
  expect(screen.getByText("Employees you manage")).toBeTruthy();
});

for (const changed of ["actor", "organization"] as const) {
  it("independent: " + changed + " ABA invalidates old success with actual provider", async () => {
    seam.read.mockResolvedValueOnce(result("ORIGINAL"));
    const view = render(page());
    await screen.findByText("ORIGINAL 0");
    const old = deferred<unknown>();
    const fresh = deferred<unknown>();
    seam.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    fireEvent.click(screen.getByRole("button", { name: "Refresh submissions" }));
    if (changed === "actor") seam.session.data.user.id = "other-reader";
    else seam.session.data.session.activeOrganizationId = "org-b";
    view.rerender(page());
    expect(screen.queryByText("ORIGINAL 0")).toBeNull();
    if (changed === "actor") seam.session.data.user.id = "reader";
    else seam.session.data.session.activeOrganizationId = "org-a";
    view.rerender(page());
    await waitFor(() => expect(seam.read).toHaveBeenCalledTimes(3));
    await act(async () => old.resolve(result("OBSOLETE ABA")));
    expect(screen.queryByText("OBSOLETE ABA 0")).toBeNull();
    await act(async () => fresh.resolve(result("CURRENT ABA")));
    await screen.findByText("CURRENT ABA 0");
  });
}

it("independent: provider employee and role ABA never reuses the earlier read", async () => {
  seam.read.mockResolvedValueOnce(result("IDENTITY A"));
  render(page());
  await screen.findByText("IDENTITY A 0");
  const old = deferred<unknown>();
  const middle = deferred<unknown>();
  const fresh = deferred<unknown>();
  seam.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(middle.promise).mockReturnValueOnce(fresh.promise);
  fireEvent.click(screen.getByRole("button", { name: "Refresh submissions" }));
  seam.fetch.mockResolvedValueOnce(contextResponse("employee-b", "manager"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
  await waitFor(() => expect(seam.read).toHaveBeenCalledTimes(3));
  await waitFor(() => expect((screen.getByRole("button", { name: "Refresh data" }) as HTMLButtonElement).disabled).toBe(false));
  seam.fetch.mockResolvedValueOnce(contextResponse());
  fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
  await waitFor(() => expect(seam.read).toHaveBeenCalledTimes(4));
  await act(async () => { old.resolve(result("OBSOLETE A")); middle.resolve({ status: "forbidden" }); });
  expect(screen.queryByText("OBSOLETE A 0")).toBeNull();
  expect(screen.queryByText(/Period submissions are unavailable/)).toBeNull();
  await act(async () => fresh.resolve(result("NEW A")));
  await screen.findByText("NEW A 0");
});

it("independent: hidden Activity rejects header refresh and old success then reads current provider", async () => {
  seam.read.mockResolvedValueOnce(result("VISIBLE"));
  const view = render(page());
  await screen.findByText("VISIBLE 0");
  const old = deferred<unknown>();
  seam.read.mockReturnValueOnce(old.promise);
  fireEvent.click(screen.getByRole("button", { name: "Refresh submissions" }));
  view.rerender(page({ mode: "hidden" }));
  seam.fetch.mockResolvedValueOnce(contextResponse("changed-hidden", "manager"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
  await waitFor(() => expect(seam.fetch).toHaveBeenCalledTimes(1));
  expect(seam.read).toHaveBeenCalledTimes(2);
  await act(async () => old.resolve(result("HIDDEN LATE")));
  const fresh = deferred<unknown>();
  seam.read.mockReturnValueOnce(fresh.promise);
  view.rerender(page());
  await waitFor(() => expect(seam.read).toHaveBeenCalledTimes(3));
  expect(screen.queryByText("HIDDEN LATE 0")).toBeNull();
  await act(async () => fresh.resolve(result("VISIBLE CURRENT", "managed")));
  await screen.findByText("VISIBLE CURRENT 0");
});

it("independent: period navigation retires a pending read, preserves canonical local deep link", async () => {
  seam.read.mockResolvedValueOnce(result("MARCH SECOND"));
  const view = render(page({ requestedPeriod: period.startDate }));
  await screen.findByText("MARCH SECOND 0");
  const old = deferred<unknown>();
  const fresh = deferred<unknown>();
  seam.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  fireEvent.click(screen.getByRole("button", { name: "Refresh submissions" }));
  view.rerender(page({ requestedPeriod: nextPeriod.startDate }));
  expect(screen.queryByText("MARCH SECOND 0")).toBeNull();
  expect(seam.read).toHaveBeenLastCalledWith(nextPeriod.startDate, { userId: "reader", organizationId: "org-a" });
  await act(async () => old.resolve(result("OLD PERIOD")));
  expect(screen.queryByText("OLD PERIOD 0")).toBeNull();
  const current = result("MARCH NINTH");
  current.overview.selected = nextPeriod;
  await act(async () => fresh.resolve(current));
  await screen.findByText("MARCH NINTH 0");
  expect(screen.getByRole("link", { name: "Open the calendar of MARCH NINTH 0" }).getAttribute("href")).toBe("/calendar/employee-0?date=2026-03-04");
});

for (const scope of ["all", "managed"] as const) {
  it("independent: " + scope + " distinguishes initial failure, healthy empty, off and serialized retry", async () => {
    seam.read.mockResolvedValueOnce({ status: "unavailable" });
    render(page({ scope }));
    await screen.findByRole("alert");
    expect(screen.queryByText("No one you can see is expected to submit this period.")).toBeNull();
    expect(screen.queryByRole("list", { name: "Statuses" })).toBeNull();
    const empty = result("EMPTY", scope);
    empty.overview.rows = [];
    const fresh = deferred<unknown>();
    seam.read.mockReturnValueOnce(fresh.promise);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(seam.read).toHaveBeenCalledTimes(2);
    await act(async () => fresh.resolve(empty));
    await screen.findByText("No one you can see is expected to submit this period.");
    expect(screen.queryByRole("alert")).toBeNull();
    seam.read.mockResolvedValueOnce({ status: "ok", scope, overview: { kind: "off" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh submissions" }));
    await screen.findByText("Your organization does not collect period submissions.");
    expect(Boolean(screen.queryByRole("link", { name: /Choose a submission cadence/ }))).toBe(scope === "all");
  });
}

it("independent: unchanged provider plus header refresh retains stale rows through read failure", async () => {
  seam.read.mockResolvedValueOnce(result("SAME SCOPE"));
  render(page());
  await screen.findByText("SAME SCOPE 0");
  const old = deferred<unknown>();
  seam.read.mockReturnValueOnce(old.promise);
  fireEvent.click(screen.getByRole("button", { name: "Refresh submissions" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
  await waitFor(() => expect(seam.fetch).toHaveBeenCalledTimes(1));
  await act(async () => old.resolve({ status: "unavailable" }));
  await screen.findByRole("alert");
  expect(screen.getByText("SAME SCOPE 0")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open the approval inbox" })).toBeTruthy();
  expect(seam.read).toHaveBeenCalledTimes(2);
});

it("independent: the actual provider route preserves all five canonical outcomes and frozen employee date", async () => {
  seam.read.mockResolvedValueOnce(result("FIVE OUTCOMES", "managed"));
  render(page({ scope: "managed" }));
  await screen.findByText("FIVE OUTCOMES 0");
  for (const label of ["Awaiting submission", "Submitted", "Approved", "Rejected", "Sent back after a change"])
    expect(screen.getAllByText(label)).toHaveLength(2);
  const summary = screen.getByRole("list", { name: "Statuses" });
  expect(summary.querySelectorAll("li")).toHaveLength(5);
  for (const item of summary.querySelectorAll("li")) expect(item.lastElementChild?.textContent).toBe("1");
  expect(screen.getAllByRole("link", { name: /Open the calendar of/ })).toHaveLength(5);
  expect(screen.getByRole("link", { name: "Open the calendar of FIVE OUTCOMES 0" }).getAttribute("href"))
    .toBe("/calendar/employee-0?date=2026-03-04");
  expect(screen.getByText("Employees you manage")).toBeTruthy();
  expect(screen.queryByText("All covered employees")).toBeNull();
});
