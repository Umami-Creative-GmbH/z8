import { expect, it } from "vitest";
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
