import { describe, expect, it } from "vitest";
import type { UnifiedApprovalItem } from "./domain/types";
import { buildApprovalTriage, groupApprovalFastLanes, sortSprintApprovals } from "./triage";

function item(overrides: Partial<UnifiedApprovalItem>): UnifiedApprovalItem {
	return {
		id: "approval-1",
		approvalType: "absence_entry",
		entityId: "entity-1",
		typeName: "Absence",
		requester: {
			id: "employee-1",
			userId: "user-1",
			name: "Ada Lovelace",
			email: "ada@example.com",
			image: null,
			teamId: null,
		},
		approverId: "employee-manager",
		organizationId: "org-1",
		status: "pending",
		createdAt: new Date("2026-05-20T08:00:00.000Z"),
		resolvedAt: null,
		priority: "normal",
		sla: { deadline: null, status: "on_time", hoursRemaining: null },
		display: {
			title: "Vacation",
			subtitle: "May 27, 2026",
			summary: "Vacation request",
		},
		...overrides,
	};
}

function serializedCreatedAtItem(
	overrides: Partial<UnifiedApprovalItem> & { createdAt: string },
): UnifiedApprovalItem {
	return item(overrides as Partial<UnifiedApprovalItem>);
}

describe("approval triage", () => {
	it("defaults uncertain approvals to medium risk without a fast lane", () => {
		const triage = buildApprovalTriage(item({ approvalType: "shift_request", typeName: "Shift" }), {
			now: new Date("2026-05-21T08:00:00.000Z"),
		});

		expect(triage.riskLevel).toBe("medium");
		expect(triage.riskReasons).toEqual(["needs_review"]);
		expect(triage.fastLaneGroup).toBeNull();
		expect(triage.ageDays).toBe(1);
	});

	it("keeps absences with missing evidence out of low-risk lanes", () => {
		const triage = buildApprovalTriage(item({ approvalType: "absence_entry" }), {
			now: new Date("2026-05-21T08:00:00.000Z"),
		});

		expect(triage.riskLevel).toBe("medium");
		expect(triage.riskReasons).toEqual(["payroll_unverified", "coverage_unverified"]);
		expect(triage.fastLaneGroup).toBeNull();
	});

	it("does not mark high-risk absence policy exceptions as low-risk fast-lane items", () => {
		const triage = buildApprovalTriage(
			item({
				approvalType: "absence_entry",
				triage: { riskReasons: ["policy_exception"], riskLevel: "high" },
			}),
			{ now: new Date("2026-05-21T08:00:00.000Z") },
		);

		expect(triage.riskLevel).toBe("high");
		expect(triage.riskReasons).toEqual(["policy_exception", "payroll_unverified", "coverage_unverified"]);
		expect(triage.fastLaneGroup).toBeNull();
	});

	it("does not certify small corrections using a minute delta alone", () => {
		const triage = buildApprovalTriage(
			item({
				approvalType: "time_entry",
				display: {
					title: "Time correction",
					subtitle: "12 minute correction",
					summary: "Changed checkout by 12 minutes",
				},
				triage: { timeDeltaMinutes: 12 },
			}),
			{ now: new Date("2026-05-21T08:00:00.000Z") },
		);

		expect(triage.riskLevel).toBe("medium");
		expect(triage.fastLaneGroup).toBeNull();
		expect(triage.riskReasons).not.toContain("small_time_delta");
	});

	it("does not mark non-time-entry approvals as small time corrections", () => {
		const triage = buildApprovalTriage(
			item({
				approvalType: "shift_request",
				typeName: "Shift",
				triage: { timeDeltaMinutes: 12 },
			}),
			{ now: new Date("2026-05-21T08:00:00.000Z") },
		);

		expect(triage.riskLevel).toBe("medium");
		expect(triage.fastLaneGroup).toBeNull();
		expect(triage.riskReasons).toEqual(["needs_review"]);
	});

	it("marks stale pending approvals as high-risk stale fast-lane items", () => {
		const triage = buildApprovalTriage(item({}), {
			now: new Date("2026-05-25T08:00:00.000Z"),
			staleAfterDays: 3,
		});

		expect(triage.riskLevel).toBe("high");
		expect(triage.riskReasons).toContain("stale_pending");
		expect(triage.fastLaneGroup).toBe("stale_pending");
	});

	it("computes age days from API-serialized createdAt values", () => {
		const triage = buildApprovalTriage(
			serializedCreatedAtItem({
				createdAt: "2026-05-20T08:00:00.000Z",
			}),
			{ now: new Date("2026-05-23T09:00:00.000Z") },
		);

		expect(triage.ageDays).toBe(3);
	});

	it("requires exact evidence before treating relevance as a payroll blocker", () => {
		const triage = buildApprovalTriage(item({ triage: { isPayrollRelevant: true } }), {
			now: new Date("2026-05-21T08:00:00.000Z"),
		});

		expect(triage.riskLevel).toBe("medium");
		expect(triage.fastLaneGroup).toBeNull();
		expect(triage.isPayrollRelevant).toBe(true);
	});

	it("excludes unverifiable evidence from low-risk groups", () => {
		const groups = groupApprovalFastLanes(
			[
				item({ id: "absence-1", approvalType: "absence_entry" }),
				item({ id: "shift-1", approvalType: "shift_request", typeName: "Shift" }),
			],
			{ now: new Date("2026-05-21T08:00:00.000Z") },
		);

		expect(groups).toHaveLength(0);
		
		
	});

	it("does not elevate payroll relevance without verified blocker evidence", () => {
		const sorted = sortSprintApprovals(
			[
				item({ id: "new-low", createdAt: new Date("2026-05-24T08:00:00.000Z") }),
				item({
					id: "payroll",
					createdAt: new Date("2026-05-24T08:00:00.000Z"),
					triage: { isPayrollRelevant: true },
				}),
				item({ id: "old-low", createdAt: new Date("2026-05-20T08:00:00.000Z") }),
			],
			{ now: new Date("2026-05-25T08:00:00.000Z"), staleAfterDays: 99 },
		);

		expect(sorted.map((approval) => approval.id)).toEqual(["old-low", "new-low", "payroll"]);
	});

	it("sorts API-serialized createdAt values oldest first without throwing", () => {
		const sorted = sortSprintApprovals(
			[
				serializedCreatedAtItem({
					id: "new-low",
					createdAt: "2026-05-24T08:00:00.000Z",
				}),
				serializedCreatedAtItem({
					id: "old-low",
					createdAt: "2026-05-20T08:00:00.000Z",
				}),
			],
			{ now: new Date("2026-05-25T08:00:00.000Z"), staleAfterDays: 99 },
		);

		expect(sorted.map((approval) => approval.id)).toEqual(["old-low", "new-low"]);
	});
});
it("uses the same conservative evidence policy in retained alternate consumers", () => {
 const result = buildApprovalTriage(item({ triage: { requestKind: "time_correction", timeDeltaMinutes: 1, riskLevel: "high", riskReasons: ["policy_exception"] } }), { now: new Date("2026-05-21T08:00:00Z") });
 expect(result.riskLevel).toBe("high");
 expect(result.riskReasons).toEqual(["policy_exception", "payroll_unverified", "correction_unverified"]);
});
it("orders equal-risk sprint items by priority, oldest submission and stable identity", () => {
 const approvals = [item({ id: "new", priority: "urgent", createdAt: new Date("2026-05-21T07:00:00Z") }), item({ id: "z", priority: "normal" }), item({ id: "a", priority: "normal" }), item({ id: "old", priority: "low", createdAt: new Date("2026-05-19T08:00:00Z") })];
 expect(sortSprintApprovals(approvals, { now: new Date("2026-05-21T08:00:00Z") }).map(row => row.id)).toEqual(["new", "a", "z", "old"]);
});

