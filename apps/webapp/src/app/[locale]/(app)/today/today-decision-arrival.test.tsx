/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TodayArrival } from "@/app/[locale]/(app)/today/today-types";
import { TodayWorkspace } from "@/app/[locale]/(app)/today/today-workspace";
import {
	OrganizationContextProvider,
	useOrganization,
} from "@/components/providers/organization-context-provider";
import {
	useViewRefreshAction,
	ViewRefreshProvider,
} from "@/components/providers/view-refresh-provider";
import type { OrganizationDisplayContext } from "@/lib/auth/organization-display-context";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	getManagerDailyBriefingFromSources,
	type ManagerDailyBriefingSources,
} from "@/lib/manager-daily-briefing/get-manager-daily-briefing";

const h = vi.hoisted(() => ({
	read: vi.fn(),
	fetch: vi.fn(),
	router: { refresh: vi.fn(), replace: vi.fn() },
	toast: { success: vi.fn(), error: vi.fn() },
	session: {
		data: {
			user: { id: "review-actor" },
			session: { id: "review-session", activeOrganizationId: "review-org" },
		},
		isPending: false,
	},
}));
vi.mock("@/app/[locale]/(app)/today/actions", () => ({ readTodayBriefing: h.read }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => h.session }));
vi.mock("next/navigation", () => ({ useRouter: () => h.router }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/navigation", () => ({
	useRouter: () => h.router,
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(s, [k, v]) => s.replaceAll(`{${k}}`, String(v)),
				fallback,
			),
	}),
}));

const scope = { userId: "review-actor", organizationId: "review-org" };
const context: OrganizationDisplayContext = {
	...scope,
	employee: { employeeId: "review-manager", organizationId: scope.organizationId, role: "manager" },
	organizationSettings: null,
	updatedAt: Date.now(),
};
const title = (id: string) => `${id} needs Leave approval`;
const detail = (id: string) => `${id} synthetic private reason`;
let client: QueryClient;
let next: TodayArrival;
let sourceCalls: unknown[];
let postCalls: string[];
let heldPost: ReturnType<typeof deferred<Response>> | undefined;
let postSettled: boolean;
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function response(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// Only external source adapters are modeled; the production builder computes the
// population, maps approval items, creates section errors and builds Needs Action.
async function arrival(
	ids: string[],
	failed: string[] = [],
	freshPayroll = "",
): Promise<TodayArrival> {
	const fail = (name: string) => {
		if (failed.includes(name)) throw Error(`synthetic ${name} outage`);
	};
	const sources: ManagerDailyBriefingSources = {
		getScopedEmployees: async () => ids.map((id) => ({ id, name: id, teamName: null })),
		getPublishedShifts: async () => [],
		getOpenTimeRecords: async () => [],
		getCoverageRules: async () => [],
		getApprovedAbsences: async (input) => {
			fail("absences");
			return input.employeeIds.map((id) => ({
				id: `leave-${id}`,
				employeeId: id,
				employeeName: id,
				teamName: null,
				categoryName: `${id} private absence`,
				startDate: "2026-11-17",
				endDate: "2026-11-17",
				status: "approved" as const,
			}));
		},
		getApprovals: async (input) => {
			sourceCalls.push({
				kind: "approvals",
				ids: input.employeeIds,
				org: input.organizationId,
				approver: input.approverId,
				failed: failed.includes("approvals"),
			});
			fail("approvals");
			// Deliberately oversupply: canonical builder must filter approvals.
			return ["retired-report", "current-report", "added-report"].map((id) => ({
				id: `approval-${id}`,
				entityId: `entity-${id}`,
				approvalType: "absence",
				typeName: "Leave",
				requester: { id, name: id },
				priority: "normal" as const,
				display: { summary: detail(id) },
			}));
		},
		getOvertimeWarnings: async () => {
			fail("overtime");
			return [];
		},
		getPayrollIssues: async () => {
			fail("payroll");
			return freshPayroll
				? [
						{
							id: "fresh-payroll",
							title: freshPayroll,
							category: "payroll",
							severity: "warning",
							description: "Fresh sibling result",
							href: "/settings/payroll-readiness",
						},
					]
				: [];
		},
		getDrivingDetailsMissingCount: async () => {
			fail("driving");
			return ids.includes("retired-report") ? 3 : 0;
		},
	};
	return {
		status: "ready",
		view: { ...scope, employeeId: "review-manager", role: "manager" },
		briefing: await getManagerDailyBriefingFromSources({
			organizationId: scope.organizationId,
			currentEmployee: { id: "review-manager", role: "manager" },
			now: parseInstant("2026-11-17T12:00:00Z"),
			timezone: "Europe/Berlin",
			sources,
		}),
	};
}
function Controls() {
	const org = useOrganization(),
		refresh = useViewRefreshAction();
	return (
		<>
			<output data-testid="provider">
				{JSON.stringify([
					org.userId,
					org.activeOrganizationId,
					org.employeeId,
					org.role,
					org.error,
				])}
			</output>
			<button type="button" onClick={refresh.refresh}>
				Review refresh
			</button>
		</>
	);
}
function mount(initial: TodayArrival) {
	client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
	const content = (mode: "visible" | "hidden", instance = "original") => (
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={context}>
				<ViewRefreshProvider>
					<Controls />
					<Activity mode={mode}>
						<TodayWorkspace key={instance} scope={scope} initial={initial} />
					</Activity>
				</ViewRefreshProvider>
			</OrganizationContextProvider>
		</QueryClientProvider>
	);
	const view = render(content("visible"));
	return {
		...view,
		activity: (mode: "visible" | "hidden") => view.rerender(content(mode)),
		replace: () => view.rerender(content("visible", "replacement")),
		remount: () => {
			view.unmount();
			return render(content("visible"));
		},
	};
}
async function refresh(value: TodayArrival) {
	next = value;
	const before = h.read.mock.calls.length;
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Review refresh" })));
	await waitFor(() => expect(h.read).toHaveBeenCalledTimes(before + 1));
	expect(h.read).toHaveBeenLastCalledWith(scope);
	expect(screen.getByTestId("provider").textContent).toBe(
		JSON.stringify([scope.userId, scope.organizationId, "review-manager", "manager", null]),
	);
}
const approve = () =>
	screen.getByRole("button", { name: `Approve ${title("current-report")}` }) as HTMLButtonElement;
const reject = () =>
	screen.getByRole("button", { name: `Reject ${title("current-report")}` }) as HTMLButtonElement;
beforeEach(() => {
	vi.clearAllMocks();
	sourceCalls = [];
	postCalls = [];
	heldPost = undefined;
	postSettled = false;
	h.session.data.session.activeOrganizationId = scope.organizationId;
	h.session.isPending = false;
	h.read.mockImplementation(async () => next);
	h.fetch.mockImplementation((url: string) => {
		if (url === "/api/auth/context")
			return Promise.resolve(
				response({
					user: { id: scope.userId },
					session: { activeOrganizationId: scope.organizationId },
					employee: context.employee,
					organizationSettings: null,
				}),
			);
		if (url.startsWith("/api/approvals/inbox/")) {
			postCalls.push(url);
			if (postCalls.length === 1 && heldPost) return heldPost.promise;
			return Promise.resolve(response({ success: false, error: "Synthetic current refusal" }, 403));
		}
		throw Error("Unexpected external transport");
	});
	vi.stubGlobal("fetch", h.fetch);
});
afterEach(() => {
	cleanup();
	client?.clear();
	vi.unstubAllGlobals();
});

describe("independent partial-result priority", () => {
	it("successful narrowing filters an oversupplied approval source and current data stays actionable", async () => {
		mount(await arrival(["retired-report", "current-report"]));
		expect(screen.getByText(title("retired-report"))).toBeTruthy();
		await refresh(await arrival(["current-report"]));
		expect(screen.queryByText(title("retired-report"))).toBeNull();
		expect(screen.queryByText(detail("retired-report"))).toBeNull();
		expect(approve().disabled).toBe(false);
		expect(sourceCalls).toEqual([
			{
				kind: "approvals",
				ids: ["retired-report", "current-report"],
				org: scope.organizationId,
				approver: "review-manager",
				failed: false,
			},
			{
				kind: "approvals",
				ids: ["current-report"],
				org: scope.organizationId,
				approver: "review-manager",
				failed: false,
			},
		]);
	});
	it("narrowed multi-section/driving failure removes prior rows and categories but keeps fresh payroll and real Retry", async () => {
		mount(await arrival(["retired-report", "current-report"]));
		expect(screen.getAllByText("Driving details missing (3)").length).toBeGreaterThan(0);
		await refresh(
			await arrival(
				["current-report"],
				["approvals", "absences", "driving"],
				"Fresh narrowed payroll",
			),
		);
		expect(screen.queryByText(title("retired-report"))).toBeNull();
		expect(screen.queryByText(detail("retired-report"))).toBeNull();
		expect(screen.queryByText(/retired-report private absence/)).toBeNull();
		expect(screen.queryByText("Driving details missing (3)")).toBeNull();
		expect(screen.getAllByText("Fresh narrowed payroll").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Driving details could not be checked.").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Section could not be loaded.").length).toBeGreaterThan(0);
		next = await arrival(["current-report"]);
		fireEvent.click(screen.getByRole("button", { name: "Retry approvals" }));
		await waitFor(() => expect(approve().disabled).toBe(false));
		expect(h.read).toHaveBeenCalledTimes(2);
		expect(screen.queryByText(title("retired-report"))).toBeNull();
	});
	it("expanded population with failed approvals has error/Retry without reusing old details and recovers added rows", async () => {
		mount(await arrival(["current-report"]));
		await refresh(
			await arrival(["current-report", "added-report"], ["approvals"], "Expanded payroll"),
		);
		expect(screen.queryByText(detail("current-report"))).toBeNull();
		expect(screen.queryByText(title("current-report"))).toBeNull();
		expect(screen.getAllByText("Expanded payroll").length).toBeGreaterThan(0);
		next = await arrival(["current-report", "added-report"]);
		fireEvent.click(screen.getByRole("button", { name: "Retry approvals" }));
		await screen.findByText(title("added-report"));
		expect(approve().disabled).toBe(false);
		expect(screen.queryByText(title("retired-report"))).toBeNull();
	});
	it("same-population partial failure removes unproven old details and preserves fresh successful siblings", async () => {
		mount(await arrival(["current-report"]));
		await refresh(await arrival(["current-report"], ["approvals"], "Current payroll proof"));
		expect(screen.queryByText(title("current-report"))).toBeNull();
		expect(screen.getAllByText("Current payroll proof").length).toBeGreaterThan(0);
		expect(screen.getByRole("button", { name: "Retry approvals" })).toBeTruthy();
		expect(screen.getAllByText("Section could not be loaded.").length).toBeGreaterThan(0);
	});
	it("whole-read structured error retains current snapshot, disables decisions, and Retry recovers", async () => {
		mount(await arrival(["current-report"]));
		await refresh({ status: "error" });
		expect(screen.getByText(title("current-report"))).toBeTruthy();
		expect(approve().disabled).toBe(true);
		expect(
			screen.getByText("Could not refresh. Previous results are shown; try again before acting."),
		).toBeTruthy();
		next = await arrival(["current-report"]);
		fireEvent.click(screen.getByRole("button", { name: "Retry briefing" }));
		await waitFor(() => expect(approve().disabled).toBe(false));
	});
	it("whole-read transport rejection retains snapshot and current Retry reauthorizes", async () => {
		mount(await arrival(["current-report"]));
		h.read.mockRejectedValueOnce(Error("Synthetic offline"));
		await refresh({ status: "error" });
		expect(screen.getByText(title("current-report"))).toBeTruthy();
		expect(approve().disabled).toBe(true);
		next = await arrival(["current-report"]);
		fireEvent.click(screen.getByRole("button", { name: "Retry briefing" }));
		await waitFor(() => expect(approve().disabled).toBe(false));
	});
});

describe("independent decision settlement priority", () => {
	it("control: pending same-arrival approve and opposing reject serialize until refusal settles", async () => {
		heldPost = deferred<Response>();
		mount(await arrival(["current-report"]));
		fireEvent.click(approve());
		fireEvent.click(approve());
		fireEvent.click(reject());
		expect(postCalls).toHaveLength(1);
		expect(approve().disabled).toBe(true);
		await act(async () =>
			heldPost!.resolve(response({ success: false, error: "Synthetic current refusal" }, 403)),
		);
		expect(approve().disabled).toBe(false);
		expect(screen.getByRole("alert").textContent).toContain("Synthetic current refusal");
		expect(h.router.refresh).not.toHaveBeenCalled();
		expect(h.read).not.toHaveBeenCalled();
		fireEvent.click(reject());
		await waitFor(() => expect(postCalls).toHaveLength(2));
	});
	it("control: current successful decision refreshes through both existing owners", async () => {
		heldPost = deferred<Response>();
		mount(await arrival(["current-report"]));
		next = await arrival([]);
		fireEvent.click(approve());
		await act(async () => heldPost!.resolve(response({ success: true })));
		expect(h.toast.success).toHaveBeenCalledWith("Request approved");
		expect(h.router.refresh).toHaveBeenCalledTimes(1);
		expect(h.read).toHaveBeenCalledTimes(1);
		expect(screen.queryByText(title("current-report"))).toBeNull();
	});
	it("control: Activity retires late success feedback and refresh without another decision", async () => {
		heldPost = deferred<Response>();
		const initial = await arrival(["current-report"]);
		next = initial;
		const view = mount(initial);
		fireEvent.click(approve());
		view.activity("hidden");
		view.activity("visible");
		await waitFor(() => expect(approve()).toBeTruthy());
		expect(h.read).toHaveBeenCalledTimes(1);
		await act(async () => heldPost!.resolve(response({ success: true })));
		expect(h.toast.success).not.toHaveBeenCalled();
		expect(h.router.refresh).not.toHaveBeenCalled();
		expect(h.read).toHaveBeenCalledTimes(1);
		expect(postCalls).toHaveLength(1);
	});
	it("P1: Activity return must not POST opposing decision while the first POST remains unresolved", async () => {
		heldPost = deferred<Response>();
		heldPost.promise.then(() => {
			postSettled = true;
		});
		const initial = await arrival(["current-report"]);
		next = initial;
		const view = mount(initial);
		fireEvent.click(approve());
		expect(postCalls).toHaveLength(1);
		expect(approve().disabled).toBe(true);
		view.activity("hidden");
		view.activity("visible");
		await waitFor(() => expect(approve()).toBeTruthy());
		const returnedDisabled = approve().disabled;
		fireEvent.click(reject());
		const observation = {
			firstPostSettled: postSettled,
			returnedApproveDisabled: returnedDisabled,
			postCalls: [...postCalls],
			briefingReads: h.read.mock.calls.length,
			provider: screen.getByTestId("provider").textContent,
		};
		console.log("R164_INDEPENDENT_ACTIVITY_POST", JSON.stringify(observation));
		// Settle our own promises before the assertion even when it fails. No real POST ran.
		await act(async () => heldPost!.resolve(response({ success: true })));
		expect(h.toast.success).not.toHaveBeenCalled();
		expect(observation.postCalls).toHaveLength(1);
	});

	it.each([
		["unmount", "success"],
		["key", "refusal"],
		["org-return", "rejection"],
	] as const)(
		"%s keeps the reservation until retired %s settles and permits a new decision",
		async (mode, outcome) => {
			const post = deferred<Response>();
			heldPost = post;
			const initial = await arrival(["current-report"]);
			next = initial;
			const view = mount(initial);
			fireEvent.click(approve());
			expect(postCalls).toHaveLength(1);
			if (mode === "unmount") view.remount();
			else if (mode === "key") view.replace();
			else {
				h.session.data.session.activeOrganizationId = "other-org";
				view.activity("visible");
				expect(
					screen.queryByRole("button", { name: `Approve ${title("current-report")}` }),
				).toBeNull();
				h.session.data.session.activeOrganizationId = scope.organizationId;
				view.activity("visible");
			}
			await waitFor(() => expect(approve().disabled).toBe(true));
			fireEvent.click(reject());
			expect(postCalls).toHaveLength(1);
			await act(async () => {
				if (outcome === "rejection") post.reject(Error("Synthetic retired transport"));
				else
					post.resolve(
						response(
							outcome === "success"
								? { success: true }
								: { success: false, error: "Synthetic retired refusal" },
							outcome === "success" ? 200 : 403,
						),
					);
			});
			await waitFor(() => expect(approve().disabled).toBe(false));
			expect(h.toast.success).not.toHaveBeenCalled();
			expect(h.toast.error).not.toHaveBeenCalled();
			expect(h.router.refresh).not.toHaveBeenCalled();
			fireEvent.click(reject());
			await waitFor(() => expect(postCalls).toHaveLength(2));
			await screen.findByText("Synthetic current refusal");
			expect(reject().disabled).toBe(false);
		},
	);
});
