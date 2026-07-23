import { describe, expect, it, vi } from "vitest";
import { createOrdinaryWorkPeriodApprovalAdapter } from "@/lib/approvals/domain-adapters/work-period.adapter";
import type { OrdinaryWorkPeriodApprovalKind } from "@/lib/approvals/domain-adapters/work-period-contract";
import { TimeCorrectionHandler } from "@/lib/approvals/handlers/time-correction.handler";
import {
	getApprovalInboxDetailFromRequest,
	getApprovalInboxListFromSources,
} from "@/lib/approvals/inbox/read-service";
import type { ApprovalInboxSource } from "@/lib/approvals/inbox/source-adapters";
import { parseInstant } from "@/lib/datetime/temporal-core";

const dbMocks = vi.hoisted(() => ({
	approvalRequests: vi.fn(),
	chainStages: vi.fn(),
	chainStage: vi.fn(),
	workPeriods: vi.fn(),
	workPeriod: vi.fn(),
	timeEntries: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			approvalRequest: {
				findMany: dbMocks.approvalRequests,
				findFirst: dbMocks.approvalRequests,
			},
			approvalChainStageInstance: {
				findMany: dbMocks.chainStages,
				findFirst: dbMocks.chainStage,
			},
			workPeriod: {
				findMany: dbMocks.workPeriods,
				findFirst: dbMocks.workPeriod,
			},
			timeEntry: { findMany: dbMocks.timeEntries },
		},
	},
}));

type RolloutMode = "legacy" | "shadow" | "ready" | "canonical" | "complete";

const organizationId = "org-composition";
const employeeId = "30000000-0000-4000-8000-000000000001";
const approverId = "30000000-0000-4000-8000-000000000002";
const periodId = "20000000-0000-4000-8000-000000000001";
const workflowId = "10000000-0000-4000-8000-000000000001";
const stageId = "40000000-0000-4000-8000-000000000001";
const canonicalRecordId = "70000000-0000-4000-8000-000000000001";
const approvalId = "60000000-0000-4000-8000-000000000001";
const privateReason = "private ordinary source reason";
const sourceDiagnostics = "private source diagnostics";
const forbiddenPrivatePattern =
	/private pending changes|private ordinary source reason|private source diagnostics|10000000-|20000000-|30000000-|40000000-|50000000-|60000000-|70000000-|org-composition|user-requester|team-1/;

function compatibilityMetadata(
	mode: RolloutMode,
	kind: OrdinaryWorkPeriodApprovalKind,
) {
	if (mode === "legacy") return null;
	if (mode === "canonical" || mode === "complete") {
		return {
			workflow: { id: workflowId, organizationId },
			stage: { id: stageId, sequence: 2 },
			timeRequest: { kind },
		};
	}
	return { timeRequest: { kind } };
}

function fixture(mode: RolloutMode, kind: OrdinaryWorkPeriodApprovalKind) {
	const user = {
		id: "user-requester",
		name: "Avery Employee",
		email: "avery@example.com",
		image: null,
	};
	const employee = {
		id: employeeId,
		userId: user.id,
		teamId: "team-1",
		organizationId,
		user,
	};
	const request = {
		id: approvalId,
		entityType: "time_entry",
		entityId: periodId,
		organizationId,
		requestedBy: employeeId,
		approverId,
		status: "pending",
		reason: privateReason,
		metadata: compatibilityMetadata(mode, kind),
		createdAt: new Date("2026-07-20T14:05:00.000Z"),
		approvedAt: null,
		rejectionReason: null,
		requester: employee,
		approver: null,
	};
	const period = {
		id: periodId,
		organizationId,
		employeeId,
		startTime: new Date("2026-07-20T06:00:00.000Z"),
		endTime: new Date("2026-07-20T14:00:00.000Z"),
		durationMinutes: 480,
		pendingChanges:
			kind === "manual_time_submission"
				? { isManualEntry: true, privateNote: "private pending changes" }
				: { isNewClockOut: true, privateNote: "private pending changes" },
		clockInId: "50000000-0000-4000-8000-000000000001",
		clockOutId: "50000000-0000-4000-8000-000000000002",
		canonicalRecordId,
		approvalWorkflowId:
			mode === "canonical" || mode === "complete" ? workflowId : null,
		employee,
		clockIn: {
			id: "50000000-0000-4000-8000-000000000001",
			timestamp: new Date("2026-07-20T06:00:00.000Z"),
			utcOffsetMinutes: 120,
			timezone: "Europe/Berlin",
		},
		clockOut: {
			id: "50000000-0000-4000-8000-000000000002",
			timestamp: new Date("2026-07-20T14:00:00.000Z"),
			utcOffsetMinutes: 120,
			timezone: "Europe/Berlin",
		},
		sourceDiagnostics,
	};
	const stage = {
		id: stageId,
		organizationId,
		approvalRequestId: approvalId,
		labelSnapshot: "Manager review",
		stepOrder: 2,
	};
	return { period, request, stage };
}

async function canonicalProjection(kind: OrdinaryWorkPeriodApprovalKind) {
	const adapter = createOrdinaryWorkPeriodApprovalAdapter(kind, {
		finalizeTerminal: vi.fn(),
	});
	const submittedAt = parseInstant("2026-07-20T14:05:00Z");
	const workflow = {
		id: workflowId,
		organizationId,
		workflowType: kind,
		sourceType: "time_entry",
		sourceId: periodId,
		requesterEmployeeId: employeeId,
		status: "pending" as const,
		currentStageOrder: 2,
		version: 1,
		policySnapshot: {},
		contextSnapshot: {
			timeRequest: { kind },
			privateReason,
			sourceDiagnostics,
		},
		displaySnapshot: {},
		submittedAt,
		completedAt: null,
		cancelledAt: null,
		decisionReason: null,
		stages: [
			{
				id: stageId,
				organizationId,
				workflowId,
				sequence: 2,
				label: "Manager review",
				resolverSnapshot: { sourceDiagnostics },
				activationMode: "immediate",
				status: "pending" as const,
				activatedAt: submittedAt,
				decidedAt: null,
				decisionReason: null,
				legacyApprovalRequestId: approvalId,
				assignments: [],
			},
		],
	};
	return adapter.projectDisplay({
		organizationId,
		workflow,
		sourceIdentity: {
			organizationId,
			workflowType: kind,
			sourceType: "time_entry",
			sourceId: periodId,
		},
		source: {
			id: periodId,
			organizationId,
			employeeId,
			canonicalRecordId,
			approvalWorkflowId: workflowId,
			approvalStatus: "pending",
			startTime: "2026-07-20T06:00:00Z",
			endTime: "2026-07-20T14:00:00Z",
			durationMinutes: 480,
			payload: { timeRequest: { kind } },
			pendingChanges: { privateNote: "private pending changes" },
		},
	});
}

const source: ApprovalInboxSource = {
	type: "time_entry",
	displayName: "Time Correction",
	supportsBulkApprove: true,
	handler: TimeCorrectionHandler,
};

describe.each([
	"legacy",
	"shadow",
	"ready",
	"canonical",
	"complete",
] as const)("ordinary approval read composition in %s mode", (mode) => {
	it.each([
		"manual_time_submission",
		"policy_clock_out",
	] as const)("composes sanitized %s list and detail", async (kind) => {
		const { period, request, stage } = fixture(mode, kind);
		dbMocks.approvalRequests.mockReset();
		dbMocks.chainStages.mockReset();
		dbMocks.chainStage.mockReset();
		dbMocks.workPeriods.mockReset();
		dbMocks.workPeriod.mockReset();
		dbMocks.timeEntries.mockReset();
		dbMocks.approvalRequests.mockImplementation(async (input) =>
			input && typeof input === "object" && "orderBy" in input
				? [request]
				: request,
		);
		dbMocks.chainStages.mockResolvedValue([stage]);
		dbMocks.chainStage.mockResolvedValue(stage);
		dbMocks.workPeriods.mockResolvedValue([period]);
		dbMocks.workPeriod.mockResolvedValue(period);
		dbMocks.timeEntries.mockResolvedValue([]);

		const list = await getApprovalInboxListFromSources({
			sources: [source],
			params: { approverId, organizationId, status: "pending" },
		});
		const detail = await getApprovalInboxDetailFromRequest({
			request,
			handler: TimeCorrectionHandler,
		});
		const privateSearch = await getApprovalInboxListFromSources({
			sources: [source],
			params: {
				approverId,
				organizationId,
				status: "pending",
				search: privateReason,
			},
		});

		const expectedTitle =
			kind === "manual_time_submission"
				? "Manual Time Submission"
				: "Clock-out Approval";
		const expectedSummary = {
			title: expectedTitle,
			subtitle: "Jul 20, 2026 - 08:00 to 16:00",
			detail: "8h on Jul 20, 2026",
			stage: { name: "Manager review", order: 2 },
		};
		expect(list.items).toHaveLength(1);
		expect(list.items[0]).toMatchObject({
			status: "pending",
			requester: { name: "Avery Employee" },
			summary: expectedSummary,
			capabilities: {
				canApprove: true,
				canReject: true,
				canBulkApprove: true,
			},
		});
		expect(detail.item.summary).toMatchObject(expectedSummary);
		expect(detail.sections[0]).toMatchObject({
			type: "key_value",
			rows: expect.arrayContaining([
				{ label: "Stage", value: "Manager review (2)" },
			]),
		});
		expect(detail.sections).toContainEqual({
			type: "timeline",
			title: "Timeline",
			events: [
				{
					id: "timeline-created-1",
					label: `${period.employee.user.name} requested ${expectedTitle.toLowerCase()}`,
					at: "2026-07-20T14:05:00.000Z",
					actorName: period.employee.user.name,
				},
			],
		});
		expect(privateSearch.items).toEqual([]);

		const publicPayload = JSON.stringify({
			list: list.items[0]?.summary,
			sections: detail.sections,
		});
		expect(publicPayload).not.toMatch(forbiddenPrivatePattern);

		const projection = await canonicalProjection(kind);
		expect(projection.displayPayload).toMatchObject({
			kind,
			stage: { name: "Manager review", order: 2 },
		});
		expect(
			`${JSON.stringify(projection.displayPayload)} ${projection.searchText}`,
		).not.toMatch(forbiddenPrivatePattern);
	});
});
