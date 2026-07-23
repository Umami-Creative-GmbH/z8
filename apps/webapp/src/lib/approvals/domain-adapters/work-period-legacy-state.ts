import { sql } from "drizzle-orm";
import { instantFromDB } from "@/lib/datetime/drizzle-adapter";
import {
	compareInstants,
	type Instant,
	instantToCanonicalString,
	parseInstant,
} from "@/lib/datetime/temporal-core";
import type { ApprovalDbService } from "../server/types";
import { classifyTimeApprovalRequest } from "../time-request-kind";
import { deriveApprovalWorkflowId } from "../workflow/identity";
import type {
	JsonObject,
	LegacyApprovalChainRowSnapshot,
	LegacyApprovalChainSnapshot,
	LegacyApprovalRequestSnapshot,
	VerifiedLegacyApprovalState,
} from "../workflow/ports";
import { normalizeStableData } from "../workflow/stable-data";
import {
	type OrdinaryWorkPeriodApprovalKind,
	parseOrdinaryWorkPeriodWorkflowPayload,
} from "./work-period-contract";

const CANONICAL_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type OrdinaryWorkPeriodLegacyStateCaptureErrorCode =
	| "capture_failed"
	| "query_failed";

export class OrdinaryWorkPeriodLegacyStateCaptureError extends Error {
	readonly code: OrdinaryWorkPeriodLegacyStateCaptureErrorCode;

	constructor(code: OrdinaryWorkPeriodLegacyStateCaptureErrorCode) {
		super("Ordinary work-period legacy approval state capture failed");
		this.name = "OrdinaryWorkPeriodLegacyStateCaptureError";
		this.code = code;
	}
}

export interface CaptureOrdinaryWorkPeriodLegacyStateInput {
	dbService: ApprovalDbService;
	organizationId: string;
	workPeriodId: string;
	expectedKind: OrdinaryWorkPeriodApprovalKind;
	expectedRequesterEmployeeId: string;
	approvalRequestId: string;
	expectedRequestStatus?: RequestStatus;
}

export interface CaptureOrdinaryWorkPeriodLegacyPreSubmissionStateInput {
	dbService: ApprovalDbService;
	organizationId: string;
	workPeriodId: string;
	expectedKind: OrdinaryWorkPeriodApprovalKind;
	expectedRequesterEmployeeId: string;
	capturedAt?: Instant;
}

type RequestStatus = "pending" | "approved" | "rejected";
type ChainStatus = RequestStatus | "cancelled";

interface WorkPeriodSnapshot {
	id: string;
	organizationId: string;
	employeeId: string;
	startTime: Instant;
	endTime: Instant | null;
	durationMinutes: number | null;
	isActive: boolean;
	approvalStatus: RequestStatus;
	pendingChanges: unknown;
	deletedAt: Instant | null;
	canonicalRecordId: string;
	approvalWorkflowId: string | null;
}

interface CanonicalRecordSnapshot {
	id: string;
	organizationId: string;
	employeeId: string;
	recordKind: string;
	startAt: Instant;
	endAt: Instant | null;
	durationMinutes: number | null;
	approvalState: RequestStatus | "draft";
}

function fail(
	code: OrdinaryWorkPeriodLegacyStateCaptureErrorCode = "capture_failed",
): never {
	throw new OrdinaryWorkPeriodLegacyStateCaptureError(code);
}

function record(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return fail();
	}
	return value as Record<string, unknown>;
}

function exactDataRecord(
	value: unknown,
	expectedKeys: readonly string[],
): Record<string, unknown> {
	if (
		value === null ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		(Object.getPrototypeOf(value) !== Object.prototype &&
			Object.getPrototypeOf(value) !== null)
	) {
		return fail();
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	if (
		keys.length !== expectedKeys.length ||
		keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
	) {
		return fail();
	}
	const result: Record<string, unknown> = {};
	for (const key of expectedKeys) {
		const descriptor = descriptors[key];
		if (!descriptor?.enumerable || !("value" in descriptor)) return fail();
		result[key] = descriptor.value;
	}
	return result;
}

function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) return fail();
	return value;
}

function string(value: unknown): string {
	if (typeof value !== "string" || value.length === 0) return fail();
	return value;
}

function nullableString(value: unknown): string | null {
	return value === null ? null : string(value);
}

function boolean(value: unknown): boolean {
	if (typeof value !== "boolean") return fail();
	return value;
}

function integer(value: unknown): number {
	if (!Number.isSafeInteger(value)) return fail();
	return value as number;
}

function nullableInteger(value: unknown): number | null {
	return value === null ? null : integer(value);
}

function nullableInstant(value: unknown): Instant | null {
	if (value === null) return null;
	try {
		if (value instanceof Date) return instantFromDB(value) ?? fail();
		if (
			typeof value === "string" &&
			/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/.test(value)
		) {
			return parseInstant(`${value.replace(" ", "T")}Z`);
		}
	} catch {
		return fail();
	}
	return fail();
}

function requiredInstant(value: unknown): Instant {
	return nullableInstant(value) ?? fail();
}

function requestStatus(value: unknown): RequestStatus {
	if (value === "pending" || value === "approved" || value === "rejected") {
		return value;
	}
	return fail();
}

function chainStatus(value: unknown): ChainStatus {
	if (
		value === "pending" ||
		value === "approved" ||
		value === "rejected" ||
		value === "cancelled"
	) {
		return value;
	}
	return fail();
}

function sameInstant(left: Instant | null, right: Instant | null): boolean {
	if (left === null || right === null) return left === right;
	return compareInstants(left, right) === 0;
}

function exactlyOne(values: unknown[]): unknown {
	if (values.length !== 1) return fail();
	return values[0];
}

function decodePeriod(value: unknown): WorkPeriodSnapshot {
	const raw = record(value);
	return {
		id: string(raw.id),
		organizationId: string(raw.organizationId),
		employeeId: string(raw.employeeId),
		startTime: requiredInstant(raw.startTime),
		endTime: nullableInstant(raw.endTime),
		durationMinutes: nullableInteger(raw.durationMinutes),
		isActive: boolean(raw.isActive),
		approvalStatus: requestStatus(raw.approvalStatus),
		pendingChanges: raw.pendingChanges,
		deletedAt: nullableInstant(raw.deletedAt),
		canonicalRecordId: string(raw.canonicalRecordId),
		approvalWorkflowId: nullableString(raw.approvalWorkflowId),
	};
}

function decodeCanonical(value: unknown): CanonicalRecordSnapshot {
	const raw = record(value);
	const approvalState = string(raw.approvalState);
	if (
		approvalState !== "draft" &&
		approvalState !== "pending" &&
		approvalState !== "approved" &&
		approvalState !== "rejected"
	) {
		return fail();
	}
	return {
		id: string(raw.id),
		organizationId: string(raw.organizationId),
		employeeId: string(raw.employeeId),
		recordKind: string(raw.recordKind),
		startAt: requiredInstant(raw.startAt),
		endAt: nullableInstant(raw.endAt),
		durationMinutes: nullableInteger(raw.durationMinutes),
		approvalState,
	};
}

function normalizeRequestPayload(input: {
	metadata: unknown;
	reason: string | null;
	pendingChanges: unknown;
	expectedKind: OrdinaryWorkPeriodApprovalKind;
	organizationId: string;
	workPeriodId: string;
}) {
	const raw = record(input.metadata);
	const markerDescriptor = Object.getOwnPropertyDescriptor(
		raw,
		"ordinarySubmission",
	);
	if (
		markerDescriptor &&
		(!markerDescriptor.enumerable || !("value" in markerDescriptor))
	) {
		return fail();
	}
	const marker = markerDescriptor
		? exactDataRecord(markerDescriptor.value, ["key", "submissionId"])
		: null;
	if (marker) {
		if (
			typeof marker.submissionId !== "string" ||
			!CANONICAL_UUID.test(marker.submissionId)
		) {
			return fail();
		}
		const expectedKey = deriveApprovalWorkflowId({
			organizationId: input.organizationId,
			workflowType: input.expectedKind,
			sourceType: "time_entry",
			sourceId: input.workPeriodId,
			allocationKey: marker.submissionId,
		});
		if (marker.key !== expectedKey) return fail();
	}
	if (
		classifyTimeApprovalRequest({
			metadata: { timeRequest: raw.timeRequest },
			reason: input.reason,
			pendingChanges: input.pendingChanges,
			hasRelationalCorrectionEvidence: false,
		}) !== input.expectedKind
	) {
		return fail();
	}
	try {
		const payload = parseOrdinaryWorkPeriodWorkflowPayload(
			{ timeRequest: raw.timeRequest },
			input.expectedKind,
		);
		return { payload, marker };
	} catch {
		return fail();
	}
}

function decodeRequest(
	value: unknown,
	period: WorkPeriodSnapshot,
	organizationId: string,
	workPeriodId: string,
	expectedKind: OrdinaryWorkPeriodApprovalKind,
	expectedStatus: RequestStatus,
): LegacyApprovalRequestSnapshot {
	const raw = record(value);
	const reason = nullableString(raw.reason);
	const status = requestStatus(raw.status);
	const approvedAt = nullableInstant(raw.approvedAt);
	const rejectionReason = nullableString(raw.rejectionReason);
	if (
		status !== expectedStatus ||
		(expectedStatus === "pending" &&
			(approvedAt !== null || rejectionReason !== null)) ||
		(expectedStatus === "approved" &&
			(approvedAt === null || rejectionReason !== null)) ||
		(expectedStatus === "rejected" &&
			(approvedAt !== null || !rejectionReason))
	) {
		return fail();
	}
	const rawMetadata =
		raw.metadata === null
			? { timeRequest: { kind: expectedKind } }
			: record(raw.metadata);
	const markerDescriptor = Object.getOwnPropertyDescriptor(
		rawMetadata,
		"ordinarySubmission",
	);
	if (
		markerDescriptor &&
		(!markerDescriptor.enumerable || !("value" in markerDescriptor))
	) {
		return fail();
	}
	const hasMarker = markerDescriptor !== undefined;
	let metadata: unknown;
	const autoApprovalDescriptor = Object.getOwnPropertyDescriptor(
		rawMetadata,
		"autoApproval",
	);
	const requesterAutoApproved = autoApprovalDescriptor !== undefined;
	if (
		expectedStatus === "approved" &&
		raw.approverId === raw.requestedBy &&
		!requesterAutoApproved
	) {
		return fail();
	}
	if (requesterAutoApproved) {
		if (
			expectedStatus !== "approved" ||
			raw.approverId !== raw.requestedBy
		) {
			return fail();
		}
		const root = exactDataRecord(rawMetadata, [
			"timeRequest",
			...(hasMarker ? ["ordinarySubmission"] : []),
			"autoApproval",
		]);
		const autoApproval = exactDataRecord(root.autoApproval, ["reason"]);
		if (autoApproval.reason !== "requester_is_approver") {
			return fail();
		}
		metadata = root;
	} else {
		metadata = exactDataRecord(rawMetadata, [
			"timeRequest",
			...(hasMarker ? ["ordinarySubmission"] : []),
		]);
	}
	const normalized = normalizeRequestPayload({
		metadata,
		reason,
		pendingChanges: period.pendingChanges,
		expectedKind,
		organizationId,
		workPeriodId,
	});
	return {
		id: string(raw.id),
		organizationId: string(raw.organizationId),
		entityType: string(raw.entityType),
		entityId: string(raw.entityId),
		requestedBy: string(raw.requestedBy),
		approverId: string(raw.approverId),
		status,
		reason,
		rejectionReason,
		approvedAt,
		metadata: {
			...normalized.payload,
			...(normalized.marker ? { ordinarySubmission: normalized.marker } : {}),
			...(requesterAutoApproved
				? { autoApproval: { reason: "requester_is_approver" } }
				: {}),
		} as unknown as JsonObject,
		updatedAt: requiredInstant(raw.updatedAt),
	};
}

function decodeChain(
	value: unknown,
	expectedStatus: RequestStatus,
): LegacyApprovalChainSnapshot {
	const raw = record(value);
	const status = chainStatus(raw.status);
	const completedAt = nullableInstant(raw.completedAt);
	const currentStageOrder = integer(raw.currentStageOrder);
	if (
		status !== expectedStatus ||
		(expectedStatus === "pending"
			? completedAt !== null
			: completedAt === null) ||
		currentStageOrder < 1
	) {
		return fail();
	}
	return {
		id: string(raw.id),
		organizationId: string(raw.organizationId),
		policyId: string(raw.policyId),
		policyNameSnapshot: string(raw.policyNameSnapshot),
		entityType: string(raw.entityType),
		entityId: string(raw.entityId),
		requesterEmployeeId: string(raw.requesterEmployeeId),
		currentStageOrder,
		status,
		createdAt: requiredInstant(raw.createdAt),
		updatedAt: requiredInstant(raw.updatedAt),
		completedAt,
	};
}

function decodeChainRow(value: unknown): LegacyApprovalChainRowSnapshot {
	const raw = record(value);
	const status = chainStatus(raw.status);
	const approvalRequestId = nullableString(raw.approvalRequestId);
	const decidedBy = nullableString(raw.decidedBy);
	const decidedAt = nullableInstant(raw.decidedAt);
	const stepOrder = integer(raw.stepOrder);
	if (
		stepOrder < 1 ||
		((status === "approved" || status === "rejected") &&
			(!approvalRequestId || !decidedBy || !decidedAt)) ||
		((status === "pending" || status === "cancelled") &&
			(decidedBy !== null || decidedAt !== null))
	) {
		return fail();
	}
	return {
		id: string(raw.id),
		organizationId: string(raw.organizationId),
		chainInstanceId: string(raw.chainInstanceId),
		policyStageId: string(raw.policyStageId),
		stepOrder,
		labelSnapshot: string(raw.labelSnapshot),
		approverTypeSnapshot: string(raw.approverTypeSnapshot),
		resolvedApproverEmployeeId: string(raw.resolvedApproverEmployeeId),
		approvalRequestId,
		status,
		decidedBy,
		decidedAt,
		createdAt: requiredInstant(raw.createdAt),
		updatedAt: requiredInstant(raw.updatedAt),
	};
}

function decodeCapture(
	input: CaptureOrdinaryWorkPeriodLegacyStateInput,
	queryResult: unknown,
): VerifiedLegacyApprovalState {
	const resultRows = array(record(queryResult).rows);
	const envelope = record(exactlyOne(resultRows));
	const period = decodePeriod(exactlyOne(array(envelope.workPeriods)));
	const canonical = decodeCanonical(
		exactlyOne(array(envelope.canonicalRecords)),
	);
	const request = decodeRequest(
		exactlyOne(array(envelope.approvalRequests)),
		period,
		input.organizationId,
		input.workPeriodId,
		input.expectedKind,
		input.expectedRequestStatus ?? "pending",
	);
	const expectedSourceStatus = input.expectedRequestStatus ?? "pending";
	if (
		period.id !== input.workPeriodId ||
		period.organizationId !== input.organizationId ||
		period.employeeId !== input.expectedRequesterEmployeeId ||
		period.approvalStatus !== expectedSourceStatus ||
		period.deletedAt !== null ||
		period.isActive ||
		period.endTime === null ||
		period.durationMinutes === null ||
		period.durationMinutes < 0 ||
		compareInstants(period.endTime, period.startTime) < 0 ||
		request.id !== input.approvalRequestId ||
		request.organizationId !== input.organizationId ||
		request.entityType !== "time_entry" ||
		request.entityId !== input.workPeriodId ||
		request.requestedBy !== input.expectedRequesterEmployeeId
	) {
		return fail();
	}
	if (
		canonical.id !== period.canonicalRecordId ||
		canonical.organizationId !== input.organizationId ||
		canonical.employeeId !== input.expectedRequesterEmployeeId ||
		canonical.recordKind !== "work" ||
		canonical.approvalState !== expectedSourceStatus ||
		!sameInstant(canonical.startAt, period.startTime) ||
		!sameInstant(canonical.endAt, period.endTime) ||
		canonical.durationMinutes !== period.durationMinutes
	) {
		return fail();
	}

	const workflows = array(envelope.workflows);
	if (period.approvalWorkflowId === null) {
		if (workflows.length !== 0) return fail();
	} else {
		const workflow = record(exactlyOne(workflows));
		if (
			string(workflow.id) !== period.approvalWorkflowId ||
			string(workflow.organizationId) !== input.organizationId ||
			string(workflow.workflowType) !== input.expectedKind ||
			string(workflow.sourceType) !== "time_entry" ||
			string(workflow.sourceId) !== input.workPeriodId ||
			string(workflow.requesterEmployeeId) !== input.expectedRequesterEmployeeId
		) {
			return fail();
		}
	}

	const requestStageLinks = array(envelope.requestStageLinks);
	if (requestStageLinks.length > 1) return fail();
	const rawChains = array(envelope.chains);
	const rawChainRows = array(envelope.chainRows);
	if (rawChainRows.length > 100) return fail();
	let chain: LegacyApprovalChainSnapshot | null = null;
	let chainRows: LegacyApprovalChainRowSnapshot[] = [];
	if (requestStageLinks.length === 0) {
		if (rawChains.length !== 0 || rawChainRows.length !== 0) return fail();
	} else {
		const link = record(requestStageLinks[0]);
		chain = decodeChain(exactlyOne(rawChains), expectedSourceStatus);
		chainRows = rawChainRows
			.map(decodeChainRow)
			.sort((left, right) => left.stepOrder - right.stepOrder);
		const currentIndex = chainRows.findIndex(
			(row) => row.stepOrder === chain?.currentStageOrder,
		);
		const current = chainRows[currentIndex];
		if (
			chain.organizationId !== input.organizationId ||
			chain.entityType !== "time_entry" ||
			chain.entityId !== input.workPeriodId ||
			chain.requesterEmployeeId !== input.expectedRequesterEmployeeId ||
			chain.id !== string(link.chainInstanceId) ||
			!current ||
			current.id !== string(link.stageId) ||
			current.approvalRequestId !== input.approvalRequestId ||
			current.status !== expectedSourceStatus ||
			current.resolvedApproverEmployeeId !== request.approverId ||
			new Set(chainRows.map((row) => row.id)).size !== chainRows.length ||
			new Set(chainRows.map((row) => row.stepOrder)).size !==
				chainRows.length ||
			chainRows.some(
				(row) =>
					row.organizationId !== input.organizationId ||
					row.chainInstanceId !== chain?.id,
			) ||
			(expectedSourceStatus === "approved"
				? chainRows.some((row) => row.status !== "approved")
				: chainRows
						.slice(0, currentIndex)
						.some((row) => row.status !== "approved") ||
					chainRows
						.slice(currentIndex + 1)
						.some(
							(row) =>
								row.status !== "cancelled" ||
								row.approvalRequestId !== null ||
								row.decidedBy !== null ||
								row.decidedAt !== null,
						))
		) {
			return fail();
		}
	}

	const requiredEmployeeIds = new Set([
		input.expectedRequesterEmployeeId,
		request.requestedBy,
		request.approverId,
		...(chain ? [chain.requesterEmployeeId] : []),
		...chainRows.flatMap((row) => [
			row.resolvedApproverEmployeeId,
			...(row.decidedBy ? [row.decidedBy] : []),
		]),
	]);
	const employees = array(envelope.employees).map((value) => {
		const employee = record(value);
		return {
			id: string(employee.id),
			organizationId: string(employee.organizationId),
		};
	});
	const ownedEmployeeIds = new Set(
		employees.flatMap((employee) =>
			employee.organizationId === input.organizationId ? [employee.id] : [],
		),
	);
	if (
		employees.length !== ownedEmployeeIds.size ||
		ownedEmployeeIds.size !== requiredEmployeeIds.size ||
		[...requiredEmployeeIds].some((id) => !ownedEmployeeIds.has(id))
	) {
		return fail();
	}

	const payload = parseOrdinaryWorkPeriodWorkflowPayload(
		{
			timeRequest: record(request.metadata).timeRequest,
		},
		input.expectedKind,
	);
	const displaySnapshot = {
		approvalStatus: period.approvalStatus,
		labels: {
			title:
				input.expectedKind === "manual_time_submission"
					? "Manual time submission"
					: "Policy clock-out",
		},
		period: {
			startAt: instantToCanonicalString(period.startTime),
			endAt: instantToCanonicalString(period.endTime),
			durationMinutes: period.durationMinutes,
		},
	};
	return normalizeStableData({
		organizationId: input.organizationId,
		source: {
			organizationId: input.organizationId,
			workflowType: input.expectedKind,
			sourceType: "time_entry",
			sourceId: input.workPeriodId,
		},
		approvalRequest: request,
		chain,
		chainRows,
		sourceSnapshot: payload,
		displaySnapshot,
		capturedAt: requiredInstant(envelope.capturedAt),
	}) as VerifiedLegacyApprovalState;
}

function decodePreSubmissionCapture(
	input: CaptureOrdinaryWorkPeriodLegacyPreSubmissionStateInput,
	queryResult: unknown,
): VerifiedLegacyApprovalState {
	const envelope = record(exactlyOne(array(record(queryResult).rows)));
	const period = decodePeriod(exactlyOne(array(envelope.workPeriods)));
	const canonical = decodeCanonical(
		exactlyOne(array(envelope.canonicalRecords)),
	);
	if (
		period.id !== input.workPeriodId ||
		period.organizationId !== input.organizationId ||
		period.employeeId !== input.expectedRequesterEmployeeId ||
		period.approvalStatus !== "pending" ||
		period.deletedAt !== null ||
		period.isActive ||
		period.endTime === null ||
		period.durationMinutes === null ||
		period.durationMinutes < 0 ||
		period.approvalWorkflowId !== null ||
		compareInstants(period.endTime, period.startTime) < 0 ||
		canonical.id !== period.canonicalRecordId ||
		canonical.organizationId !== input.organizationId ||
		canonical.employeeId !== input.expectedRequesterEmployeeId ||
		canonical.recordKind !== "work" ||
		canonical.approvalState !== "pending" ||
		!sameInstant(canonical.startAt, period.startTime) ||
		!sameInstant(canonical.endAt, period.endTime) ||
		canonical.durationMinutes !== period.durationMinutes ||
		array(envelope.approvalRequests).length !== 0 ||
		array(envelope.workflows).length !== 0 ||
		array(envelope.employees).length !== 1 ||
		classifyTimeApprovalRequest({
			metadata: { timeRequest: { kind: input.expectedKind } },
			pendingChanges: period.pendingChanges,
			hasRelationalCorrectionEvidence: false,
		}) !== input.expectedKind
	) {
		return fail();
	}
	const requester = record(array(envelope.employees)[0]);
	if (
		requester.id !== input.expectedRequesterEmployeeId ||
		requester.organizationId !== input.organizationId
	) {
		return fail();
	}
	const payload = parseOrdinaryWorkPeriodWorkflowPayload(
		{ timeRequest: { kind: input.expectedKind } },
		input.expectedKind,
	);
	return normalizeStableData({
		organizationId: input.organizationId,
		source: {
			organizationId: input.organizationId,
			workflowType: input.expectedKind,
			sourceType: "time_entry",
			sourceId: input.workPeriodId,
		},
		approvalRequest: null,
		chain: null,
		chainRows: [],
		sourceSnapshot: payload,
		displaySnapshot: {
			approvalStatus: period.approvalStatus,
			labels: {
				title:
					input.expectedKind === "manual_time_submission"
						? "Manual time submission"
						: "Policy clock-out",
			},
			period: {
				startAt: instantToCanonicalString(period.startTime),
				endAt: instantToCanonicalString(period.endTime),
				durationMinutes: period.durationMinutes,
			},
		},
		capturedAt: input.capturedAt ?? requiredInstant(envelope.capturedAt),
	}) as VerifiedLegacyApprovalState;
}

export async function captureOrdinaryWorkPeriodLegacyState(
	input: CaptureOrdinaryWorkPeriodLegacyStateInput,
): Promise<VerifiedLegacyApprovalState> {
	try {
		parseOrdinaryWorkPeriodWorkflowPayload(
			{ timeRequest: { kind: input.expectedKind } },
			input.expectedKind,
		);
	} catch {
		return fail();
	}
	let queryResult: unknown;
	try {
		queryResult = await input.dbService.db.execute(sql`
			with capture_input as (
				select
					${input.organizationId}::text as organization_id,
					${input.workPeriodId}::uuid as work_period_id,
					${input.expectedKind}::text as expected_kind,
					${input.expectedRequesterEmployeeId}::uuid as requester_employee_id,
					${input.approvalRequestId}::uuid as approval_request_id
			),
			request_rows as (
				select
					request.id,
					request.organization_id as "organizationId",
					request.entity_type as "entityType",
					request.entity_id as "entityId",
					request.requested_by as "requestedBy",
					request.approver_id as "approverId",
					request.status,
					request.reason,
					request.rejection_reason as "rejectionReason",
					request.approved_at as "approvedAt",
					request.metadata,
					request.updated_at as "updatedAt"
				from approval_request request
				cross join capture_input capture
				where request.id = capture.approval_request_id
					and request.organization_id = capture.organization_id
					and request.entity_type = 'time_entry'
					and request.entity_id = capture.work_period_id
					and request.requested_by = capture.requester_employee_id
				limit 2
			),
			work_period_rows as (
				select
					period.id,
					period.organization_id as "organizationId",
					period.employee_id as "employeeId",
					period.start_time as "startTime",
					period.end_time as "endTime",
					period.duration_minutes as "durationMinutes",
					period.is_active as "isActive",
					period.approval_status as "approvalStatus",
					period.pending_changes as "pendingChanges",
					period.deleted_at as "deletedAt",
					period.canonical_record_id as "canonicalRecordId",
					period.approval_workflow_id as "approvalWorkflowId"
				from request_rows request
				cross join capture_input capture
				join work_period period
					on period.id = request."entityId"
					and period.organization_id = capture.organization_id
					and period.employee_id = capture.requester_employee_id
				limit 2
			),
			canonical_rows as (
				select
					record.id,
					record.organization_id as "organizationId",
					record.employee_id as "employeeId",
					record.record_kind as "recordKind",
					record.start_at as "startAt",
					record.end_at as "endAt",
					record.duration_minutes as "durationMinutes",
					record.approval_state as "approvalState"
				from work_period_rows period
				cross join capture_input capture
				join time_record record
					on record.id = period."canonicalRecordId"
					and record.organization_id = capture.organization_id
					and record.employee_id = capture.requester_employee_id
				join time_record_work work
					on work.record_id = record.id
					and work.organization_id = capture.organization_id
					and work.record_kind = 'work'
				limit 2
			),
			request_stage_link_rows as (
				select
					stage.chain_instance_id as "chainInstanceId",
					stage.id as "stageId"
				from request_rows request
				cross join capture_input capture
				join approval_chain_stage_instance stage
					on stage.approval_request_id = request.id
					and stage.organization_id = capture.organization_id
				limit 2
			),
			chain_rows as (
				select
					chain.id,
					chain.organization_id as "organizationId",
					chain.policy_id as "policyId",
					chain.policy_name_snapshot as "policyNameSnapshot",
					chain.entity_type as "entityType",
					chain.entity_id as "entityId",
					chain.requester_employee_id as "requesterEmployeeId",
					chain.current_stage_order as "currentStageOrder",
					chain.status,
					chain.created_at as "createdAt",
					chain.updated_at as "updatedAt",
					chain.completed_at as "completedAt"
				from request_stage_link_rows link
				cross join capture_input capture
				join approval_chain_instance chain
					on chain.id = link."chainInstanceId"
					and chain.organization_id = capture.organization_id
				limit 2
			),
			chain_stage_rows as (
				select
					stage.id,
					stage.organization_id as "organizationId",
					stage.chain_instance_id as "chainInstanceId",
					stage.policy_stage_id as "policyStageId",
					stage.step_order as "stepOrder",
					stage.label_snapshot as "labelSnapshot",
					stage.approver_type_snapshot as "approverTypeSnapshot",
					stage.resolved_approver_employee_id as "resolvedApproverEmployeeId",
					stage.approval_request_id as "approvalRequestId",
					stage.status,
					stage.decided_by as "decidedBy",
					stage.decided_at as "decidedAt",
					stage.created_at as "createdAt",
					stage.updated_at as "updatedAt"
				from chain_rows chain
				cross join capture_input capture
				join approval_chain_stage_instance stage
					on stage.chain_instance_id = chain.id
					and stage.organization_id = capture.organization_id
				order by stage.step_order, stage.id
				limit 101
			),
			workflow_rows as (
				select
					workflow.id,
					workflow.organization_id as "organizationId",
					workflow.workflow_type as "workflowType",
					workflow.source_type as "sourceType",
					workflow.source_id as "sourceId",
					workflow.requester_employee_id as "requesterEmployeeId"
				from work_period_rows period
				cross join capture_input capture
				join approval_workflow workflow
					on workflow.id = period."approvalWorkflowId"
					and workflow.organization_id = capture.organization_id
				limit 2
			),
			required_employee_ids as (
				select "employeeId" as id from work_period_rows
				union select "requestedBy" from request_rows
				union select "approverId" from request_rows
				union select "requesterEmployeeId" from chain_rows
				union select "resolvedApproverEmployeeId" from chain_stage_rows
				union select "decidedBy" from chain_stage_rows where "decidedBy" is not null
			),
			employee_rows as (
				select employee.id, employee.organization_id as "organizationId"
				from required_employee_ids required
				cross join capture_input capture
				join employee
					on employee.id = required.id
					and employee.organization_id = capture.organization_id
			)
			select
				transaction_timestamp() as "capturedAt",
				coalesce((select json_agg(period) from work_period_rows period), '[]'::json) as "workPeriods",
				coalesce((select json_agg(record) from canonical_rows record), '[]'::json) as "canonicalRecords",
				coalesce((select json_agg(request) from request_rows request), '[]'::json) as "approvalRequests",
				coalesce((select json_agg(link) from request_stage_link_rows link), '[]'::json) as "requestStageLinks",
				coalesce((select json_agg(chain) from chain_rows chain), '[]'::json) as chains,
				coalesce((select json_agg(stage) from chain_stage_rows stage), '[]'::json) as "chainRows",
				coalesce((select json_agg(workflow) from workflow_rows workflow), '[]'::json) as workflows,
				coalesce((select json_agg(employee) from employee_rows employee), '[]'::json) as employees
		`);
	} catch {
		return fail("query_failed");
	}
	try {
		return decodeCapture(input, queryResult);
	} catch {
		return fail();
	}
}

export async function captureOrdinaryWorkPeriodLegacyPreSubmissionState(
	input: CaptureOrdinaryWorkPeriodLegacyPreSubmissionStateInput,
): Promise<VerifiedLegacyApprovalState> {
	try {
		parseOrdinaryWorkPeriodWorkflowPayload(
			{ timeRequest: { kind: input.expectedKind } },
			input.expectedKind,
		);
	} catch {
		return fail();
	}
	let queryResult: unknown;
	try {
		queryResult = await input.dbService.db.execute(sql`
			with capture_input as (
				select
					${input.organizationId}::text as organization_id,
					${input.workPeriodId}::uuid as work_period_id,
					${input.expectedRequesterEmployeeId}::uuid as requester_employee_id
			),
			work_period_rows as (
				select
					period.id,
					period.organization_id as "organizationId",
					period.employee_id as "employeeId",
					period.start_time as "startTime",
					period.end_time as "endTime",
					period.duration_minutes as "durationMinutes",
					period.is_active as "isActive",
					period.approval_status as "approvalStatus",
					period.pending_changes as "pendingChanges",
					period.deleted_at as "deletedAt",
					period.canonical_record_id as "canonicalRecordId",
					period.approval_workflow_id as "approvalWorkflowId"
				from capture_input capture
				join work_period period
					on period.id = capture.work_period_id
					and period.organization_id = capture.organization_id
					and period.employee_id = capture.requester_employee_id
				limit 2
			),
			canonical_rows as (
				select
					record.id,
					record.organization_id as "organizationId",
					record.employee_id as "employeeId",
					record.record_kind as "recordKind",
					record.start_at as "startAt",
					record.end_at as "endAt",
					record.duration_minutes as "durationMinutes",
					record.approval_state as "approvalState"
				from work_period_rows period
				cross join capture_input capture
				join time_record record
					on record.id = period."canonicalRecordId"
					and record.organization_id = capture.organization_id
					and record.employee_id = capture.requester_employee_id
					and record.record_kind = 'work'
				limit 2
			),
			request_rows as (
				select request.id
				from capture_input capture
				join approval_request request
					on request.organization_id = capture.organization_id
					and request.entity_type = 'time_entry'
					and request.entity_id = capture.work_period_id
					and request.status = 'pending'
				order by request.id
				limit 2
			),
			workflow_rows as (
				select workflow.id
				from capture_input capture
				join approval_workflow workflow
					on workflow.organization_id = capture.organization_id
					and workflow.source_type = 'time_entry'
					and workflow.source_id = capture.work_period_id
					and workflow.workflow_type in ('manual_time_submission', 'policy_clock_out')
					and workflow.status = 'pending'
				order by workflow.id
				limit 2
			),
			employee_rows as (
				select employee.id, employee.organization_id as "organizationId"
				from capture_input capture
				join employee
					on employee.id = capture.requester_employee_id
					and employee.organization_id = capture.organization_id
				limit 2
			)
			select
				transaction_timestamp() as "capturedAt",
				coalesce((select json_agg(period) from work_period_rows period), '[]'::json) as "workPeriods",
				coalesce((select json_agg(record) from canonical_rows record), '[]'::json) as "canonicalRecords",
				coalesce((select json_agg(request) from request_rows request), '[]'::json) as "approvalRequests",
				coalesce((select json_agg(workflow) from workflow_rows workflow), '[]'::json) as workflows,
				coalesce((select json_agg(employee) from employee_rows employee), '[]'::json) as employees
		`);
	} catch {
		return fail("query_failed");
	}
	try {
		return decodePreSubmissionCapture(input, queryResult);
	} catch {
		return fail();
	}
}
