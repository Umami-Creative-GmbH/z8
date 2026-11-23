/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
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
import { briefingInboxApproval } from "@/lib/manager-daily-briefing/testing/briefing-approval.test-fixture";

const h = vi.hoisted(() => ({
	read: vi.fn(),
	fetch: vi.fn(),
	router: { refresh: vi.fn(), replace: vi.fn() },
	session: {
		data: {
			user: { id: "review-user" },
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
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(s, [k, v]) => s.replaceAll(`{${k}}`, String(v)),
				fallback,
			),
	}),
}));

const scope = { userId: "review-user", organizationId: "review-org" };
const identity: OrganizationDisplayContext = {
	...scope,
	employee: { employeeId: "review-manager", organizationId: scope.organizationId, role: "manager" },
	organizationSettings: null,
	updatedAt: Date.now(),
};
const retiredTitle = "Retired report: Leave";
const currentTitle = "Current report: Leave";
const retiredSecret = "Retired report private leave details";
let client: QueryClient;
let accepted: TodayArrival;
let contextCalls = 0;
const observedScopes: Array<{ employeeIds: string[]; failed: boolean }> = [];

// This is a synthetic transport-side source adapter. Production builder performs
// the real population filtering, error handling, sections and needsAction mapping.
// No production DB/auth/source/controller implementation is replaced or edited.
async function snapshot(
	employeeIds: string[],
	failed = false,
	payrollTitle?: string,
): Promise<TodayArrival> {
	const sources: ManagerDailyBriefingSources = {
		getScopedEmployees: async () => employeeIds.map((id) => ({ id, name: id, teamName: null })),
		getPublishedShifts: async () => [],
		getOpenTimeRecords: async () => [],
		getApprovedAbsences: async () => [],
		getCoverageRules: async () => [],
		getOvertimeWarnings: async () => [],
		getPayrollIssues: async () =>
			payrollTitle
				? [
						{
							id: "fresh-payroll",
							title: payrollTitle,
							description: "Review current mapping",
							category: "payroll",
							severity: "warning",
							href: "/settings/payroll-readiness",
						},
					]
				: [],
		getDrivingDetailsMissingCount: async () => 0,
		getApprovals: async (input) => {
			observedScopes.push({ employeeIds: [...input.employeeIds], failed });
			if (failed) throw Error("synthetic approvals outage");
			// Return both so the ACTUAL builder must enforce the new population.
			return [
				briefingInboxApproval({
					id: "retired-approval",
					entityId: "retired-leave",
					title: "Leave",
					requester: { id: "report-retired", name: "Retired report" },
					detail: retiredSecret,
				}),
				briefingInboxApproval({
					id: "current-approval",
					entityId: "current-leave",
					title: "Leave",
					requester: { id: "report-current", name: "Current report" },
					detail: "Current report leave details",
				}),
			];
		},
	};
	const briefing = await getManagerDailyBriefingFromSources({
		organizationId: scope.organizationId,
		currentEmployee: { id: "review-manager", role: "manager" },
		now: parseInstant("2026-11-17T09:00:00Z"),
		timezone: "Europe/Berlin",
		sources,
	});
	return {
		status: "ready",
		briefing,
		view: { ...scope, employeeId: "review-manager", role: "manager" },
	};
}
function Controls() {
	const org = useOrganization();
	const refresh = useViewRefreshAction();
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
				Independent refresh
			</button>
		</>
	);
}
function mount(initial: TodayArrival) {
	client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
	return render(
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={identity}>
				<ViewRefreshProvider>
					<Controls />
					<TodayWorkspace scope={scope} initial={initial} />
				</ViewRefreshProvider>
			</OrganizationContextProvider>
		</QueryClientProvider>,
	);
}
async function refresh(next: TodayArrival) {
	accepted = next;
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Independent refresh" }));
	});
	await waitFor(() => expect(h.read).toHaveBeenCalledTimes(1));
	expect(contextCalls).toBe(1);
	expect(screen.getByTestId("provider").textContent).toBe(
		JSON.stringify(["review-user", "review-org", "review-manager", "manager", null]),
	);
	expect(h.read).toHaveBeenLastCalledWith(scope);
}
beforeEach(() => {
	vi.clearAllMocks();
	contextCalls = 0;
	observedScopes.length = 0;
	h.read.mockImplementation(async () => accepted);
	h.fetch.mockImplementation(async (url: string) => {
		if (url !== "/api/auth/context") throw Error("unexpected external request");
		contextCalls++;
		return new Response(
			JSON.stringify({
				user: { id: scope.userId },
				session: { activeOrganizationId: scope.organizationId },
				employee: identity.employee,
				organizationSettings: null,
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	});
	vi.stubGlobal("fetch", h.fetch);
});
afterEach(() => {
	cleanup();
	client?.clear();
	vi.unstubAllGlobals();
});
describe("new independent population/controller seam", () => {
	it("control: successful narrowed read removes retired report section rows", async () => {
		mount(await snapshot(["report-retired", "report-current"]));
		expect(screen.getAllByText(retiredTitle)).toHaveLength(1);
		const next = await snapshot(["report-current"]);
		expect(
			next.status === "ready" && next.briefing.sections.approvals.items.map((i) => i.approvalId),
		).toEqual(["current-approval"]);
		await refresh(next);
		expect(screen.queryByText(retiredTitle)).toBeNull();
		expect(screen.queryByText(retiredSecret)).toBeNull();
		expect(screen.getAllByText(currentTitle)).toHaveLength(1);
		expect(observedScopes).toEqual([
			{ employeeIds: ["report-retired", "report-current"], failed: false },
			{ employeeIds: ["report-current"], failed: false },
		]);
	});
	it("control: partial reads do not reuse prior rows without population provenance", async () => {
		mount(await snapshot(["report-retired", "report-current"]));
		await refresh(await snapshot(["report-retired", "report-current"], true));
		expect(screen.queryByText(retiredTitle)).toBeNull();
		expect(screen.queryByText(retiredSecret)).toBeNull();
		expect(screen.getAllByText("Section could not be loaded.").length).toBeGreaterThan(0);
		expect(screen.queryByRole("button", { name: `Approve ${retiredTitle}` })).toBeNull();
		expect(screen.getByRole("button", { name: "Retry approvals" })).toBeTruthy();
	});
	it("P1: successful narrower population plus partial failure must not resurrect retired private rows", async () => {
		mount(await snapshot(["report-retired", "report-current"]));
		const next = await snapshot(["report-current"], true);
		expect(next.status === "ready" && next.briefing.sections.approvals.items).toEqual([]);
		expect(next.status === "ready" && next.briefing.sections.approvals.error).toBe(
			"Section could not be loaded.",
		);
		await refresh(next);
		const observation = {
			sourceScopes: observedScopes,
			provider: screen.getByTestId("provider").textContent,
			retiredTitleOccurrences: screen.queryAllByText(retiredTitle).length,
			retiredPrivateDetailOccurrences: screen.queryAllByText(retiredSecret).length,
			currentTitleOccurrences: screen.queryAllByText(currentTitle).length,
			approvalDisabled: screen
				.queryByRole("button", { name: `Approve ${retiredTitle}` })
				?.hasAttribute("disabled"),
			contextCalls,
			readCalls: h.read.mock.calls.length,
		};
		console.log("R164_NARROWED_POPULATION", JSON.stringify(observation));
		expect(observation).toMatchObject({
			retiredTitleOccurrences: 0,
			retiredPrivateDetailOccurrences: 0,
		});
	});
	it("partial failure preserves freshly successful sections and local recovery", async () => {
		mount(await snapshot(["report-retired", "report-current"]));
		await refresh(await snapshot(["report-current"], true, "Current payroll check"));
		expect(screen.queryByText(retiredSecret)).toBeNull();
		expect(screen.getAllByText("Current payroll check").length).toBeGreaterThan(0);
		expect(screen.getByRole("button", { name: "Retry approvals" })).toBeTruthy();
		accepted = await snapshot(["report-current"]);
		fireEvent.click(screen.getByRole("button", { name: "Retry approvals" }));
		await screen.findByText(currentTitle);
		expect(screen.queryByText(retiredTitle)).toBeNull();
	});
});
