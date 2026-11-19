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

it("retains the current reader when the actual provider refreshes unchanged authority", async () => {
	seam.read.mockResolvedValueOnce(result("WIDE"));
	render(page());
	await screen.findByText("WIDE 0");
	const queued = deferred<ReturnType<typeof result>>();
	seam.read.mockReturnValueOnce(queued.promise);
	fireEvent.click(screen.getByRole("button", { name: "Refresh submissions" }));
	fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
	await waitFor(() => expect(seam.fetch).toHaveBeenCalledTimes(1));
	expect(screen.getByText("WIDE 0")).toBeTruthy();
	await act(async () => queued.resolve(result("CURRENT")));
	await screen.findByText("CURRENT 0");
	expect(seam.read).toHaveBeenCalledTimes(2);
});

for (const replacement of [
	{ name: "employee", employeeId: "replacement-reader", role: "admin" as const },
	{ name: "role", employeeId: "employee-reader", role: "employee" as const },
	{ name: "employee and role", employeeId: "replacement-reader", role: "employee" as const },
]) {
	for (const outcome of ["success", "refusal", "rejection"] as const) {
		it(
			"retires queued " +
				outcome +
				" after canonical " +
				replacement.name +
				" changes before RSC arrival",
			async () => {
				seam.read.mockResolvedValueOnce(result("WIDE"));
				render(page());
				await screen.findByText("WIDE 0");
				const old = deferred<unknown>();
				const fresh = deferred<ReturnType<typeof result>>();
				seam.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
				fireEvent.click(screen.getByRole("button", { name: "Refresh submissions" }));
				seam.fetch.mockResolvedValueOnce(contextResponse(replacement.employeeId, replacement.role));
				fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
				await waitFor(() =>
					expect(screen.getByLabelText("Display context").textContent).toContain(
						`"employeeId":"${replacement.employeeId}"`,
					),
				);
				await waitFor(() =>
					expect(screen.getByLabelText("Display context").textContent).toContain(
						`"role":"${replacement.role}"`,
					),
				);
				await waitFor(() => expect(seam.read).toHaveBeenCalledTimes(3));
				expect(screen.queryByText("WIDE 0")).toBeNull();
				expect(screen.queryByText("All covered employees")).toBeNull();
				expect(screen.queryByRole("link", { name: "Open the approval inbox" })).toBeNull();
				await act(async () => {
					if (outcome === "rejection") old.reject(new Error("retired transport"));
					else old.resolve(outcome === "success" ? result("LATE WIDE") : { status: "forbidden" });
				});
				expect(screen.queryByText("LATE WIDE 0")).toBeNull();
				expect(screen.queryByRole("alert")).toBeNull();
				expect(screen.queryByText(/Period submissions are unavailable/)).toBeNull();
				// The fresh server result decides access, including legitimate all-scope access
				// for an approved administrator whose display employee role is employee.
				await act(async () => fresh.resolve(result("FRESH AUTHORIZED")));
				await screen.findByText("FRESH AUTHORIZED 0");
				expect(screen.getByText("All covered employees")).toBeTruthy();
			},
		);
	}
}

it("reconciles a fresh server scope after the provider retires the old wider reader", async () => {
	seam.read.mockResolvedValueOnce(result("WIDE"));
	const view = render(page());
	await screen.findByText("WIDE 0");
	const old = deferred<unknown>();
	const fresh = deferred<unknown>();
	seam.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
	fireEvent.click(screen.getByRole("button", { name: "Refresh submissions" }));
	seam.fetch.mockResolvedValueOnce(contextResponse("replacement-reader", "employee"));
	fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
	await waitFor(() => expect(seam.read).toHaveBeenCalledTimes(3));
	seam.read.mockResolvedValueOnce({ status: "forbidden" });
	view.rerender(page({ scope: "managed" }));
	await screen.findByText(/Period submissions are unavailable/);
	await act(async () => {
		old.resolve(result("LATE WIDE"));
		fresh.resolve(result("ALSO RETIRED"));
	});
	expect(screen.queryByText("LATE WIDE 0")).toBeNull();
	expect(screen.queryByText("ALSO RETIRED 0")).toBeNull();
	expect(screen.queryByRole("link", { name: "Open the approval inbox" })).toBeNull();
});

it("recovers an initial canonical-context failure through its real local Retry", async () => {
	seam.fetch.mockRejectedValueOnce(new Error("private context failure"));
	render(page({ bootstrap: false }));
	await screen.findByRole("alert");
	expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
	expect(screen.queryByText("private context failure")).toBeNull();
	expect(seam.read).not.toHaveBeenCalled();
	seam.read.mockResolvedValueOnce(result("RECOVERED"));
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await screen.findByText("RECOVERED 0");
	expect(seam.fetch).toHaveBeenCalledTimes(2);
	expect(seam.read).toHaveBeenCalledTimes(1);
});

it("does not revive cached rows after provider failure and a changed-authority recovery", async () => {
	seam.read.mockResolvedValueOnce(result("WIDE"));
	render(page());
	await screen.findByText("WIDE 0");
	seam.fetch.mockRejectedValueOnce(new Error("context unavailable"));
	fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
	await screen.findByText("Could not check your current access.");
	expect(screen.queryByText("WIDE 0")).toBeNull();
	const fresh = deferred<ReturnType<typeof result>>();
	seam.read.mockReturnValueOnce(fresh.promise);
	seam.fetch.mockResolvedValueOnce(contextResponse("replacement-reader", "manager"));
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() => expect(seam.read).toHaveBeenCalledTimes(3));
	expect(screen.queryByText("WIDE 0")).toBeNull();
	await act(async () => fresh.resolve(result("MANAGED", "managed")));
	await screen.findByText("MANAGED 0");
	expect(screen.queryByText("All covered employees")).toBeNull();
	expect(screen.getByText("Employees you manage")).toBeTruthy();
});

it("allows the canonical read for an approved administrator without an employee", async () => {
	const bootstrap = { ...context(), employee: null };
	seam.read.mockResolvedValueOnce(result("ADMIN WITHOUT EMPLOYEE"));
	render(
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={bootstrap}>
				<PeriodSubmissionsClient access={access} requestedPeriod={null} />
			</OrganizationContextProvider>
		</QueryClientProvider>,
	);
	await screen.findByText("ADMIN WITHOUT EMPLOYEE 0");
	expect(screen.getByText("All covered employees")).toBeTruthy();
});
