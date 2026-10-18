import { beforeEach, expect, it, vi } from "vitest";

const { reviewHeld } = vi.hoisted(() => ({ reviewHeld: { value: false } }));
vi.mock("../presentation/absence-review", async (importOriginal) => ({
	...(await importOriginal<typeof import("../presentation/absence-review")>()),
	prepareAbsenceReviewEvidence: async () => ({
		status: "not_captured",
		held: reviewHeld.value,
	}),
}));
vi.mock("../presentation/time-review", async (importOriginal) => ({
	...(await importOriginal<typeof import("../presentation/time-review")>()),
	prepareTimeReviewEvidence: async () => ({
		status: "not_captured",
		held: reviewHeld.value,
	}),
}));
beforeEach(() => {
	reviewHeld.value = false;
});

import { absenceInboxRead, timeCorrectionInboxRead } from "./v1-canonical-read";

const row = {
	organizationId: "org-1",
	assignmentId: "assignment-1",
	sourceId: "absence-1",
	workflowId: "workflow-1",
	workflowType: "absence",
	requesterId: "employee-1",
	approverId: "manager-1",
	submittedAt: new Date("2026-10-18T08:00:00Z"),
	stageLabel: "Manager",
	stageOrder: 1,
	userName: "Ada",
	userEmail: "ada@example.com",
	userImage: null,
	teamId: null,
	categoryName: "Vacation",
	source: {
		id: "absence-1",
		organization_id: "org-1",
		approval_workflow_id: "workflow-1",
		employee_id: "employee-1",
		start_date: "2026-10-20",
		end_date: "2026-10-21",
	},
};

it("lists a true canonical absence assignment with explicit evidence limitations", async () => {
	const result = await absenceInboxRead.load({
		organizationId: "org-1",
		approverId: "manager-1",
		now: new Date("2026-10-18T09:00:00Z"),
		database: { execute: async () => ({ rows: [row] }) },
	});
	expect(result[0]).toMatchObject({
		item: {
			id: "assignment-1",
			type: "absence_entry",
			triage: {
				requestKind: "absence",
				riskLevel: "medium",
				fastLaneGroup: null,
			},
		},
		decisionTarget: {
			targetType: "canonical_assignment",
			workflowKind: "absence",
			organizationId: "org-1",
		},
	});
});

it("lists canonical corrections while their effective work remains approved", async () => {
	const correction = {
		...row,
		sourceId: "period-1",
		workflowType: "time_correction",
		source: {
			...row.source,
			id: "period-1",
			approval_status: "approved",
			pending_changes: null,
		},
		correction: { action: "delete" },
		originalStart: new Date("2026-10-18T07:00:00Z"),
		originalEnd: new Date("2026-10-18T15:00:00Z"),
		startOffset: 120,
		endOffset: 120,
	};
	const result = await timeCorrectionInboxRead.load({
		organizationId: "org-1",
		approverId: "manager-1",
		now: new Date("2026-10-18T09:00:00Z"),
		database: { execute: async () => ({ rows: [correction] }) },
	});
	expect(result[0]).toMatchObject({
		item: { type: "time_entry", triage: { requestKind: "time_correction" } },
		detail: {
			sections: expect.arrayContaining([
				expect.objectContaining({
					type: "time_comparison",
					action: "delete",
					requested: { start: null, end: null },
				}),
			]),
		},
		decisionTarget: { workflowKind: "time_correction" },
	});
});

it("renders captured partial-day wall clocks without interpreting lossy AM markers as full days", async () => {
	const partial = {
		...row,
		source: { ...row.source, start_period: "am", end_period: "am" },
		submittedFacts: {
			kind: "absence",
			organizationId: "org-1",
			absenceId: "absence-1",
			coverage: {
				kind: "explicit_partial",
				startDate: "2026-10-20",
				startTime: "09:00",
				endDate: "2026-10-20",
				endTime: "11:00",
				wallClockZone: "not_captured",
			},
		},
	};
	const result = await absenceInboxRead.load({
		organizationId: "org-1",
		approverId: "manager-1",
		database: { execute: async () => ({ rows: [partial] }) },
	});
	expect(result[0]?.detail.sections).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				type: "key_value",
				rows: expect.arrayContaining([
					expect.objectContaining({
						value: expect.objectContaining({
							params: expect.objectContaining({
								startTime: "09:00",
								endTime: "11:00",
							}),
						}),
					}),
				]),
			}),
		]),
	);
	expect(JSON.stringify(result[0]?.detail.sections)).not.toContain(
		'"fallback":"Morning"',
	);
});

it.each(["absence", "time_correction"] as const)(
	"retains an existing capture hold on canonical %s list and detail capabilities",
	async (kind) => {
		reviewHeld.value = true;
		const read =
			kind === "absence" ? absenceInboxRead : timeCorrectionInboxRead;
		const current =
			kind === "absence"
				? row
				: { ...row, workflowType: kind, correction: { action: "delete" } };
		const [approval] = await read.load({
			organizationId: "org-1",
			approverId: "manager-1",
			database: { execute: async () => ({ rows: [current] }) },
		});
		expect(approval?.item.capabilities).toMatchObject({
			canApprove: false,
			canReject: false,
			canBulkApprove: false,
		});
		expect(approval?.detail.actions).toMatchObject({
			canApprove: false,
			canReject: false,
			canBulkApprove: false,
		});
		expect(approval?.detail.sections).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: "callout" })]),
		);
	},
);
it("marks the requester's canonical projection as their own request", async () => {
	const [approval] = await absenceInboxRead.load({
		organizationId: "org-1",
		approverId: "employee-1",
		includeAllApprovers: true,
		database: { execute: async () => ({ rows: [row] }) },
	});
	expect(approval?.item.capabilities).toMatchObject({
		ownRequest: true,
		canApprove: false,
		canReject: false,
		canBulkApprove: false,
	});
});
