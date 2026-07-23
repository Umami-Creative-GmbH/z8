import { describe, expect, it } from "vitest";
import {
	loadOrdinaryCanonicalApprovals,
	type OrdinaryCanonicalReadRow,
	selectOrdinaryCanonicalApprovals,
} from "./ordinary-canonical-read";

const ids = {
	organization: "org-1",
	workflow: "10000000-0000-4000-8000-000000000001",
	stage: "20000000-0000-4000-8000-000000000001",
	assignment: "30000000-0000-4000-8000-000000000001",
	projection: "40000000-0000-4000-8000-000000000001",
	period: "50000000-0000-4000-8000-000000000001",
	record: "60000000-0000-4000-8000-000000000001",
	requester: "70000000-0000-4000-8000-000000000001",
	approver: "80000000-0000-4000-8000-000000000001",
	compatibility: "90000000-0000-4000-8000-000000000001",
};

function row(
	overrides: Partial<OrdinaryCanonicalReadRow> = {},
): OrdinaryCanonicalReadRow {
	return {
		projection: {
			id: ids.projection,
			organizationId: ids.organization,
			workflowId: ids.workflow,
			activeStageId: ids.stage,
			sourceType: "time_entry",
			sourceId: ids.period,
			status: "pending",
			displayPayload: {
				kind: "manual_time_submission",
				title: "Manual time submission",
				startTime: "2026-07-20T06:00:00Z",
				endTime: "2026-07-20T14:00:00Z",
				durationMinutes: 480,
				approvalStatus: "pending",
				stage: { name: "Manager review", order: 2 },
			},
			searchText:
				"manual time submission 2026-07-20t06:00:00z 2026-07-20t14:00:00z manager review",
			createdAt: new Date("2026-07-20T14:05:00Z"),
		},
		workflow: {
			id: ids.workflow,
			organizationId: ids.organization,
			workflowType: "manual_time_submission",
			sourceType: "time_entry",
			sourceId: ids.period,
			requesterEmployeeId: ids.requester,
			status: "pending",
			currentStageOrder: 2,
			contextSnapshot: { timeRequest: { kind: "manual_time_submission" } },
			submittedAt: new Date("2026-07-20T14:05:00Z"),
		},
		stage: {
			id: ids.stage,
			organizationId: ids.organization,
			workflowId: ids.workflow,
			sequence: 2,
			label: "Manager review",
			status: "pending",
			legacyApprovalRequestId: null,
		},
		assignment: {
			id: ids.assignment,
			organizationId: ids.organization,
			workflowId: ids.workflow,
			stageId: ids.stage,
			approverEmployeeId: ids.approver,
			status: "pending",
			assignedAt: new Date("2026-07-20T14:05:00Z"),
		},
		requester: {
			id: ids.requester,
			organizationId: ids.organization,
			userId: "user-requester",
			teamId: "team-1",
			user: {
				id: "user-requester",
				name: "Avery Employee",
				email: "avery@example.com",
				image: null,
			},
		},
		period: {
			id: ids.period,
			organizationId: ids.organization,
			employeeId: ids.requester,
			canonicalRecordId: ids.record,
			approvalWorkflowId: ids.workflow,
			approvalStatus: "pending",
			isActive: false,
			deletedAt: null,
			startTime: new Date("2026-07-20T06:00:00Z"),
			endTime: new Date("2026-07-20T14:00:00Z"),
			durationMinutes: 480,
			pendingChanges: { isManualEntry: true, privateNote: "do not expose" },
			employee: {
				id: ids.requester,
				organizationId: ids.organization,
				userId: "user-requester",
				user: {
					id: "user-requester",
					name: "Avery Employee",
					email: "avery@example.com",
					image: null,
				},
			},
			clockIn: {
				id: "a0000000-0000-4000-8000-000000000001",
				organizationId: ids.organization,
				employeeId: ids.requester,
				type: "clock_in",
				timestamp: new Date("2026-07-20T06:00:00Z"),
				utcOffsetMinutes: 120,
				isSuperseded: false,
				supersededById: null,
				replacesEntryId: null,
			},
			clockOut: {
				id: "a0000000-0000-4000-8000-000000000002",
				organizationId: ids.organization,
				employeeId: ids.requester,
				type: "clock_out",
				timestamp: new Date("2026-07-20T14:00:00Z"),
				utcOffsetMinutes: 120,
				isSuperseded: false,
				supersededById: null,
				replacesEntryId: null,
			},
		},
		canonicalRecord: {
			id: ids.record,
			organizationId: ids.organization,
			employeeId: ids.requester,
			recordKind: "work",
			startAt: new Date("2026-07-20T06:00:00Z"),
			endAt: new Date("2026-07-20T14:00:00Z"),
			durationMinutes: 480,
			approvalState: "pending",
		},
		compatibilityRequest: null,
		...overrides,
	};
}

function select(rows: OrdinaryCanonicalReadRow[], overrides = {}) {
	return selectOrdinaryCanonicalApprovals({
		rows,
		organizationId: ids.organization,
		approverId: ids.approver,
		...overrides,
	});
}

describe("ordinary canonical inbox reads", () => {
	it("composes production projection relations into one row per active assignment", async () => {
		const fixture = row();
		const database = {
			query: {
				approvalInboxProjection: {
					findMany: async () => [
						{
							...fixture.projection,
							workflow: { ...fixture.workflow, requester: fixture.requester },
							activeStage: {
								...fixture.stage,
								assignments: [fixture.assignment],
							},
						},
					],
				},
				workPeriod: { findFirst: async () => fixture.period },
				timeRecord: { findFirst: async () => fixture.canonicalRecord },
				approvalRequest: { findFirst: async () => null },
			},
		};

		const approvals = await loadOrdinaryCanonicalApprovals({
			database,
			organizationId: ids.organization,
			approverId: ids.approver,
		});

		expect(approvals.map((approval) => approval.item.id)).toEqual([
			ids.assignment,
		]);
	});

	it("uses the active assignment as the stable public target", () => {
		const [approval] = select([row()]);

		expect(approval?.item).toMatchObject({
			id: ids.assignment,
			type: "time_entry",
			entityId: ids.assignment,
			status: "pending",
			requester: { id: ids.requester, name: "Avery Employee" },
			summary: {
				title: "Manual Time Submission",
				detail: "8h on Jul 20, 2026",
				stage: { name: "Manager review", order: 2 },
			},
		});
		expect(approval?.decisionTarget).toEqual({
			id: ids.assignment,
			targetType: "canonical_assignment",
			entityType: "time_entry",
			entityId: ids.period,
			organizationId: ids.organization,
			approverId: ids.approver,
			requesterEmployeeId: ids.requester,
			status: "pending",
			workflowKind: "manual_time_submission",
		});
	});

	it("allows only assigned, organization-wide, or exact eligible-scope visibility", () => {
		expect(select([row()], { approverId: "other" })).toEqual([]);
		expect(
			select([row()], {
				approverId: "eligible-manager",
				eligibleApprovalScopes: [
					{
						requesterEmployeeId: ids.requester,
						eligibleApproverIds: [ids.approver, "eligible-manager"],
					},
				],
			}),
		).toHaveLength(1);
		expect(
			select([row()], {
				approverId: "eligible-manager",
				eligibleApprovalScopes: [
					{
						requesterEmployeeId: "other-requester",
						eligibleApproverIds: [ids.approver, "eligible-manager"],
					},
				],
			}),
		).toEqual([]);
		expect(
			select([row()], { approverId: "admin", includeAllApprovers: true }),
		).toHaveLength(1);
	});

	it("suppresses fallback only for exact active-stage compatibility ownership", () => {
		const compatibilityRequest = {
			id: ids.compatibility,
			organizationId: ids.organization,
			entityType: "time_entry",
			entityId: ids.period,
			requestedBy: ids.requester,
			approverId: ids.approver,
			status: "pending",
			metadata: {
				workflow: { id: ids.workflow, organizationId: ids.organization },
				stage: { id: ids.stage, sequence: 2 },
				timeRequest: { kind: "manual_time_submission" },
			},
		};
		expect(
			select([
				row({
					stage: { ...row().stage, legacyApprovalRequestId: ids.compatibility },
					compatibilityRequest,
				}),
			]),
		).toEqual([]);
		expect(
			select([
				row({
					stage: { ...row().stage, legacyApprovalRequestId: ids.compatibility },
					compatibilityRequest: {
						...compatibilityRequest,
						metadata: {
							...compatibilityRequest.metadata,
							stage: { id: "moved-stage", sequence: 2 },
						},
					},
				}),
			]),
		).toHaveLength(1);
	});

	it.each([
		[
			"foreign projection",
			() =>
				row({ projection: { ...row().projection, organizationId: "foreign" } }),
		],
		[
			"waiting stage",
			() => row({ stage: { ...row().stage, status: "waiting" } }),
		],
		[
			"terminal workflow",
			() => row({ workflow: { ...row().workflow, status: "approved" } }),
		],
		[
			"moved source",
			() => row({ period: { ...row().period, approvalWorkflowId: "moved" } }),
		],
		[
			"projection parity",
			() =>
				row({ projection: { ...row().projection, activeStageId: "moved" } }),
		],
		[
			"assignment parity",
			() => row({ assignment: { ...row().assignment, stageId: "moved" } }),
		],
		[
			"wrong kind",
			() =>
				row({
					workflow: { ...row().workflow, workflowType: "time_correction" },
				}),
		],
		[
			"malformed context",
			() =>
				row({
					workflow: {
						...row().workflow,
						contextSnapshot: {
							timeRequest: { kind: "manual_time_submission", private: true },
						},
					},
				}),
		],
		[
			"requester mismatch",
			() => row({ requester: { ...row().requester, id: "other" } }),
		],
		[
			"canonical parity",
			() =>
				row({
					canonicalRecord: { ...row().canonicalRecord, durationMinutes: 479 },
				}),
		],
	] as const)("fails closed for %s", (_name, makeRow) => {
		expect(select([makeRow()])).toEqual([]);
	});

	it("returns only allowlisted display and timeline data", () => {
		const [approval] = select([row()]);
		const payload = JSON.stringify({
			item: approval?.item,
			detail: approval?.detail,
		});

		expect(payload).not.toContain("privateNote");
		expect(payload).not.toContain("do not expose");
		expect(payload).not.toContain(ids.workflow);
		expect(payload).not.toContain(ids.projection);
		expect(payload).not.toContain(ids.period);
		expect(payload).not.toContain(ids.record);
		expect(approval?.detail.sections).toEqual([
			{
				type: "key_value",
				title: "Request",
				rows: [
					{ label: "Type", value: "Manual Time Submission" },
					{ label: "Range", value: "Jul 20, 2026 - 08:00 to 16:00" },
					{ label: "Duration", value: "8h" },
					{ label: "Status", value: "pending" },
					{ label: "Stage", value: "Manager review (2)" },
				],
			},
			{
				type: "timeline",
				title: "Timeline",
				events: [
					{
						id: "timeline-created-1",
						label: "Avery Employee requested manual time submission",
						at: "2026-07-20T14:05:00.000Z",
						actorName: "Avery Employee",
					},
				],
			},
		]);
	});

	it("does not search private context, source evidence, or internal identifiers", () => {
		expect(select([row()], { search: "do not expose" })).toEqual([]);
		expect(select([row()], { search: ids.workflow })).toEqual([]);
		expect(select([row()], { search: "avery" })).toHaveLength(1);
		expect(select([row()], { search: "manager review" })).toHaveLength(1);
	});
});
