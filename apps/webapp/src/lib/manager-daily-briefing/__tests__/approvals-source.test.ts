/**
 * The briefing's approvals list reads triage evidence only for the items that can reach its
 * page (#1980), a few at a time, as the Dashboard preview does (#1978), while listing exactly
 * what the inbox lists first.
 */
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnifiedApprovalItem } from "@/lib/approvals/domain/types";
import type { ApprovalInboxListParams } from "@/lib/approvals/inbox/read-service";
import type {
	ApprovalInboxTriageEvidenceResult,
	ApprovalInboxTriageTarget,
} from "@/lib/approvals/inbox/triage-evidence";
import { DEFAULT_APPROVAL_TRIAGE_POLICY } from "@/lib/approvals/triage-policy-config";
import { managerDailyBriefingDatabaseSources } from "../get-manager-daily-briefing";

const ORG = "org-1";
const VIEWER = "manager-1";
const MINE = "employee-1";
const NOW = new Date("2026-06-10T12:00:00.000Z");

const fixture = vi.hoisted(() => ({
	approvals: [] as UnifiedApprovalItem[],
	shortfalls: new Set<string>(),
	inFlight: 0,
	mostInFlight: 0,
	loaded: [] as string[],
	scopeInputs: [] as unknown[],
	countFails: false,
}));

vi.mock("@/lib/approvals/init", () => ({}));
vi.mock("@/lib/auth-helpers", () => ({
	getPrincipalContext: async () => ({
		userId: "user-manager-1",
		activeOrganizationId: "org-1",
		employee: { id: "manager-1", organizationId: "org-1" },
	}),
}));
vi.mock("@/lib/authorization", () => ({ defineAbilityFor: () => ({}) }));
vi.mock("@/lib/approvals/inbox/viewer-scope", () => ({
	resolveApprovalInboxViewerScope: async (input: unknown) => {
		fixture.scopeInputs.push(input);
		return { approverId: "manager-1", organizationId: "org-1" };
	},
}));
vi.mock("@/lib/approvals/triage-policy", async () => {
	const { DEFAULT_APPROVAL_TRIAGE_POLICY: policy } =
		await import("@/lib/approvals/triage-policy-config");
	return { getEffectiveApprovalTriagePolicy: async () => policy };
});
// Current evidence, read as the inbox reads it: a staffing shortfall (high risk) for the
// listed requests, every check verified clear (low risk) for the rest. Each load is counted.
vi.mock("@/lib/approvals/inbox/triage-evidence", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/approvals/inbox/triage-evidence")>();
	return {
		...actual,
		loadCurrentApprovalTriageEvidence: async (
			target: ApprovalInboxTriageTarget,
		): Promise<ApprovalInboxTriageEvidenceResult> => {
			fixture.loaded.push(target.context.requestId);
			fixture.inFlight += 1;
			fixture.mostInFlight = Math.max(fixture.mostInFlight, fixture.inFlight);
			await new Promise((resolve) => setTimeout(resolve, 0));
			fixture.inFlight -= 1;
			const context = { ...target.context, revision: "revision-1" };
			return {
				context,
				evidence: [
					{
						check: "payroll",
						state: "clear",
						validity: "current",
						context,
						payrollPeriod: { startDate: "2026-06-01", endDate: "2026-06-30" },
					},
					fixture.shortfalls.has(target.context.requestId)
						? {
								check: "coverage",
								state: "finding",
								reason: "staffing_shortfall",
								validity: "current",
								context,
							}
						: { check: "coverage", state: "clear", validity: "current", context },
				],
			};
		},
	};
});
// The inbox's list read over one legacy absence source holding the fixture's approvals.
vi.mock("@/lib/approvals/inbox/read-service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/approvals/inbox/read-service")>();
	const { loadCurrentApprovalTriageEvidence } =
		await import("@/lib/approvals/inbox/triage-evidence");
	const matching = (query: ApprovalInboxListParams) =>
		fixture.approvals.filter(
			(item) =>
				item.approverId === query.approverId &&
				(!query.requesterEmployeeIds || query.requesterEmployeeIds.includes(item.requester.id)),
		);
	const absenceSource = {
		type: "absence_entry",
		displayName: "absence_entry",
		supportsBulkApprove: true,
		handler: {
			type: "absence_entry",
			displayName: "absence_entry",
			supportsBulkApprove: true,
			getApprovals: (query: ApprovalInboxListParams) => Effect.succeed(matching(query)),
			getCount: (
				approverId: string,
				organizationId: string,
				options?: { requesterEmployeeIds?: string[] },
			) =>
				fixture.countFails
					? Effect.fail(new Error("count read failed"))
					: Effect.succeed(
							matching({
								approverId,
								organizationId,
								requesterEmployeeIds: options?.requesterEmployeeIds,
							}).length,
						),
		},
	} as never;
	return {
		...actual,
		getApprovalInboxList: (
			params: ApprovalInboxListParams,
			options: Parameters<typeof actual.getApprovalInboxList>[1] = {},
		) =>
			actual.getApprovalInboxListFromSources({
				sources: [absenceSource],
				params,
				...options,
				now: options.now ?? NOW,
				triagePolicy: options.triagePolicy ?? DEFAULT_APPROVAL_TRIAGE_POLICY,
				loadTriageEvidence: options.loadTriageEvidence ?? loadCurrentApprovalTriageEvidence,
			}),
	};
});

function absence(id: string, minute: number, requesterId = MINE): UnifiedApprovalItem {
	return {
		id,
		approvalType: "absence_entry",
		entityId: `entity-${id}`,
		typeName: "absence_entry",
		requester: {
			id: requesterId,
			userId: `user-${requesterId}`,
			name: "Avery Employee",
			email: "avery@example.com",
			image: null,
			teamId: null,
		},
		approverId: VIEWER,
		organizationId: ORG,
		status: "pending",
		// A minute apart, oldest first, and recent enough that none is stale at NOW.
		createdAt: new Date(NOW.getTime() - (200 - minute) * 60_000),
		resolvedAt: null,
		priority: "normal",
		sla: { deadline: null, status: "on_time", hoursRemaining: null },
		display: { title: id, subtitle: "", summary: "" },
	};
}

const readBriefingApprovals = () =>
	managerDailyBriefingDatabaseSources.getApprovals({
		organizationId: ORG,
		employeeIds: [MINE],
		viewer: { id: VIEWER, role: "manager" },
	});

describe("the briefing's approvals with bounded triage evidence (#1980)", () => {
	beforeEach(() => {
		vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
		fixture.inFlight = 0;
		fixture.mostInFlight = 0;
		fixture.loaded = [];
		fixture.scopeInputs = [];
		fixture.countFails = false;
	});

	it("counts at least the rows it read for a type whose count failed, so the list shows as cut off", async () => {
		// 40 pending absences, every one read, but the absence count failed.
		fixture.approvals = Array.from({ length: 40 }, (_, index) => absence(`a${index}`, index));
		fixture.shortfalls = new Set();
		fixture.countFails = true;

		const approvals = await readBriefingApprovals();

		expect(approvals).toHaveLength(25);
		expect(approvals.uncountedTypes).toEqual(["absence_entry"]);
		// The 40 rows in hand, not the 25 shown: "Showing 25 of at least 40".
		expect(approvals.totalCount).toBe(40);
	});

	it("asks the inbox scope for no deputy covers: the briefing shows no Covering sections", async () => {
		fixture.approvals = [];
		fixture.shortfalls = new Set();

		await readBriefingApprovals();

		expect(fixture.scopeInputs).toEqual([expect.objectContaining({ includeCovering: false })]);
	});

	it("reads evidence only for the absences that can reach its 25, a few at a time", async () => {
		// The 25 oldest have a staffing shortfall (high risk); 100 newer ones are clear (low
		// risk). Another employee's absences are never the briefing's.
		const high = Array.from({ length: 25 }, (_, index) => absence(`h${index}`, index));
		const low = Array.from({ length: 100 }, (_, index) => absence(`l${index}`, 25 + index));
		const others = Array.from({ length: 10 }, (_, index) =>
			absence(`o${index}`, index, "employee-2"),
		);
		fixture.approvals = [...high, ...low, ...others];
		fixture.shortfalls = new Set([...high, ...others].map((item) => item.id));

		const approvals = await readBriefingApprovals();

		expect(approvals.map((item) => item.id)).toEqual(high.map((item) => item.id));
		expect(approvals.totalCount).toBe(125);
		expect(approvals.unavailableTypes).toBeUndefined();
		expect(approvals.uncountedTypes).toBeUndefined();
		// The 25 high ones fill the page, and no newer absence's best case can pass them.
		expect([...fixture.loaded].sort()).toEqual(high.map((item) => item.id).sort());
		expect(fixture.mostInFlight).toBeLessThanOrEqual(5);
	});

	it("lists the inbox's first 25 in its order when evidence raises newer absences", async () => {
		// Every absence is clear but a few newer ones, which current evidence moves to the top.
		const absences = Array.from({ length: 60 }, (_, index) => absence(`a${index}`, index));
		fixture.approvals = absences;
		fixture.shortfalls = new Set(["a40", "a59"]);

		const approvals = await readBriefingApprovals();

		expect(approvals.map((item) => item.id)).toEqual([
			"a40",
			"a59",
			...absences.slice(0, 23).map((item) => item.id),
		]);
		expect(approvals.totalCount).toBe(60);
		expect(fixture.mostInFlight).toBeLessThanOrEqual(5);
	});
});
