import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { UnifiedApprovalItem } from "@/lib/approvals/domain/types";
import type {
	CanonicalInboxApproval,
	CanonicalInboxRead,
} from "@/lib/approvals/inbox/canonical-inbox-read";
import { CANONICAL_INBOX_READS } from "@/lib/approvals/inbox/canonical-inbox-reads";
import {
	countOrdinaryCanonicalApprovals,
	loadOrdinaryCanonicalApprovals,
} from "@/lib/approvals/inbox/ordinary-canonical-read";
import {
	getApprovalInboxDetail,
	getApprovalInboxListFromSources,
} from "@/lib/approvals/inbox/read-service";
import type { ApprovalInboxSource } from "@/lib/approvals/inbox/source-adapters";
import type { ApprovalInboxType } from "@/lib/approvals/inbox/types";

/**
 * Another module's canonical kind, listed under an inbox type that has no
 * legacy source: its items come only from its own canonical read.
 */
const OTHER_TYPE: ApprovalInboxType = "travel_expense_claim";

function approval(id: string, type: ApprovalInboxType, createdAt: string): CanonicalInboxApproval {
	const item = {
		id,
		type,
		entityId: id,
		status: "pending",
		requester: {
			id: "employee-1",
			name: "Avery",
			email: "a@example.com",
			image: null,
			teamId: null,
		},
		summary: { title: "Period", subtitle: "Week 41", detail: "40h", badge: null },
		timing: { createdAt, resolvedAt: null, slaDeadline: null, ageDays: 0 },
		triage: {
			priority: "normal",
			riskLevel: "medium",
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
	} as const;
	return {
		item,
		detail: { item, sections: [], actions: item.capabilities },
		decisionTarget: {
			id,
			targetType: "canonical_assignment",
			entityType: type,
			entityId: `source-${id}`,
			organizationId: "org-1",
			approverId: "manager-1",
			requesterEmployeeId: "employee-1",
			status: "pending",
			workflowKind: "compliance_exception",
		},
	};
}

function otherRead(approvals: CanonicalInboxApproval[], total = approvals.length) {
	return {
		type: OTHER_TYPE,
		workflowTypes: ["compliance_exception"],
		load: vi.fn(async (input: { assignmentId?: string }) =>
			Object.assign(
				approvals.filter(
					(candidate) => !input.assignmentId || candidate.item.id === input.assignmentId,
				),
				{ totalCount: total },
			),
		),
		count: vi.fn(async () => total),
	} satisfies CanonicalInboxRead;
}

function legacySource(type: ApprovalInboxSource["type"], items: UnifiedApprovalItem[]) {
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

const params = { approverId: "manager-1", organizationId: "org-1", status: "pending" } as const;

describe("canonical inbox reads", () => {
	it("registers the ordinary work-period read under time entries", () => {
		expect(CANONICAL_INBOX_READS).toContainEqual({
			type: "time_entry",
			workflowTypes: ["manual_time_submission", "policy_clock_out"],
			load: loadOrdinaryCanonicalApprovals,
			count: countOrdinaryCanonicalApprovals,
		});
	});

	it("lists and counts another kind's canonical approvals with no legacy source behind them", async () => {
		const read = otherRead([approval("assignment-9", OTHER_TYPE, "2026-10-01T09:00:00.000Z")], 4);

		const result = await getApprovalInboxListFromSources({
			sources: [legacySource("time_entry", [])],
			params,
			canonicalReads: [read],
		});

		expect(result.items.map(({ id, type }) => [id, type])).toEqual([["assignment-9", OTHER_TYPE]]);
		expect(result.counts[OTHER_TYPE]).toBe(4);
		expect(result.counts.time_entry).toBe(0);
		expect(result.total).toBe(4);
		expect(result.supportedTypes).toEqual(["time_entry", OTHER_TYPE]);
		expect(read.load).toHaveBeenCalledWith(
			expect.objectContaining({ approverId: "manager-1", organizationId: "org-1", limit: 51 }),
		);
	});

	it("leaves a kind's approvals out of the list when its type is filtered out, but counts them", async () => {
		const read = otherRead([approval("assignment-9", OTHER_TYPE, "2026-10-01T09:00:00.000Z")]);

		const result = await getApprovalInboxListFromSources({
			sources: [legacySource("time_entry", [])],
			params: { ...params, types: ["time_entry"] },
			canonicalReads: [read],
		});

		expect(read.load).not.toHaveBeenCalled();
		expect(result.items).toEqual([]);
		expect(result.counts[OTHER_TYPE]).toBe(1);
	});

	it("resolves another kind's canonical detail by assignment id", async () => {
		const other = approval("assignment-9", OTHER_TYPE, "2026-10-01T09:00:00.000Z");
		const read = otherRead([other]);
		const ordinary = vi.fn(async () => []);

		await expect(
			getApprovalInboxDetail({
				approvalId: "assignment-9",
				organizationId: "org-1",
				approverId: "manager-1",
				database: { query: { approvalRequest: { findFirst: async () => null } } } as never,
				loadCanonicalOrdinaryApprovals: ordinary,
				canonicalReads: [read],
			}),
		).resolves.toBe(other.detail);
		expect(ordinary).toHaveBeenCalledTimes(1);
		expect(read.load).toHaveBeenCalledWith(
			expect.objectContaining({ assignmentId: "assignment-9", limit: 1 }),
		);
	});
});
