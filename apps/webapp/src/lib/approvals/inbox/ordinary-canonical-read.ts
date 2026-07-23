import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
	approvalInboxProjection,
	approvalRequest,
	timeRecord,
	workPeriod,
} from "@/db/schema";
import { instantFromDate, parseInstant } from "@/lib/datetime/temporal-core";
import { formatCapturedOffsetInstant } from "@/lib/datetime/temporal-format";
import type { OrdinaryWorkPeriodApprovalKind } from "../domain-adapters/work-period-contract";
import { parseOrdinaryWorkPeriodWorkflowPayload } from "../domain-adapters/work-period-contract";
import { classifyTimeApprovalRequest } from "../time-request-kind";
import { getAgeDays } from "./serialization";
import { buildInboxTriage } from "./triage";
import type {
	ApprovalInboxDetailResult,
	ApprovalInboxItem,
	ApprovalInboxStatus,
} from "./types";

type EligibleApprovalScope = {
	requesterEmployeeId: string;
	eligibleApproverIds: string[];
};

interface CanonicalEndpoint {
	id: string;
	organizationId: string;
	employeeId: string;
	type: string;
	timestamp: Date;
	utcOffsetMinutes: number;
	isSuperseded: boolean;
	supersededById: string | null;
	replacesEntryId: string | null;
}

export interface OrdinaryCanonicalReadRow {
	projection: {
		id: string;
		organizationId: string;
		workflowId: string;
		activeStageId: string;
		sourceType: string;
		sourceId: string;
		status: string;
		displayPayload: unknown;
		searchText: string;
		createdAt: Date;
	};
	workflow: {
		id: string;
		organizationId: string;
		workflowType: string;
		sourceType: string;
		sourceId: string;
		requesterEmployeeId: string | null;
		status: string;
		currentStageOrder: number | null;
		contextSnapshot: unknown;
		submittedAt: Date;
	};
	stage: {
		id: string;
		organizationId: string;
		workflowId: string;
		sequence: number;
		label: string;
		status: string;
		legacyApprovalRequestId: string | null;
	};
	assignment: {
		id: string;
		organizationId: string;
		workflowId: string;
		stageId: string;
		approverEmployeeId: string;
		status: string;
		assignedAt: Date;
	};
	requester: {
		id: string;
		organizationId: string;
		userId: string;
		teamId: string | null;
		user: { id: string; name: string; email: string; image: string | null };
	};
	period: {
		id: string;
		organizationId: string;
		employeeId: string;
		canonicalRecordId: string | null;
		approvalWorkflowId: string | null;
		approvalStatus: string;
		isActive: boolean;
		deletedAt: Date | null;
		startTime: Date;
		endTime: Date | null;
		durationMinutes: number | null;
		pendingChanges: unknown;
		employee: {
			id: string;
			organizationId: string;
			userId: string;
			user: { id: string; name: string; email: string; image: string | null };
		};
		clockIn: CanonicalEndpoint | null;
		clockOut: CanonicalEndpoint | null;
	};
	canonicalRecord: {
		id: string;
		organizationId: string;
		employeeId: string;
		recordKind: string;
		startAt: Date;
		endAt: Date | null;
		durationMinutes: number | null;
		approvalState: string;
	} | null;
	compatibilityRequest: {
		id: string;
		organizationId: string;
		entityType: string;
		entityId: string;
		requestedBy: string;
		approverId: string | null;
		status: string;
		metadata: unknown;
	} | null;
}

export interface OrdinaryCanonicalApproval {
	item: ApprovalInboxItem;
	detail: ApprovalInboxDetailResult;
	decisionTarget: {
		id: string;
		targetType: "canonical_assignment";
		entityType: "time_entry";
		entityId: string;
		organizationId: string;
		approverId: string;
		requesterEmployeeId: string;
		status: ApprovalInboxStatus;
		workflowKind: OrdinaryWorkPeriodApprovalKind;
	};
}

interface SelectOrdinaryCanonicalApprovalsInput {
	rows: OrdinaryCanonicalReadRow[];
	organizationId: string;
	approverId: string;
	includeAllApprovers?: boolean;
	eligibleApprovalScopes?: EligibleApprovalScope[];
	search?: string;
	teamId?: string;
}

function exactObject(value: unknown, keys: readonly string[]) {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		return null;
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (
		Reflect.ownKeys(descriptors).some(
			(key) =>
				typeof key !== "string" ||
				!keys.includes(key) ||
				!descriptors[key]?.enumerable ||
				!("value" in descriptors[key]),
		)
	) {
		return null;
	}
	return value as Record<string, unknown>;
}

function ordinaryKind(value: string): OrdinaryWorkPeriodApprovalKind | null {
	return value === "manual_time_submission" || value === "policy_clock_out"
		? value
		: null;
}

function sameDate(left: Date | null, right: Date | null): boolean {
	return left instanceof Date && right instanceof Date
		? left.getTime() === right.getTime()
		: left === right;
}

function validEndpoint(
	endpoint: CanonicalEndpoint | null,
	row: OrdinaryCanonicalReadRow,
	type: "clock_in" | "clock_out",
): endpoint is CanonicalEndpoint {
	return Boolean(
		endpoint &&
			endpoint.organizationId === row.period.organizationId &&
			endpoint.employeeId === row.period.employeeId &&
			endpoint.type === type &&
			endpoint.timestamp instanceof Date &&
			Number.isInteger(endpoint.utcOffsetMinutes) &&
			endpoint.isSuperseded === false &&
			endpoint.supersededById === null &&
			endpoint.replacesEntryId === null,
	);
}

function parseDisplay(
	row: OrdinaryCanonicalReadRow,
	kind: OrdinaryWorkPeriodApprovalKind,
) {
	const expectedTitle =
		kind === "manual_time_submission"
			? "Manual time submission"
			: "Policy clock-out";
	const display = exactObject(row.projection.displayPayload, [
		"kind",
		"title",
		"startTime",
		"endTime",
		"durationMinutes",
		"approvalStatus",
		"stage",
	]);
	const stage = exactObject(display?.stage, ["name", "order"]);
	const expectedSearch =
		display &&
		typeof display.startTime === "string" &&
		typeof display.endTime === "string" &&
		stage &&
		typeof stage.name === "string"
			? `${expectedTitle} ${display.startTime} ${display.endTime} ${stage.name}`.toLocaleLowerCase(
					"en-US",
				)
			: null;
	if (
		!display ||
		display.kind !== kind ||
		display.title !== expectedTitle ||
		typeof display.startTime !== "string" ||
		typeof display.endTime !== "string" ||
		display.durationMinutes !== row.period.durationMinutes ||
		display.approvalStatus !== "pending" ||
		!stage ||
		stage.name !== row.stage.label ||
		stage.order !== row.stage.sequence ||
		row.projection.searchText !== expectedSearch
	) {
		return null;
	}
	try {
		if (
			parseInstant(display.startTime).epochMilliseconds !==
				row.period.startTime.getTime() ||
			parseInstant(display.endTime).epochMilliseconds !==
				row.period.endTime?.getTime()
		) {
			return null;
		}
	} catch {
		return null;
	}
	return stage as { name: string; order: number };
}

function hasExactCompatibility(
	row: OrdinaryCanonicalReadRow,
	kind: OrdinaryWorkPeriodApprovalKind,
): boolean {
	const request = row.compatibilityRequest;
	if (!row.stage.legacyApprovalRequestId || !request) return false;
	const metadata = exactObject(request.metadata, [
		"workflow",
		"stage",
		"timeRequest",
	]);
	const workflow = exactObject(metadata?.workflow, ["id", "organizationId"]);
	const stage = exactObject(metadata?.stage, ["id", "sequence"]);
	const timeRequest = exactObject(metadata?.timeRequest, ["kind"]);
	return Boolean(
		request.id === row.stage.legacyApprovalRequestId &&
			request.organizationId === row.projection.organizationId &&
			request.entityType === "time_entry" &&
			request.entityId === row.period.id &&
			request.requestedBy === row.requester.id &&
			request.approverId === row.assignment.approverEmployeeId &&
			request.status === "pending" &&
			workflow?.id === row.workflow.id &&
			workflow.organizationId === row.workflow.organizationId &&
			stage?.id === row.stage.id &&
			stage.sequence === row.stage.sequence &&
			timeRequest?.kind === kind,
	);
}

function visible(
	input: SelectOrdinaryCanonicalApprovalsInput,
	row: OrdinaryCanonicalReadRow,
) {
	if (input.includeAllApprovers) return true;
	if (row.assignment.approverEmployeeId === input.approverId) return true;
	return (
		input.eligibleApprovalScopes?.some(
			(scope) =>
				scope.requesterEmployeeId === row.requester.id &&
				scope.eligibleApproverIds.includes(input.approverId) &&
				scope.eligibleApproverIds.includes(row.assignment.approverEmployeeId),
		) ?? false
	);
}

function validateRow(
	row: OrdinaryCanonicalReadRow,
	organizationId: string,
): {
	kind: OrdinaryWorkPeriodApprovalKind;
	stage: { name: string; order: number };
} | null {
	const {
		projection,
		workflow,
		stage,
		assignment,
		requester,
		period,
		canonicalRecord,
	} = row;
	const kind = ordinaryKind(workflow.workflowType);
	if (!kind) return null;
	try {
		parseOrdinaryWorkPeriodWorkflowPayload(workflow.contextSnapshot, kind);
	} catch {
		return null;
	}
	if (
		projection.organizationId !== organizationId ||
		workflow.organizationId !== organizationId ||
		stage.organizationId !== organizationId ||
		assignment.organizationId !== organizationId ||
		requester.organizationId !== organizationId ||
		period.organizationId !== organizationId ||
		canonicalRecord?.organizationId !== organizationId ||
		projection.status !== "pending" ||
		workflow.status !== "pending" ||
		stage.status !== "pending" ||
		assignment.status !== "pending" ||
		projection.workflowId !== workflow.id ||
		projection.activeStageId !== stage.id ||
		projection.sourceType !== "time_entry" ||
		projection.sourceId !== period.id ||
		workflow.sourceType !== "time_entry" ||
		workflow.sourceId !== period.id ||
		workflow.requesterEmployeeId !== requester.id ||
		workflow.currentStageOrder !== stage.sequence ||
		stage.workflowId !== workflow.id ||
		assignment.workflowId !== workflow.id ||
		assignment.stageId !== stage.id ||
		requester.user.id !== requester.userId ||
		period.employeeId !== requester.id ||
		period.employee.id !== requester.id ||
		period.employee.organizationId !== organizationId ||
		period.employee.userId !== requester.userId ||
		period.employee.user.id !== requester.user.id ||
		period.approvalWorkflowId !== workflow.id ||
		period.approvalStatus !== "pending" ||
		period.isActive !== false ||
		period.deletedAt !== null ||
		!(period.startTime instanceof Date) ||
		!(period.endTime instanceof Date) ||
		!Number.isInteger(period.durationMinutes) ||
		(period.durationMinutes ?? -1) < 0 ||
		!validEndpoint(period.clockIn, row, "clock_in") ||
		!validEndpoint(period.clockOut, row, "clock_out") ||
		!sameDate(period.clockIn.timestamp, period.startTime) ||
		!sameDate(period.clockOut.timestamp, period.endTime) ||
		!canonicalRecord ||
		canonicalRecord.id !== period.canonicalRecordId ||
		canonicalRecord.employeeId !== requester.id ||
		canonicalRecord.recordKind !== "work" ||
		canonicalRecord.approvalState !== "pending" ||
		canonicalRecord.durationMinutes !== period.durationMinutes ||
		!sameDate(canonicalRecord.startAt, period.startTime) ||
		!sameDate(canonicalRecord.endAt, period.endTime) ||
		classifyTimeApprovalRequest({
			metadata: workflow.contextSnapshot,
			pendingChanges: period.pendingChanges,
		}) !== kind
	) {
		return null;
	}
	const publicStage = parseDisplay(row, kind);
	return publicStage ? { kind, stage: publicStage } : null;
}

function formatDuration(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const remainder = minutes % 60;
	return `${hours ? `${hours}h` : ""}${hours && remainder ? " " : ""}${remainder ? `${remainder}m` : ""}`;
}

function publicTitle(kind: OrdinaryWorkPeriodApprovalKind): string {
	return kind === "manual_time_submission"
		? "Manual Time Submission"
		: "Clock-out Approval";
}

function toApproval(
	row: OrdinaryCanonicalReadRow,
	validated: NonNullable<ReturnType<typeof validateRow>>,
): OrdinaryCanonicalApproval {
	const { period, requester, assignment, workflow } = row;
	const { clockIn, clockOut } = period;
	if (!clockIn || !clockOut) {
		throw new Error("Validated ordinary approval endpoints are unavailable");
	}
	const title = publicTitle(validated.kind);
	const date = formatCapturedOffsetInstant(instantFromDate(clockIn.timestamp), {
		locale: "en-US",
		timeFormat: "24h",
		offsetMinutes: clockIn.utcOffsetMinutes,
		preset: "dateMedium",
	});
	const start = formatCapturedOffsetInstant(
		instantFromDate(clockIn.timestamp),
		{
			locale: "en-US",
			timeFormat: "24h",
			offsetMinutes: clockIn.utcOffsetMinutes,
			preset: "time",
		},
	);
	const end = formatCapturedOffsetInstant(instantFromDate(clockOut.timestamp), {
		locale: "en-US",
		timeFormat: "24h",
		offsetMinutes: clockOut.utcOffsetMinutes,
		preset: "time",
	});
	const duration = formatDuration(period.durationMinutes ?? 0);
	const triage = buildInboxTriage({
		type: "time_entry",
		priority: "low",
		status: "pending",
		createdAt: workflow.submittedAt,
	});
	const capabilities = {
		canApprove: true,
		canReject: true,
		canBulkApprove: true,
		requiresRejectReason: true,
	};
	const item: ApprovalInboxItem = {
		id: assignment.id,
		type: "time_entry",
		entityId: assignment.id,
		status: "pending",
		requester: {
			id: requester.id,
			name: requester.user.name,
			email: requester.user.email,
			image: requester.user.image,
			teamId: requester.teamId,
		},
		summary: {
			title,
			subtitle: `${date} - ${start} to ${end}`,
			detail: `${duration} on ${date}`,
			badge: {
				label:
					validated.kind === "manual_time_submission" ? "Manual" : "Clock-out",
				color: null,
			},
			stage: validated.stage,
		},
		timing: {
			createdAt: workflow.submittedAt.toISOString(),
			resolvedAt: null,
			slaDeadline: null,
			ageDays: getAgeDays({ createdAt: workflow.submittedAt }),
		},
		triage,
		capabilities,
	};
	const detail: ApprovalInboxDetailResult = {
		item,
		actions: capabilities,
		sections: [
			{
				type: "key_value",
				title: "Request",
				rows: [
					{ label: "Type", value: title },
					{ label: "Range", value: item.summary.subtitle },
					{ label: "Duration", value: duration },
					{ label: "Status", value: "pending" },
					{
						label: "Stage",
						value: `${validated.stage.name} (${validated.stage.order})`,
					},
				],
			},
			{
				type: "timeline",
				title: "Timeline",
				events: [
					{
						id: "timeline-created-1",
						label: `${requester.user.name} requested ${title.toLowerCase()}`,
						at: workflow.submittedAt.toISOString(),
						actorName: requester.user.name,
					},
				],
			},
		],
	};
	return {
		item,
		detail,
		decisionTarget: {
			id: assignment.id,
			targetType: "canonical_assignment",
			entityType: "time_entry",
			entityId: period.id,
			organizationId: workflow.organizationId,
			approverId: assignment.approverEmployeeId,
			requesterEmployeeId: requester.id,
			status: "pending",
			workflowKind: validated.kind,
		},
	};
}

export function selectOrdinaryCanonicalApprovals(
	input: SelectOrdinaryCanonicalApprovalsInput,
): OrdinaryCanonicalApproval[] {
	const search = input.search?.trim().toLocaleLowerCase("en-US");
	return input.rows.flatMap((row) => {
		const validated = validateRow(row, input.organizationId);
		if (
			!validated ||
			!visible(input, row) ||
			(input.teamId && row.requester.teamId !== input.teamId) ||
			hasExactCompatibility(row, validated.kind)
		) {
			return [];
		}
		const approval = toApproval(row, validated);
		if (search) {
			const searchable = [
				approval.item.requester.name,
				approval.item.requester.email,
				approval.item.summary.title,
				approval.item.summary.subtitle,
				approval.item.summary.detail,
				approval.item.summary.stage?.name,
			]
				.filter(Boolean)
				.join(" ")
				.toLocaleLowerCase("en-US");
			if (!searchable.includes(search)) return [];
		}
		return [approval];
	});
}

interface OrdinaryCanonicalReadDatabase {
	query: {
		approvalInboxProjection: { findMany(input: unknown): Promise<unknown[]> };
		workPeriod: { findFirst(input: unknown): Promise<unknown> };
		timeRecord: { findFirst(input: unknown): Promise<unknown> };
		approvalRequest: { findFirst(input: unknown): Promise<unknown> };
	};
}

export async function loadOrdinaryCanonicalApprovals(
	input: Omit<SelectOrdinaryCanonicalApprovalsInput, "rows"> & {
		database?: OrdinaryCanonicalReadDatabase;
	},
): Promise<OrdinaryCanonicalApproval[]> {
	const database =
		input.database ?? (db as unknown as OrdinaryCanonicalReadDatabase);
	const projections = await database.query.approvalInboxProjection.findMany({
		where: and(
			eq(approvalInboxProjection.organizationId, input.organizationId),
			eq(approvalInboxProjection.status, "pending"),
		),
		with: {
			workflow: { with: { requester: { with: { user: true } } } },
			activeStage: { with: { assignments: true } },
		},
	});
	const rows = (
		await Promise.all(
			projections.map(async (value) => {
				const projection = value as OrdinaryCanonicalReadRow["projection"] & {
					workflow?: OrdinaryCanonicalReadRow["workflow"] & {
						requester?: OrdinaryCanonicalReadRow["requester"] | null;
					};
					activeStage?: OrdinaryCanonicalReadRow["stage"] & {
						assignments?: OrdinaryCanonicalReadRow["assignment"][];
					};
				};
				const workflow = projection.workflow;
				const stage = projection.activeStage;
				const requester = workflow?.requester;
				if (!workflow || !stage || !requester) return [];
				const [period, compatibilityRequest] = await Promise.all([
					database.query.workPeriod.findFirst({
						where: and(
							eq(workPeriod.id, projection.sourceId),
							eq(workPeriod.organizationId, input.organizationId),
						),
						with: {
							employee: { with: { user: true } },
							clockIn: true,
							clockOut: true,
						},
					}),
					stage.legacyApprovalRequestId
						? database.query.approvalRequest.findFirst({
								where: and(
									eq(approvalRequest.id, stage.legacyApprovalRequestId),
									eq(approvalRequest.organizationId, input.organizationId),
								),
							})
						: Promise.resolve(null),
				]);
				if (!period) return [];
				const canonicalId = (period as OrdinaryCanonicalReadRow["period"])
					.canonicalRecordId;
				const resolvedCanonicalRecord = canonicalId
					? await database.query.timeRecord.findFirst({
							where: and(
								eq(timeRecord.id, canonicalId),
								eq(timeRecord.organizationId, input.organizationId),
							),
						})
					: null;
				return (stage.assignments ?? []).map((assignment) => ({
					projection,
					workflow,
					stage,
					assignment,
					requester,
					period,
					canonicalRecord: resolvedCanonicalRecord,
					compatibilityRequest,
				})) as OrdinaryCanonicalReadRow[];
			}),
		)
	).flat();
	return selectOrdinaryCanonicalApprovals({ ...input, rows });
}
