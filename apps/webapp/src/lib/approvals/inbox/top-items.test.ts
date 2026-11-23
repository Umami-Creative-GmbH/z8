import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { UnifiedApprovalItem } from "@/lib/approvals/domain/types";
import { DEFAULT_APPROVAL_TRIAGE_POLICY } from "../triage-policy-config";
import {
	type ApprovalInboxListParams,
	compareInboxItems,
	getApprovalInboxListFromSources,
} from "./read-service";
import type { ApprovalInboxSource } from "./source-adapters";
import { getApprovalInboxTopItems } from "./top-items";
import type {
	ApprovalInboxTriageEvidenceResult,
	ApprovalInboxTriageTarget,
} from "./triage-evidence";
import type { ApprovalInboxItem, ApprovalInboxType } from "./types";

const NOW = new Date("2026-06-10T12:00:00.000Z");
const VIEWER = "manager-1";
const ABSENT = "absent-1";
const params: ApprovalInboxListParams = {
	approverId: VIEWER,
	organizationId: "org-1",
	status: "pending",
};

function approval(
	id: string,
	approvalType: UnifiedApprovalItem["approvalType"],
	createdAt: string,
	priority: UnifiedApprovalItem["priority"] = "normal",
	{ approverId = VIEWER, requesterId = "employee-1" } = {},
): UnifiedApprovalItem {
	return {
		id,
		approvalType,
		entityId: `entity-${id}`,
		typeName: approvalType,
		requester: {
			id: requesterId,
			userId: `user-${requesterId}`,
			name: "Avery Employee",
			email: "avery@example.com",
			image: null,
			teamId: null,
		},
		approverId,
		organizationId: "org-1",
		status: "pending",
		createdAt: new Date(createdAt),
		resolvedAt: null,
		priority,
		sla: { deadline: null, status: "on_time", hoursRemaining: null },
		display: { title: id, subtitle: "", summary: "" },
	};
}

/** A legacy source: an approver's own assignments, or every one for an org-wide viewer. */
function source(
	type: ApprovalInboxSource["type"],
	items: UnifiedApprovalItem[],
	fails: { list?: boolean; count?: boolean } = {},
) {
	const assigned = (approverId: string, all?: boolean) =>
		items.filter((item) => all || item.approverId === approverId);
	return {
		type,
		displayName: type,
		supportsBulkApprove: true,
		handler: {
			type,
			displayName: type,
			supportsBulkApprove: true,
			getApprovals: vi.fn((query: ApprovalInboxListParams) =>
				fails.list
					? Effect.fail(new Error("unavailable"))
					: Effect.succeed(assigned(query.approverId, query.includeAllApprovers)),
			),
			getCount: vi.fn(
				(approverId: string, _org: string, options?: { includeAllApprovers?: boolean }) =>
					fails.count
						? Effect.fail(new Error("unavailable"))
						: Effect.succeed(assigned(approverId, options?.includeAllApprovers).length),
			),
		} as never,
	} satisfies ApprovalInboxSource;
}

type CanonicalRow = { id: string; createdAt: string; approverId?: string };

/** A canonical read of one workflow kind; evidence-aware kinds are re-evaluated by the inbox. */
function canonicalRead(
	type: ApprovalInboxType,
	workflowKind: "absence_change" | "period_submission",
	rows: CanonicalRow[],
) {
	const assigned = (approverId: string) =>
		rows.filter((row) => (row.approverId ?? VIEWER) === approverId);
	return {
		type,
		workflowTypes: [workflowKind],
		load: async (input: { approverId: string }) =>
			assigned(input.approverId).map((row) => ({
				item: inboxItem(row.id, type, row.createdAt, "normal", "medium"),
				decisionTarget: {
					workflowKind,
					approverId: row.approverId ?? VIEWER,
					requesterEmployeeId: "employee-1",
				},
			})),
		count: async (input: { approverId: string }) => assigned(input.approverId).length,
	} as never;
}

function inboxItem(
	id: string,
	type: ApprovalInboxType,
	createdAt: string,
	priority: ApprovalInboxItem["triage"]["priority"],
	riskLevel: ApprovalInboxItem["triage"]["riskLevel"],
): ApprovalInboxItem {
	return {
		id,
		type,
		entityId: `entity-${id}`,
		status: "pending",
		requester: {
			id: "employee-1",
			name: "Avery Employee",
			email: "avery@example.com",
			image: null,
			teamId: null,
		},
		summary: { title: id, subtitle: "", detail: "", badge: null },
		timing: { createdAt, resolvedAt: null, slaDeadline: null, ageDays: 0 },
		triage: {
			priority,
			riskLevel,
			riskReasons: ["needs_review"],
			fastLaneGroup: null,
			isPayrollRelevant: false,
			explanation: "Needs review.",
		},
		capabilities: {
			canApprove: true,
			canReject: true,
			canBulkApprove: false,
			requiresRejectReason: true,
		},
	};
}

/** The compliance exceptions an organization-wide viewer sees (#1977). */
function complianceRead(items: ApprovalInboxItem[]) {
	return {
		load: vi.fn(async () => Object.assign([...items], { totalCount: items.length })),
		count: vi.fn(async () => items.length),
	};
}

/** A minute apart, oldest first, and recent enough that none is stale at NOW. */
const absenceAt = (index: number) => `2026-06-10T10:${String(index).padStart(2, "0")}:00.000Z`;

/**
 * Current evidence: a staffing shortfall for the listed requests (high risk), every
 * check verified clear for the rest (low risk).
 */
function evidenceLoader(shortfalls: ReadonlySet<string>) {
	return vi.fn(
		async (target: ApprovalInboxTriageTarget): Promise<ApprovalInboxTriageEvidenceResult> => {
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
					shortfalls.has(target.context.requestId)
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
	);
}

type Inbox = Omit<Parameters<typeof getApprovalInboxListFromSources>[0], "params"> & {
	params?: Partial<ApprovalInboxListParams>;
};

async function topFive(inbox: Inbox, shortfalls: ReadonlySet<string>) {
	const loadTriageEvidence = evidenceLoader(shortfalls);
	const viewer = { ...params, ...inbox.params };
	const top = await getApprovalInboxTopItems(viewer, {
		limit: 5,
		now: NOW,
		triagePolicy: DEFAULT_APPROVAL_TRIAGE_POLICY,
		loadTriageEvidence,
		readList: (listParams, overrides) =>
			getApprovalInboxListFromSources({ ...inbox, params: listParams, ...overrides }),
	});
	// Brute force: every pending item, own and covered, read with its current evidence.
	const all = await getApprovalInboxListFromSources({
		...inbox,
		params: { ...viewer, limit: Number.MAX_SAFE_INTEGER },
		now: NOW,
		triagePolicy: DEFAULT_APPROVAL_TRIAGE_POLICY,
		loadTriageEvidence: evidenceLoader(shortfalls),
	});
	const everyItem = [...all.items, ...(all.covering ?? []).flatMap((section) => section.rows)];
	return {
		...top,
		top: top.items.map((item) => item.id),
		bruteForce: everyItem
			.sort(compareInboxItems)
			.slice(0, 5)
			.map((item) => item.id),
		evaluated: loadTriageEvidence.mock.calls.map(([target]) => target.context.requestId).sort(),
	};
}

describe("the inbox's most urgent items with bounded triage evidence (#1978)", () => {
	it("loads no evidence when no absence could outrank the items already known", async () => {
		// Expense claims a week old are stale (high risk) and urgent; recent normal absences
		// can at best be high risk at normal priority.
		const claims = ["c1", "c2", "c3", "c4", "c5"].map((id, index) =>
			approval(id, "travel_expense_claim", `2026-06-0${index + 1}T08:00:00.000Z`, "urgent"),
		);
		const absences = Array.from({ length: 20 }, (_, index) =>
			approval(`a${index}`, "absence_entry", absenceAt(index)),
		);
		const result = await topFive(
			{ sources: [source("travel_expense_claim", claims), source("absence_entry", absences)] },
			new Set(absences.map((item) => item.id)),
		);

		expect(result.top).toEqual(["c1", "c2", "c3", "c4", "c5"]);
		expect(result.top).toEqual(result.bruteForce);
		expect(result.evaluated).toEqual([]);
		expect(result.total).toBe(25);
	});

	it("evaluates only the absences whose best case could still reach the top five", async () => {
		// The oldest six absences have a staffing shortfall; a newer urgent one is clear.
		const absences = Array.from({ length: 20 }, (_, index) =>
			approval(`a${index}`, "absence_entry", absenceAt(index), index === 19 ? "urgent" : "normal"),
		);
		const result = await topFive(
			{ sources: [source("absence_entry", absences)] },
			new Set(["a0", "a1", "a2", "a3", "a4", "a5"]),
		);

		expect(result.top).toEqual(["a0", "a1", "a2", "a3", "a4"]);
		expect(result.top).toEqual(result.bruteForce);
		// The urgent one and the four oldest first; it turns out low, so the next five. Then
		// five high-risk absences lead and no newer normal one can pass them: a9–a18 never load.
		expect(result.evaluated).toEqual(
			["a19", "a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"].sort(),
		);
	});

	it("never waits through more than three rounds of evidence when few items turn out high", async () => {
		// Sixty recent absences, every check clear: none ever reaches high risk, so no five
		// known items ever outrank the next one's best case and every absence needs evidence.
		const absences = Array.from({ length: 60 }, (_, index) =>
			approval(`a${index}`, "absence_entry", absenceAt(index)),
		);
		const sourcesOf = () => ({ sources: [source("absence_entry", absences)] });
		const loader = evidenceLoader(new Set());
		let inFlight = 0;
		let rounds = 0;
		let mostInFlight = 0;
		const countingLoader = async (target: ApprovalInboxTriageTarget) => {
			// A round is a set of loads that run together: one starts while none is in flight.
			if (inFlight === 0) rounds += 1;
			inFlight += 1;
			mostInFlight = Math.max(mostInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 0));
			inFlight -= 1;
			return loader(target);
		};
		const top = await getApprovalInboxTopItems(params, {
			limit: 5,
			now: NOW,
			triagePolicy: DEFAULT_APPROVAL_TRIAGE_POLICY,
			loadTriageEvidence: countingLoader,
			readList: (listParams, overrides) =>
				getApprovalInboxListFromSources({ ...sourcesOf(), params: listParams, ...overrides }),
		});
		const { bruteForce } = await topFive(sourcesOf(), new Set());

		expect(top.items.map((item) => item.id)).toEqual(bruteForce);
		expect(loader).toHaveBeenCalledTimes(60);
		// Two rounds of five, then everything that could still reach the top in one round.
		expect(rounds).toBe(3);
		// That last round reads the remaining fifty at most five at a time, never all at once.
		expect(mostInFlight).toBe(5);
	});

	it("keeps the inbox order when current evidence lowers the oldest and raises newer ones", async () => {
		const absences = Array.from({ length: 12 }, (_, index) =>
			approval(`a${index}`, "absence_entry", absenceAt(index)),
		);
		const result = await topFive(
			{ sources: [source("absence_entry", absences)] },
			new Set(["a9", "a11"]),
		);

		expect(result.top).toEqual(["a9", "a11", "a0", "a1", "a2"]);
		expect(result.top).toEqual(result.bruteForce);
	});

	describe("across legacy sources, canonical reads, compliance exceptions and Covering", () => {
		const covering = [{ approverId: ABSENT, approverName: "Xenia" }];
		const inbox = (): Inbox => ({
			params: { covering, complianceExceptionScope: { kind: "organization" } },
			sources: [
				source("absence_entry", [
					...Array.from({ length: 6 }, (_, index) =>
						approval(`a${index}`, "absence_entry", absenceAt(index)),
					),
					approval("x0", "absence_entry", absenceAt(6), "normal", { approverId: ABSENT }),
					approval("x1", "absence_entry", absenceAt(7), "normal", { approverId: ABSENT }),
				]),
				source("travel_expense_claim", [
					approval("t0", "travel_expense_claim", "2026-06-10T11:00:00.000Z"),
				]),
			],
			canonicalReads: [
				canonicalRead("absence_change_request", "absence_change", [
					{ id: "c0", createdAt: absenceAt(10) },
					{ id: "c1", createdAt: absenceAt(11) },
					{ id: "cx0", createdAt: absenceAt(12), approverId: ABSENT },
				]),
				canonicalRead("period_submission", "period_submission", [
					{ id: "p0", createdAt: "2026-06-10T09:00:00.000Z" },
				]),
			],
			complianceExceptionRead: complianceRead([
				inboxItem("e0", "compliance_exception", "2026-06-09T12:00:00.000Z", "high", "medium"),
			]) as never,
		});

		it("previews the same five as evaluating every item, covered ones tagged", async () => {
			const result = await topFive(inbox(), new Set(["a3", "a5", "x0", "c1", "cx0"]));

			// High risk outranks the high-priority compliance exception; then age.
			expect(result.top).toEqual(["a3", "a5", "x0", "c1", "cx0"]);
			expect(result.top).toEqual(result.bruteForce);
			expect(result.items.map((item) => item.coveringFor?.approverName ?? null)).toEqual([
				null,
				null,
				"Xenia",
				null,
				"Xenia",
			]);
			// Own: six absences, a claim, two absence changes, a period submission and an
			// exception; covered: two absences and an absence change.
			expect(result.counts).toMatchObject({
				absence_entry: 8,
				travel_expense_claim: 1,
				absence_change_request: 3,
				period_submission: 1,
				compliance_exception: 1,
			});
			expect(result.total).toBe(14);
			expect(result.coveringCount).toBe(3);
			expect(result.warnings).toEqual([]);
		});

		it("lets the compliance exception and period submission lead when no evidence is high", async () => {
			const result = await topFive(inbox(), new Set());

			expect(result.top).toEqual(result.bruteForce);
			expect(result.top.slice(0, 2)).toEqual(["e0", "p0"]);
		});
	});

	it("reports a source whose list or count failed instead of silently dropping it", async () => {
		const result = await topFive(
			{
				sources: [
					source("absence_entry", [approval("a0", "absence_entry", absenceAt(0))]),
					source("travel_expense_claim", [approval("t0", "travel_expense_claim", absenceAt(1))], {
						list: true,
					}),
					source("travel_expense_report", [approval("r0", "travel_expense_report", absenceAt(2))], {
						count: true,
					}),
				],
			},
			new Set(),
		);

		expect(
			result.warnings
				.map((warning) => [warning.source, warning.failure])
				.sort(([left], [right]) => String(left).localeCompare(String(right))),
		).toEqual([
			["travel_expense_claim", "list"],
			["travel_expense_report", "count"],
		]);
		expect(result.top).not.toContain("t0");
		// A count failure still lists its rows, only the totals miss them.
		expect(result.top).toContain("r0");
		// The rows in hand per type: a lower bound for the type whose count failed.
		expect(result.listed).toEqual({ absence_entry: 1, travel_expense_report: 1 });
	});

	it("counts covered work as the total does: the rows a Covering section lists (#1978)", async () => {
		const covered = Array.from({ length: 105 }, (_, index) =>
			approval(`x${index}`, "absence_entry", absenceAt(index % 60), "normal", {
				approverId: ABSENT,
			}),
		);
		const result = await topFive(
			{
				params: { covering: [{ approverId: ABSENT, approverName: "Xenia" }] },
				sources: [
					source("absence_entry", [approval("a0", "absence_entry", absenceAt(0)), ...covered]),
				],
			},
			new Set(),
		);

		// The badge, and so the total, counts the 100 rows the section lists, never all 105:
		// the covered share of the total can never exceed the total.
		expect(result.total).toBe(101);
		expect(result.coveringCount).toBe(100);
	});

	it("keeps the Covering rows the inbox keeps, cut to 100 after current evidence (#1978)", async () => {
		// 101 recent covered absences: only the newest has a staffing shortfall (high risk), so
		// the inbox's section keeps it first and cuts the oldest clear one instead.
		const covered = Array.from({ length: 101 }, (_, index) =>
			approval(
				`x${index}`,
				"absence_entry",
				new Date(NOW.getTime() - (101 - index) * 60_000).toISOString(),
				"normal",
				{
					approverId: ABSENT,
				},
			),
		);
		const result = await topFive(
			{
				params: { covering: [{ approverId: ABSENT, approverName: "Xenia" }] },
				sources: [source("absence_entry", covered)],
			},
			new Set(["x100"]),
		);

		expect(result.top[0]).toBe("x100");
		expect(result.top).toEqual(result.bruteForce);
		expect(result.coveringCount).toBe(100);
		expect(result.total).toBe(100);
	});

	it("reads no evidence to cut a large Covering section of one type, only what the preview needs (#1978)", async () => {
		// 150 covered absences, the five oldest with a staffing shortfall (high risk). Whichever
		// 100 the section keeps, it keeps 100 absences: the cut changes no count.
		const covered = Array.from({ length: 150 }, (_, index) =>
			approval(
				`x${index}`,
				"absence_entry",
				new Date(NOW.getTime() - (150 - index) * 60_000).toISOString(),
				"normal",
				{ approverId: ABSENT },
			),
		);
		const result = await topFive(
			{
				params: { covering: [{ approverId: ABSENT, approverName: "Xenia" }] },
				sources: [source("absence_entry", covered)],
			},
			new Set(["x0", "x1", "x2", "x3", "x4"]),
		);

		expect(result.top).toEqual(["x0", "x1", "x2", "x3", "x4"]);
		expect(result.top).toEqual(result.bruteForce);
		expect(result.counts).toMatchObject({ absence_entry: 100 });
		expect(result.total).toBe(100);
		expect(result.coveringCount).toBe(100);
		// The five oldest turn out high, and no newer absence's best case can pass them.
		expect(result.evaluated).toEqual(["x0", "x1", "x2", "x3", "x4"]);
	});

	it("counts the types a mixed Covering section keeps after current evidence (#1978)", async () => {
		// 101 covered rows: 100 absences with a staffing shortfall (high risk), then the newest,
		// an expense report. Evidence decides which type the section's cut drops: the report.
		const absences = Array.from({ length: 100 }, (_, index) =>
			approval(
				`x${index}`,
				"absence_entry",
				new Date(NOW.getTime() - (200 - index) * 60_000).toISOString(),
				"normal",
				{ approverId: ABSENT },
			),
		);
		const report = approval("r0", "travel_expense_report", NOW.toISOString(), "normal", {
			approverId: ABSENT,
		});
		const result = await topFive(
			{
				params: { covering: [{ approverId: ABSENT, approverName: "Xenia" }] },
				sources: [source("absence_entry", absences), source("travel_expense_report", [report])],
			},
			new Set(absences.map((item) => item.id)),
		);

		expect(result.top).toEqual(result.bruteForce);
		expect(result.counts).toMatchObject({ absence_entry: 100, travel_expense_report: 0 });
		expect(result.coveringCount).toBe(100);
	});

	it("counts and previews the viewer's own pending request as the badge does, marked as theirs", async () => {
		// An org-wide viewer sees every assignment, their own request included (read-only).
		const own = approval("own", "absence_entry", "2026-06-01T08:00:00.000Z", "normal", {
			approverId: "manager-2",
			requesterId: VIEWER,
		});
		const result = await topFive(
			{
				params: { includeAllApprovers: true },
				sources: [source("absence_entry", [own, approval("other", "absence_entry", absenceAt(0))])],
			},
			new Set(),
		);

		expect(result.total).toBe(2);
		expect(result.top).toEqual(["own", "other"]);
		expect(result.items[0]?.capabilities).toMatchObject({ ownRequest: true, canApprove: false });
	});
});
