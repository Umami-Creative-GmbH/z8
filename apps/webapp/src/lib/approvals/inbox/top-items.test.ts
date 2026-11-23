import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { UnifiedApprovalItem } from "@/lib/approvals/domain/types";
import { DEFAULT_APPROVAL_TRIAGE_POLICY } from "../triage-policy-config";
import {
	type ApprovalInboxListParams,
	getApprovalInboxListFromSources,
	itemsWithCoveringSections,
} from "./read-service";
import type { ApprovalInboxSource } from "./source-adapters";
import { getApprovalInboxTopItems } from "./top-items";
import type {
	ApprovalInboxTriageEvidenceResult,
	ApprovalInboxTriageTarget,
} from "./triage-evidence";

const NOW = new Date("2026-06-10T12:00:00.000Z");
const params: ApprovalInboxListParams = {
	approverId: "manager-1",
	organizationId: "org-1",
	status: "pending",
};

function approval(
	id: string,
	approvalType: UnifiedApprovalItem["approvalType"],
	createdAt: string,
	priority: UnifiedApprovalItem["priority"] = "normal",
): UnifiedApprovalItem {
	return {
		id,
		approvalType,
		entityId: `entity-${id}`,
		typeName: approvalType,
		requester: {
			id: "employee-1",
			userId: "user-1",
			name: "Avery Employee",
			email: "avery@example.com",
			image: null,
			teamId: null,
		},
		approverId: "manager-1",
		organizationId: "org-1",
		status: "pending",
		createdAt: new Date(createdAt),
		resolvedAt: null,
		priority,
		sla: { deadline: null, status: "on_time", hoursRemaining: null },
		display: { title: id, subtitle: "", summary: "" },
	};
}

function source(type: ApprovalInboxSource["type"], items: UnifiedApprovalItem[]) {
	return {
		type,
		displayName: type,
		supportsBulkApprove: true,
		handler: {
			type,
			displayName: type,
			supportsBulkApprove: true,
			getApprovals: vi.fn(() => Effect.succeed(items)),
			getCount: vi.fn(() => Effect.succeed(items.length)),
		} as never,
	} satisfies ApprovalInboxSource;
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

async function topFive(sources: ApprovalInboxSource[], shortfalls: ReadonlySet<string>) {
	const loadTriageEvidence = evidenceLoader(shortfalls);
	const { total, items } = await getApprovalInboxTopItems(params, {
		limit: 5,
		now: NOW,
		triagePolicy: DEFAULT_APPROVAL_TRIAGE_POLICY,
		loadTriageEvidence,
		readList: (listParams, overrides) =>
			getApprovalInboxListFromSources({ sources, params: listParams, ...overrides }),
	});
	// The inbox's own first page, every candidate evaluated: the order to match.
	const inbox = await getApprovalInboxListFromSources({
		sources,
		params: { ...params, limit: 5 },
		now: NOW,
		triagePolicy: DEFAULT_APPROVAL_TRIAGE_POLICY,
		loadTriageEvidence: evidenceLoader(shortfalls),
	});
	return {
		total,
		top: items.map((item) => item.id),
		inbox: itemsWithCoveringSections(inbox)
			.slice(0, 5)
			.map((item) => item.id),
		evaluated: loadTriageEvidence.mock.calls.map(([target]) => target.context.requestId),
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
			[source("travel_expense_claim", claims), source("absence_entry", absences)],
			new Set(absences.map((item) => item.id)),
		);

		expect(result.top).toEqual(["c1", "c2", "c3", "c4", "c5"]);
		expect(result.top).toEqual(result.inbox);
		expect(result.evaluated).toEqual([]);
		expect(result.total).toBe(25);
	});

	it("evaluates only the absences whose best case could still reach the top five, in inbox order", async () => {
		// The oldest six absences have a staffing shortfall; a newer urgent one is clear.
		const absences = Array.from({ length: 20 }, (_, index) =>
			approval(`a${index}`, "absence_entry", absenceAt(index), index === 19 ? "urgent" : "normal"),
		);
		const result = await topFive(
			[source("absence_entry", absences)],
			new Set(["a0", "a1", "a2", "a3", "a4", "a5"]),
		);

		expect(result.top).toEqual(["a0", "a1", "a2", "a3", "a4"]);
		expect(result.top).toEqual(result.inbox);
		// The urgent one is checked first; once five high-risk absences lead, no newer
		// normal one can pass them.
		expect(result.evaluated).toContain("a19");
		expect(result.evaluated.length).toBeLessThanOrEqual(10);
		expect(result.evaluated).not.toContain("a18");
	});

	it("keeps the inbox order when current evidence lowers the oldest and raises newer ones", async () => {
		const absences = Array.from({ length: 12 }, (_, index) =>
			approval(`a${index}`, "absence_entry", absenceAt(index)),
		);
		const result = await topFive([source("absence_entry", absences)], new Set(["a9", "a11"]));

		expect(result.top).toEqual(["a9", "a11", "a0", "a1", "a2"]);
		expect(result.top).toEqual(result.inbox);
	});
});
