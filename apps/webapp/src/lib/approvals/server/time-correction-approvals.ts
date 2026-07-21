import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import {
	approvalChainStageInstance,
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowStage,
	employee,
	timeEntry,
	timeRecord,
	workPeriod,
} from "@/db/schema";
import { getAbility } from "@/lib/auth-helpers";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import {
	compareInstants,
	type Instant,
	isInstant,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	type AnyAppError,
	AuthorizationError,
	ConflictError,
	DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import {
	onTimeCorrectionApproved,
	onTimeCorrectionRejected,
} from "@/lib/notifications/triggers";
import {
	calculateTimeCorrectionPeriod,
	dirtyFromDateForTimeCorrection,
	instantFromTimeCorrectionBoundary,
	instantToTimeCorrectionDate,
	type TimeCorrectionTemporalEndpoint,
	validateTimeCorrectionTimezoneEvidence,
} from "@/lib/time-tracking/time-correction-temporal";
import type { TimeEntryTimezoneCapture } from "@/lib/time-tracking/timezone-capture";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import type { ApprovalActionOptions } from "../domain/types";
import { createLegacyApprovalWriteCoordinator } from "../domain-adapters/legacy-write-coordinator";
import {
	normalizeTimeCorrectionWorkflowPayload,
	type TimeCorrectionWorkflowPayload,
} from "../domain-adapters/time-correction-contract";
import {
	captureTimeCorrectionLegacyApprovalState,
	type ExpectedTimeCorrectionLegacyCycle,
} from "../domain-adapters/time-correction-legacy-state";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import {
	ApprovalAuditLogger,
	createApprovalAuditLogger,
} from "../infrastructure/audit-logger";
import {
	type ResolvePolicyAndCreateApprovalResult,
	resolvePolicyAndCreateApproval,
} from "../policies/chain-service";
import { isEligibleManagerForApprovalRequest } from "../policies/manager-eligibility-db";
import type {
	ApprovalPolicyEvaluationContext,
	ApprovalPolicyOvertimeRisk,
} from "../policies/types";
import { classifyTimeApprovalRequest } from "../time-request-kind";
import { deriveApprovalWorkflowId } from "../workflow/identity";
import type { ApprovalWorkflowSnapshot } from "../workflow/ports";
import type { ApprovalWorkflowRepository } from "../workflow/repository";
import { createProductionApprovalWorkflowRuntime } from "../workflow/runtime";
import { startApprovalWorkflow } from "../workflow/start-workflow";
import {
	type ApprovalTransitionEngine,
	ApprovalTransitionEngineError,
} from "../workflow/transition-engine";
import { processApprovalWithCurrentEmployee } from "./shared";
import type {
	ApprovalDbService,
	CurrentApprover,
	PendingApprovalRequest,
} from "./types";
import {
	decideWorkPeriodWithCurrentApproverInTransaction,
	notifyWorkPeriodApprovalAfterCommit,
	type WorkPeriodApprovalResult,
} from "./work-period-approvals";

const logger = createLogger("TimeCorrectionApprovals");

export function translateTimeCorrectionDecisionError(error: unknown): unknown {
	if (!(error instanceof ApprovalTransitionEngineError)) return error;

	switch (error.code) {
		case "forbidden":
			return new AuthorizationError({
				message: "You are not authorized to decide this request",
				resource: "Approval",
				action: "decide",
			});
		case "version_conflict":
		case "idempotency_mismatch":
			return new ConflictError({
				message: "Approval workflow decision conflicts with the current state",
				conflictType: "approval_transition",
				details: { code: error.code },
			});
		case "malformed_command":
			return new ValidationError({
				message: "Approval workflow decision is invalid",
			});
		case "result_scope":
		case "invariant":
		case "activation_cycle":
			return error;
	}
}

interface WorkPeriodRecord {
	id: string;
	employeeId: string;
	clockInId: string;
	clockOutId: string | null;
	organizationId: string;
	canonicalRecordId: string | null;
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
	deletedAt: Date | null;
	employee: {
		userId: string;
		organizationId: string;
		user: {
			name: string;
			email: string;
			image: string | null;
		};
	};
}

interface CorrectionEntry {
	id: string;
	timestamp: Date;
	replacesEntryId: string | null;
	isSuperseded: boolean;
}

type WorkBalanceDirtyMark = {
	employeeId: string;
	organizationId: string;
	dirtyFromDate?: string;
};

export type TimeCorrectionApprovalResult = {
	period: WorkPeriodRecord;
	workBalanceDirtyMark?: WorkBalanceDirtyMark;
};

type AutoCompletedApprovalResult = Extract<
	ResolvePolicyAndCreateApprovalResult,
	{ kind: "auto_completed" }
>;

type TimeCorrectionAutoCompletionResult = TimeCorrectionApprovalResult & {
	originalNotificationTime: Date;
	correctedNotificationTime: Date;
};

export type TimeCorrectionApprovalWorkflowResult =
	| Exclude<ResolvePolicyAndCreateApprovalResult, AutoCompletedApprovalResult>
	| (AutoCompletedApprovalResult & {
			autoCompletion: TimeCorrectionAutoCompletionResult;
	  });

type TimeCorrectionAction = "edit" | "delete";

type TimeCorrectionApprovalMetadata = {
	timeCorrection?: {
		action?: TimeCorrectionAction;
		clockInCorrectionId?: string;
		clockOutCorrectionId?: string;
	};
};

type TimeCorrectionSubmissionResultKind =
	| "default_created"
	| "chain_created"
	| "auto_completed";

type TimeCorrectionSubmissionEvidence = {
	key: string;
	submissionId?: string;
	resultKind: TimeCorrectionSubmissionResultKind;
	originalStatus: "pending" | "approved";
};

function submissionEvidenceFor(
	key: string,
	resultKind: TimeCorrectionSubmissionResultKind,
	submissionId?: string,
): TimeCorrectionSubmissionEvidence {
	return {
		key,
		...(submissionId ? { submissionId } : {}),
		resultKind,
		originalStatus: resultKind === "auto_completed" ? "approved" : "pending",
	};
}

function ownDataValue(record: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor?.enumerable || !("value" in descriptor)) {
		throw new Error("Invalid time correction submission evidence");
	}
	return descriptor.value;
}

function parseSubmissionEvidence(
	metadata: unknown,
	expectedKey: string,
	expectedSubmissionId?: string,
): TimeCorrectionSubmissionEvidence | null {
	if (
		metadata === null ||
		typeof metadata !== "object" ||
		Array.isArray(metadata)
	) {
		return null;
	}
	const descriptor = Object.getOwnPropertyDescriptor(metadata, "submission");
	if (!descriptor) return null;
	if (!descriptor.enumerable || !("value" in descriptor)) {
		throw new Error("Invalid time correction submission evidence");
	}
	const submission = descriptor.value;
	if (
		submission === null ||
		typeof submission !== "object" ||
		Array.isArray(submission) ||
		(Object.getPrototypeOf(submission) !== Object.prototype &&
			Object.getPrototypeOf(submission) !== null)
	) {
		throw new Error("Invalid time correction submission evidence");
	}
	const keys = Reflect.ownKeys(submission);
	const hasSubmissionId = Object.hasOwn(submission, "submissionId");
	if (
		keys.length !== (hasSubmissionId ? 4 : 3) ||
		keys.some(
			(key) =>
				typeof key !== "string" ||
				!(
					["key", "submissionId", "resultKind", "originalStatus"] as const
				).includes(
					key as "key" | "submissionId" | "resultKind" | "originalStatus",
				),
		)
	) {
		throw new Error("Invalid time correction submission evidence");
	}
	const key = ownDataValue(submission, "key");
	const submissionId = hasSubmissionId
		? ownDataValue(submission, "submissionId")
		: undefined;
	const resultKind = ownDataValue(submission, "resultKind");
	const originalStatus = ownDataValue(submission, "originalStatus");
	if (
		key !== expectedKey ||
		(expectedSubmissionId !== undefined &&
			submissionId !== expectedSubmissionId) ||
		(submissionId !== undefined &&
			(typeof submissionId !== "string" ||
				!SUBMISSION_UUID.test(submissionId))) ||
		(resultKind !== "default_created" &&
			resultKind !== "chain_created" &&
			resultKind !== "auto_completed") ||
		(originalStatus !== "pending" && originalStatus !== "approved") ||
		(resultKind === "auto_completed") !== (originalStatus === "approved")
	) {
		throw new Error("Invalid time correction submission evidence");
	}
	return {
		key: key as string,
		...(typeof submissionId === "string" ? { submissionId } : {}),
		resultKind: resultKind as TimeCorrectionSubmissionResultKind,
		originalStatus: originalStatus as "pending" | "approved",
	};
}

const SUBMISSION_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function submissionKeyFromMetadata(metadata: unknown): string | null {
	if (
		metadata === null ||
		typeof metadata !== "object" ||
		Array.isArray(metadata)
	) {
		return null;
	}
	const descriptor = Object.getOwnPropertyDescriptor(metadata, "submission");
	if (!descriptor) return null;
	if (!descriptor.enumerable || !("value" in descriptor)) {
		throw new Error("Invalid time correction submission evidence");
	}
	const submission = descriptor.value;
	if (
		submission === null ||
		typeof submission !== "object" ||
		Array.isArray(submission) ||
		(Object.getPrototypeOf(submission) !== Object.prototype &&
			Object.getPrototypeOf(submission) !== null)
	) {
		throw new Error("Invalid time correction submission evidence");
	}
	const key = ownDataValue(submission, "key");
	if (typeof key !== "string" || key.length === 0) {
		throw new Error("Invalid time correction submission evidence");
	}
	const evidence = parseSubmissionEvidence(metadata, key);
	if (!evidence) {
		throw new Error("Invalid time correction submission evidence");
	}
	return evidence.key;
}

function submissionIdFromMetadata(metadata: unknown): string | null {
	const key = submissionKeyFromMetadata(metadata);
	if (!key) return null;
	return parseSubmissionEvidence(metadata, key)?.submissionId ?? null;
}

function cancelledChainInstanceIdFromMetadata(input: {
	metadata: unknown;
	organizationId: string;
	requesterEmployeeId: string;
	requesterUserId: string;
	workPeriodId: string;
}): string | null {
	if (
		input.metadata === null ||
		typeof input.metadata !== "object" ||
		Array.isArray(input.metadata)
	) {
		return null;
	}
	const descriptor = Object.getOwnPropertyDescriptor(
		input.metadata,
		"cancellation",
	);
	if (!descriptor) return null;
	if (!descriptor.enumerable || !("value" in descriptor)) {
		throw new Error("Invalid time correction cancellation evidence");
	}
	const cancellation = descriptor.value;
	if (
		cancellation === null ||
		typeof cancellation !== "object" ||
		Array.isArray(cancellation) ||
		(Object.getPrototypeOf(cancellation) !== Object.prototype &&
			Object.getPrototypeOf(cancellation) !== null)
	) {
		throw new Error("Invalid time correction cancellation evidence");
	}
	const expectedKeys = [
		"kind",
		"organizationId",
		"requesterEmployeeId",
		"requesterUserId",
		"workPeriodId",
		"chainInstanceId",
		"cancelledAt",
	];
	const keys = Reflect.ownKeys(cancellation);
	if (
		keys.length !== expectedKeys.length ||
		keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
	) {
		throw new Error("Invalid time correction cancellation evidence");
	}
	const chainInstanceId = ownDataValue(cancellation, "chainInstanceId");
	const cancelledAt = ownDataValue(cancellation, "cancelledAt");
	if (
		ownDataValue(cancellation, "kind") !== "requester" ||
		ownDataValue(cancellation, "organizationId") !== input.organizationId ||
		ownDataValue(cancellation, "requesterEmployeeId") !==
			input.requesterEmployeeId ||
		ownDataValue(cancellation, "requesterUserId") !== input.requesterUserId ||
		ownDataValue(cancellation, "workPeriodId") !== input.workPeriodId ||
		typeof chainInstanceId !== "string" ||
		!SUBMISSION_UUID.test(chainInstanceId) ||
		typeof cancelledAt !== "string"
	) {
		throw new Error("Invalid time correction cancellation evidence");
	}
	parseInstant(cancelledAt);
	return chainInstanceId;
}

type HistoricalAutoApprovalEvidence =
	| "absent"
	| "requester_auto_approved"
	| "invalid";

function parseHistoricalAutoApprovalEvidence(
	metadata: unknown,
): HistoricalAutoApprovalEvidence {
	if (
		metadata === null ||
		typeof metadata !== "object" ||
		Array.isArray(metadata)
	) {
		return "invalid";
	}
	const descriptor = Object.getOwnPropertyDescriptor(metadata, "autoApproval");
	if (!descriptor) return "absent";
	if (!descriptor.enumerable || !("value" in descriptor)) return "invalid";
	const value = descriptor.value;
	if (
		value === null ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		(Object.getPrototypeOf(value) !== Object.prototype &&
			Object.getPrototypeOf(value) !== null)
	) {
		return "invalid";
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== 1 || keys[0] !== "reason") return "invalid";
	const reason = Object.getOwnPropertyDescriptor(value, "reason");
	if (!reason?.enumerable || !("value" in reason)) return "invalid";
	return reason.value === "requester_is_approver"
		? "requester_auto_approved"
		: "invalid";
}

export interface FinalizeTimeCorrectionTerminalInput {
	dbService: ApprovalDbService;
	organizationId: string;
	workPeriodId: string;
	expectedApprovalWorkflowId: string | null;
	expectedApprovalWorkflowVersion: number | null;
	expectedRequesterEmployeeId: string;
	actorEmployeeId: string;
	actorUserId: string;
	correction: TimeCorrectionWorkflowPayload["timeCorrection"];
	legacyApprovalRequestId: string | null;
	transition:
		| { kind: "approve"; reason: string | null }
		| { kind: "reject"; reason: string };
	finalizedAt: Instant;
	allowMetadataLessLegacyFallback: boolean;
}

export interface TimeCorrectionTerminalResult {
	transition: "approved" | "rejected";
	requesterEmployeeId: string;
	dirtyFromDate: string | null;
}

interface TimeCorrectionWorkflowBindingInput {
	dbService: ApprovalDbService;
	organizationId: string;
	workPeriodId: string;
	employeeId: string;
	workflowId: string;
}

interface TimeCorrectionWorkflowBindingRow {
	id: string;
	organizationId: string;
	workflowType: string;
	sourceType: string;
	sourceId: string;
	requesterEmployeeId: string | null;
	status: string;
	version: number;
	submittedAt: Date;
	completedAt: Date | null;
	cancelledAt: Date | null;
	currentStageOrder: number | null;
}

function timeCorrectionWorkflowBindingConflict(): Error {
	return new Error("Time correction workflow binding conflict");
}

function exactTimeCorrectionBindingWorkflow(
	workflow: TimeCorrectionWorkflowBindingRow | null | undefined,
	input: TimeCorrectionWorkflowBindingInput,
): TimeCorrectionWorkflowBindingRow {
	if (
		!workflow ||
		workflow.id !== input.workflowId ||
		workflow.organizationId !== input.organizationId ||
		workflow.workflowType !== "time_correction" ||
		workflow.sourceType !== "time_entry" ||
		workflow.sourceId !== input.workPeriodId ||
		workflow.requesterEmployeeId !== input.employeeId ||
		!isValidBoundaryDate(workflow.submittedAt)
	) {
		throw timeCorrectionWorkflowBindingConflict();
	}
	return workflow;
}

function validateTerminalTimeCorrectionBindingWorkflow(
	workflow: TimeCorrectionWorkflowBindingRow,
): Instant {
	const terminal =
		workflow.status === "approved" ||
		workflow.status === "rejected" ||
		workflow.status === "cancelled" ||
		workflow.status === "expired";
	if (
		!terminal ||
		!Number.isSafeInteger(workflow.version) ||
		workflow.version < 1 ||
		workflow.currentStageOrder !== null ||
		!isValidBoundaryDate(workflow.completedAt) ||
		(workflow.status === "cancelled") !==
			isValidBoundaryDate(workflow.cancelledAt)
	) {
		throw timeCorrectionWorkflowBindingConflict();
	}
	const submittedAt = instantFromTimeCorrectionBoundary(workflow.submittedAt);
	const completedAt = instantFromTimeCorrectionBoundary(workflow.completedAt);
	if (
		compareInstants(completedAt, submittedAt) < 0 ||
		(workflow.cancelledAt &&
			compareInstants(
				instantFromTimeCorrectionBoundary(workflow.cancelledAt),
				submittedAt,
			) < 0)
	) {
		throw timeCorrectionWorkflowBindingConflict();
	}
	return completedAt;
}

async function lockTimeCorrectionBindingSource(
	input: TimeCorrectionWorkflowBindingInput,
) {
	const rows = await input.dbService.db
		.select({
			id: workPeriod.id,
			organizationId: workPeriod.organizationId,
			employeeId: workPeriod.employeeId,
			approvalWorkflowId: workPeriod.approvalWorkflowId,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
			),
		)
		.for("update");
	const source = rows[0];
	if (
		rows.length !== 1 ||
		!source ||
		source.id !== input.workPeriodId ||
		source.organizationId !== input.organizationId ||
		source.employeeId !== input.employeeId
	) {
		throw timeCorrectionWorkflowBindingConflict();
	}
	return source;
}

async function loadTimeCorrectionBindingWorkflow(
	input: TimeCorrectionWorkflowBindingInput,
): Promise<TimeCorrectionWorkflowBindingRow> {
	const workflow = (await input.dbService.db.query.approvalWorkflow.findFirst({
		where: and(
			eq(approvalWorkflow.id, input.workflowId),
			eq(approvalWorkflow.organizationId, input.organizationId),
		),
	})) as TimeCorrectionWorkflowBindingRow | null;
	return exactTimeCorrectionBindingWorkflow(workflow, input);
}

export async function verifyTimeCorrectionWorkflowBinding(
	input: TimeCorrectionWorkflowBindingInput,
): Promise<void> {
	const source = await lockTimeCorrectionBindingSource(input);
	if (source.approvalWorkflowId !== input.workflowId) {
		throw timeCorrectionWorkflowBindingConflict();
	}
	await loadTimeCorrectionBindingWorkflow(input);
}

export async function bindTimeCorrectionWorkflowToWorkPeriod(
	input: TimeCorrectionWorkflowBindingInput,
): Promise<void> {
	const source = await lockTimeCorrectionBindingSource(input);
	const nextWorkflow = await loadTimeCorrectionBindingWorkflow(input);
	if (source.approvalWorkflowId === input.workflowId) return;

	if (source.approvalWorkflowId) {
		const currentInput = {
			...input,
			workflowId: source.approvalWorkflowId,
		};
		const currentWorkflow =
			await loadTimeCorrectionBindingWorkflow(currentInput);
		const currentCompletedAt =
			validateTerminalTimeCorrectionBindingWorkflow(currentWorkflow);
		if (
			compareInstants(
				instantFromTimeCorrectionBoundary(nextWorkflow.submittedAt),
				currentCompletedAt,
			) < 0
		) {
			throw timeCorrectionWorkflowBindingConflict();
		}
	}

	const updated = await input.dbService.db
		.update(workPeriod)
		.set({ approvalWorkflowId: input.workflowId })
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
				source.approvalWorkflowId === null
					? isNull(workPeriod.approvalWorkflowId)
					: eq(workPeriod.approvalWorkflowId, source.approvalWorkflowId),
			),
		)
		.returning({
			id: workPeriod.id,
			organizationId: workPeriod.organizationId,
			employeeId: workPeriod.employeeId,
			approvalWorkflowId: workPeriod.approvalWorkflowId,
		});
	const row = updated[0];
	if (
		updated.length !== 1 ||
		row?.id !== input.workPeriodId ||
		row.organizationId !== input.organizationId ||
		row.employeeId !== input.employeeId ||
		row.approvalWorkflowId !== input.workflowId
	) {
		throw timeCorrectionWorkflowBindingConflict();
	}
}

export async function insertTimeCorrectionSourceEntry(input: {
	dbService: ApprovalDbService;
	id: string;
	employeeId: string;
	organizationId: string;
	timestamp: Date;
	hash: string;
	previousHash: string | null;
	previousEntryId: string | null;
	replacesEntryId: string;
	notes: string;
	createdBy: string;
	ipAddress: string | null;
	deviceInfo: string | null;
	location?: string | null;
	timezoneCapture: TimeEntryTimezoneCapture;
}): Promise<typeof timeEntry.$inferSelect | null> {
	const [created] = await input.dbService.db
		.insert(timeEntry)
		.values({
			...input.timezoneCapture,
			id: input.id,
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			type: "correction",
			timestamp: input.timestamp,
			hash: input.hash,
			previousHash: input.previousHash,
			previousEntryId: input.previousEntryId,
			replacesEntryId: input.replacesEntryId,
			isSuperseded: true,
			supersededById: null,
			notes: input.notes,
			location: input.location ?? null,
			ipAddress: input.ipAddress,
			deviceInfo: input.deviceInfo,
			createdBy: input.createdBy,
		})
		.returning();
	return created ?? null;
}

export interface CancelledTimeCorrectionEntryEvidence {
	id: string;
	organizationId: string;
	employeeId: string;
	logicalRole: "clock_in" | "clock_out";
	type: "clock_in" | "clock_out" | "correction";
	replacesEntryId: string | null;
	timestamp: Instant;
	utcOffsetMinutes: number;
	timezone: string;
	timezoneSource: string;
	isSuperseded: boolean;
	supersededById: string | null;
}

export interface CancelledTimeCorrectionSourceEvidence {
	employeeId: string;
	approvalWorkflowId: string | null;
	canonicalRecordId: string;
	clockInId: string;
	clockOutId: string | null;
	startTime: Instant;
	endTime: Instant | null;
	durationMinutes: number | null;
	isActive: boolean;
	approvalStatus: "approved";
	pendingChanges: null;
	canonicalRecord: {
		id: string;
		employeeId: string;
		recordKind: "work";
		startAt: Instant;
		endAt: Instant | null;
		durationMinutes: number | null;
		approvalState: "approved";
	};
	currentEndpoints: {
		clockIn: CancelledTimeCorrectionEntryEvidence;
		clockOut: CancelledTimeCorrectionEntryEvidence | null;
	};
	pendingCorrections: {
		clockIn: CancelledTimeCorrectionEntryEvidence | null;
		clockOut: CancelledTimeCorrectionEntryEvidence | null;
	};
}

function sameExpectedInstant(
	actual: Date | null,
	expected: Instant | null,
): boolean {
	if (actual === null || expected === null)
		return actual === null && expected === null;
	try {
		return (
			isInstant(expected) &&
			compareInstants(instantFromTimeCorrectionBoundary(actual), expected) === 0
		);
	} catch {
		return false;
	}
}

function assertCancellationEntryEvidence(
	entry: LockedTimeCorrectionEntry | undefined,
	expected: CancelledTimeCorrectionEntryEvidence | null,
	logicalRole: "clock_in" | "clock_out",
): void {
	if (
		!entry ||
		!expected ||
		expected.logicalRole !== logicalRole ||
		entry.id !== expected.id ||
		entry.organizationId !== expected.organizationId ||
		entry.employeeId !== expected.employeeId ||
		entry.type !== expected.type ||
		!sameExpectedInstant(entry.timestamp, expected.timestamp) ||
		entry.utcOffsetMinutes !== expected.utcOffsetMinutes ||
		entry.timezone !== expected.timezone ||
		entry.timezoneSource !== expected.timezoneSource ||
		entry.replacesEntryId !== expected.replacesEntryId ||
		entry.isSuperseded !== expected.isSuperseded ||
		entry.supersededById !== expected.supersededById
	) {
		throw new Error("Time correction cancellation entry evidence is invalid");
	}
}

export async function deleteCancelledTimeCorrectionsInTransaction(input: {
	dbService: ApprovalDbService;
	organizationId: string;
	workPeriodId: string;
	expectedSource: CancelledTimeCorrectionSourceEvidence;
	correction: TimeCorrectionWorkflowPayload["timeCorrection"];
}): Promise<void> {
	const expected = input.expectedSource;
	let correction: TimeCorrectionWorkflowPayload["timeCorrection"];
	try {
		correction = normalizeTimeCorrectionWorkflowPayload({
			timeCorrection: input.correction,
		}).timeCorrection;
	} catch {
		throw new Error("Time correction cancellation evidence is invalid");
	}
	const employeeRows = await input.dbService.db
		.select({
			id: employee.id,
			organizationId: employee.organizationId,
			isActive: employee.isActive,
		})
		.from(employee)
		.where(
			and(
				eq(employee.id, expected.employeeId),
				eq(employee.organizationId, input.organizationId),
				eq(employee.isActive, true),
			),
		)
		.for("update");
	const lockedEmployee = employeeRows[0];
	if (
		employeeRows.length !== 1 ||
		!lockedEmployee ||
		lockedEmployee.id !== expected.employeeId ||
		lockedEmployee.organizationId !== input.organizationId ||
		lockedEmployee.isActive !== true
	) {
		throw new Error("Time correction cancellation source is invalid");
	}
	const periodRows = await input.dbService.db
		.select({
			id: workPeriod.id,
			organizationId: workPeriod.organizationId,
			employeeId: workPeriod.employeeId,
			clockInId: workPeriod.clockInId,
			clockOutId: workPeriod.clockOutId,
			canonicalRecordId: workPeriod.canonicalRecordId,
			approvalWorkflowId: workPeriod.approvalWorkflowId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
			isActive: workPeriod.isActive,
			approvalStatus: workPeriod.approvalStatus,
			pendingChanges: workPeriod.pendingChanges,
			deletedAt: workPeriod.deletedAt,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, expected.employeeId),
				expected.approvalWorkflowId === null
					? isNull(workPeriod.approvalWorkflowId)
					: eq(workPeriod.approvalWorkflowId, expected.approvalWorkflowId),
			),
		)
		.for("update");
	const period = periodRows[0];
	if (
		periodRows.length !== 1 ||
		!period ||
		period.id !== input.workPeriodId ||
		period.organizationId !== input.organizationId ||
		period.employeeId !== expected.employeeId ||
		period.approvalWorkflowId !== expected.approvalWorkflowId ||
		period.canonicalRecordId !== expected.canonicalRecordId ||
		period.clockInId !== expected.clockInId ||
		period.clockOutId !== expected.clockOutId ||
		!sameExpectedInstant(period.startTime, expected.startTime) ||
		!sameExpectedInstant(period.endTime, expected.endTime) ||
		period.durationMinutes !== expected.durationMinutes ||
		period.isActive !== expected.isActive ||
		period.isActive !== (period.clockOutId === null) ||
		period.approvalStatus !== "approved" ||
		expected.approvalStatus !== "approved" ||
		period.pendingChanges !== null ||
		expected.pendingChanges !== null ||
		period.deletedAt !== null ||
		(correction.clockOutCorrectionId !== undefined && !period.clockOutId)
	) {
		throw new Error("Time correction cancellation source is invalid");
	}
	const correctionEntries = [
		...(correction.clockInCorrectionId
			? [
					{
						id: correction.clockInCorrectionId,
						originalId: period.clockInId,
					},
				]
			: []),
		...(correction.clockOutCorrectionId && period.clockOutId
			? [
					{
						id: correction.clockOutCorrectionId,
						originalId: period.clockOutId,
					},
				]
			: []),
	];
	const entryIds = [
		period.clockInId,
		period.clockOutId,
		...correctionEntries.map((entry) => entry.id),
	].filter((id): id is string => Boolean(id));
	if (new Set(entryIds).size !== entryIds.length) {
		throw new Error("Time correction cancellation lineage is invalid");
	}
	const entries = (await input.dbService.db
		.select({
			id: timeEntry.id,
			organizationId: timeEntry.organizationId,
			employeeId: timeEntry.employeeId,
			type: timeEntry.type,
			timestamp: timeEntry.timestamp,
			utcOffsetMinutes: timeEntry.utcOffsetMinutes,
			timezone: timeEntry.timezone,
			timezoneSource: timeEntry.timezoneSource,
			replacesEntryId: timeEntry.replacesEntryId,
			isSuperseded: timeEntry.isSuperseded,
			supersededById: timeEntry.supersededById,
		})
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, input.organizationId),
				eq(timeEntry.employeeId, expected.employeeId),
				inArray(timeEntry.id, entryIds),
			),
		)
		.orderBy(asc(timeEntry.id))
		.for("update")) as LockedTimeCorrectionEntry[];
	if (entries.length !== entryIds.length) {
		throw new Error("Time correction cancellation entries are invalid");
	}
	const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
	if (entriesById.size !== entryIds.length) {
		throw new Error("Time correction cancellation entries are invalid");
	}
	assertCancellationEntryEvidence(
		entriesById.get(expected.clockInId),
		expected.currentEndpoints.clockIn,
		"clock_in",
	);
	if (expected.clockOutId === null) {
		if (expected.currentEndpoints.clockOut !== null) {
			throw new Error("Time correction cancellation entry evidence is invalid");
		}
	} else {
		assertCancellationEntryEvidence(
			entriesById.get(expected.clockOutId),
			expected.currentEndpoints.clockOut,
			"clock_out",
		);
	}
	if (correction.clockInCorrectionId === undefined) {
		if (expected.pendingCorrections.clockIn !== null) {
			throw new Error("Time correction cancellation entry evidence is invalid");
		}
	} else {
		assertCancellationEntryEvidence(
			entriesById.get(correction.clockInCorrectionId),
			expected.pendingCorrections.clockIn,
			"clock_in",
		);
	}
	if (correction.clockOutCorrectionId === undefined) {
		if (expected.pendingCorrections.clockOut !== null) {
			throw new Error("Time correction cancellation entry evidence is invalid");
		}
	} else {
		assertCancellationEntryEvidence(
			entriesById.get(correction.clockOutCorrectionId),
			expected.pendingCorrections.clockOut,
			"clock_out",
		);
	}
	try {
		const currentClockIn = entriesById.get(period.clockInId);
		const currentClockOut = period.clockOutId
			? entriesById.get(period.clockOutId)
			: undefined;
		const endpoints = [
			{
				entry: currentClockIn,
				id: period.clockInId,
				type: "clock_in" as const,
			},
			...(period.clockOutId
				? [
						{
							entry: currentClockOut,
							id: period.clockOutId,
							type: "clock_out" as const,
						},
					]
				: []),
		];
		const predecessorsById = await lockCurrentEndpointPredecessors({
			dbService: input.dbService,
			organizationId: input.organizationId,
			employeeId: expected.employeeId,
			endpoints,
		});
		for (const endpoint of endpoints) {
			validateCurrentEndpoint(
				endpoint.entry,
				endpoint.entry?.replacesEntryId
					? predecessorsById.get(endpoint.entry.replacesEntryId)
					: undefined,
				{
					id: endpoint.id,
					organizationId: input.organizationId,
					employeeId: expected.employeeId,
					type: endpoint.type,
					requireActive: true,
				},
			);
		}
	} catch {
		throw new Error("Time correction cancellation lineage is invalid");
	}
	const canonicalRows = (await input.dbService.db
		.select({
			id: timeRecord.id,
			organizationId: timeRecord.organizationId,
			employeeId: timeRecord.employeeId,
			recordKind: timeRecord.recordKind,
			startAt: timeRecord.startAt,
			endAt: timeRecord.endAt,
			durationMinutes: timeRecord.durationMinutes,
			approvalState: timeRecord.approvalState,
		})
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.id, expected.canonicalRecordId),
				eq(timeRecord.organizationId, input.organizationId),
				eq(timeRecord.employeeId, expected.employeeId),
				eq(timeRecord.recordKind, "work"),
			),
		)
		.for("update")) as LockedCanonicalWorkRecord[];
	const canonical = canonicalRows[0];
	const expectedCanonical = expected.canonicalRecord;
	if (
		canonicalRows.length !== 1 ||
		!canonical ||
		canonical.id !== expected.canonicalRecordId ||
		canonical.id !== expectedCanonical.id ||
		canonical.organizationId !== input.organizationId ||
		canonical.employeeId !== expected.employeeId ||
		canonical.employeeId !== expectedCanonical.employeeId ||
		canonical.recordKind !== "work" ||
		expectedCanonical.recordKind !== "work" ||
		!sameExpectedInstant(canonical.startAt, expectedCanonical.startAt) ||
		!sameExpectedInstant(canonical.endAt, expectedCanonical.endAt) ||
		canonical.durationMinutes !== expectedCanonical.durationMinutes ||
		canonical.approvalState !== "approved" ||
		expectedCanonical.approvalState !== "approved" ||
		!sameExpectedInstant(canonical.startAt, expected.startTime) ||
		!sameExpectedInstant(canonical.endAt, expected.endTime) ||
		canonical.durationMinutes !== expected.durationMinutes ||
		canonical.approvalState !== expected.approvalStatus
	) {
		throw new Error("Time correction cancellation source is invalid");
	}
	for (const expected of correctionEntries) {
		const pending = entriesById.get(expected.id);
		if (
			!pending ||
			pending.organizationId !== input.organizationId ||
			pending.employeeId !== input.expectedSource.employeeId ||
			pending.type !== "correction" ||
			pending.replacesEntryId !== expected.originalId ||
			!pending.isSuperseded ||
			pending.supersededById !== null
		) {
			throw new Error("Time correction cancellation lineage is invalid");
		}
	}

	for (const expected of correctionEntries) {
		const deleted = await input.dbService.db
			.delete(timeEntry)
			.where(
				and(
					eq(timeEntry.id, expected.id),
					eq(timeEntry.organizationId, input.organizationId),
					eq(timeEntry.employeeId, input.expectedSource.employeeId),
					eq(timeEntry.type, "correction"),
					eq(timeEntry.replacesEntryId, expected.originalId),
					eq(timeEntry.isSuperseded, true),
					isNull(timeEntry.supersededById),
				),
			)
			.returning({ id: timeEntry.id });
		if (deleted.length !== 1 || deleted[0]?.id !== expected.id) {
			throw new Error("Time correction cancellation delete conflict");
		}
	}
}

interface LockedTimeCorrectionPeriod {
	id: string;
	organizationId: string;
	employeeId: string;
	clockInId: string;
	clockOutId: string | null;
	canonicalRecordId: string | null;
	approvalWorkflowId: string | null;
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
	isActive: boolean;
	approvalStatus: "pending" | "approved" | "rejected";
	pendingChanges: unknown;
	deletedAt: Date | null;
}

interface LockedTimeCorrectionEntry {
	id: string;
	organizationId: string;
	employeeId: string;
	type: "clock_in" | "clock_out" | "correction";
	timestamp: Date;
	utcOffsetMinutes: number;
	timezone: string | null;
	timezoneSource: string;
	replacesEntryId: string | null;
	isSuperseded: boolean;
	supersededById: string | null;
}

interface LockedCanonicalWorkRecord {
	id: string;
	organizationId: string;
	employeeId: string;
	recordKind: string;
	startAt: Date;
	endAt: Date | null;
	durationMinutes: number | null;
	approvalState: "draft" | "pending" | "approved" | "rejected";
}

interface PersistedLegacyTimeCorrectionApproval {
	id: string;
	organizationId: string;
	entityType: string;
	entityId: string;
	requestedBy: string;
	status: "pending" | "approved" | "rejected";
	approvedAt: Date | null;
	rejectionReason: string | null;
	metadata: unknown;
}

interface PersistedCanonicalTimeCorrectionWorkflow {
	id: string;
	organizationId: string;
	workflowType: string;
	sourceType: string;
	sourceId: string;
	requesterEmployeeId: string | null;
	status: string;
	version: number;
	contextSnapshot: unknown;
	completedAt: Date | null;
}

interface FinalizerEmployee {
	id: string;
	organizationId: string;
	userId: string;
	isActive: boolean;
	user: {
		id?: string;
		name: string;
		email: string;
		image: string | null;
	};
}

interface TimeCorrectionTerminalDetailedResult
	extends TimeCorrectionTerminalResult {
	period: WorkPeriodRecord;
	originalNotificationTime: Date;
	correctedNotificationTime: Date;
}

const TIME_CORRECTION_TIMEZONE_SOURCES = new Set([
	"browser",
	"user_setting",
	"manager_target_user_setting",
	"historical_inference",
	"backfill",
]);

function timeCorrectionFinalizationConflict(): ConflictError {
	return new ConflictError({
		message: "Time correction source changed during finalization",
		conflictType: "time_correction_finalization_conflict",
	});
}

function requireSingleMutation(
	rows: readonly { id: string }[],
	expectedId: string,
): void {
	if (rows.length !== 1 || rows[0]?.id !== expectedId) {
		throw timeCorrectionFinalizationConflict();
	}
}

function sameDatabaseInstant(left: Date | null, right: Date | null): boolean {
	if (left === null || right === null) return left === right;
	return (
		compareInstants(
			instantFromTimeCorrectionBoundary(left),
			instantFromTimeCorrectionBoundary(right),
		) === 0
	);
}

function sameCorrectionPayload(
	value: unknown,
	expected: TimeCorrectionWorkflowPayload["timeCorrection"],
): boolean {
	try {
		const correction = ownEnumerableDataProperty(value, "timeCorrection");
		if (!correction) return false;
		const actual = normalizeTimeCorrectionWorkflowPayload({
			timeCorrection: correction.value,
		}).timeCorrection;
		return (
			actual.action === expected.action &&
			actual.clockInCorrectionId === expected.clockInCorrectionId &&
			actual.clockOutCorrectionId === expected.clockOutCorrectionId
		);
	} catch {
		return false;
	}
}

function correctionPayload(
	value: unknown,
): TimeCorrectionWorkflowPayload["timeCorrection"] {
	const correction = ownEnumerableDataProperty(value, "timeCorrection");
	return normalizeTimeCorrectionWorkflowPayload({
		timeCorrection: correction?.value,
	}).timeCorrection;
}

function ownEnumerableDataProperty(
	value: unknown,
	key: string,
): { value: unknown } | null {
	try {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return null;
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return descriptor?.enumerable && "value" in descriptor
			? { value: descriptor.value }
			: null;
	} catch {
		return null;
	}
}

function sameCanonicalCorrectionContext(
	value: unknown,
	expected: TimeCorrectionWorkflowPayload["timeCorrection"],
): boolean {
	const correction = ownEnumerableDataProperty(value, "timeCorrection");
	return correction !== null
		? sameCorrectionPayload({ timeCorrection: correction.value }, expected)
		: false;
}

function sameCanonicalCompatibilityMetadata(
	value: unknown,
	expected: TimeCorrectionWorkflowPayload["timeCorrection"],
	expectedWorkflowId: string,
	expectedOrganizationId: string,
): boolean {
	const correction = ownEnumerableDataProperty(value, "timeCorrection");
	const workflow = ownEnumerableDataProperty(value, "workflow");
	if (!correction || !workflow) return false;
	const workflowId = ownEnumerableDataProperty(workflow.value, "id");
	const workflowOrganizationId = ownEnumerableDataProperty(
		workflow.value,
		"organizationId",
	);
	return (
		workflowId?.value === expectedWorkflowId &&
		workflowOrganizationId?.value === expectedOrganizationId &&
		sameCorrectionPayload({ timeCorrection: correction.value }, expected)
	);
}

function isValidBoundaryDate(value: unknown): value is Date {
	if (!(value instanceof Date)) return false;
	try {
		instantFromTimeCorrectionBoundary(value);
		return true;
	} catch {
		return false;
	}
}

async function validatePersistedTimeCorrectionEvidence(input: {
	dbService: ApprovalDbService;
	organizationId: string;
	workPeriodId: string;
	periodEmployeeId: string;
	expectedRequesterEmployeeId: string;
	expectedApprovalWorkflowId: string | null;
	expectedApprovalWorkflowVersion: number | null;
	legacyApprovalRequestId: string | null;
	correction: TimeCorrectionWorkflowPayload["timeCorrection"];
	transition: FinalizeTimeCorrectionTerminalInput["transition"];
	allowMetadataLessLegacyFallback: boolean;
	allowObservedLegacyMetadata: boolean;
}): Promise<void> {
	const hasCanonicalWorkflow = input.expectedApprovalWorkflowId !== null;
	const hasCanonicalVersion = input.expectedApprovalWorkflowVersion !== null;
	if (
		!input.expectedRequesterEmployeeId ||
		input.expectedRequesterEmployeeId !== input.periodEmployeeId ||
		hasCanonicalWorkflow !== hasCanonicalVersion ||
		(input.expectedApprovalWorkflowVersion !== null &&
			(!Number.isSafeInteger(input.expectedApprovalWorkflowVersion) ||
				input.expectedApprovalWorkflowVersion < 1)) ||
		(!input.legacyApprovalRequestId && !input.expectedApprovalWorkflowId)
	) {
		throw timeCorrectionFinalizationConflict();
	}

	let legacyRequester: string | null = null;
	let legacyTerminalLifecycle = false;
	if (input.legacyApprovalRequestId) {
		const request = (await input.dbService.db.query.approvalRequest.findFirst({
			where: and(
				eq(approvalRequest.id, input.legacyApprovalRequestId),
				eq(approvalRequest.organizationId, input.organizationId),
			),
		})) as PersistedLegacyTimeCorrectionApproval | null;
		const expectedStatus =
			input.transition.kind === "approve" ? "approved" : "rejected";
		const validTerminalLifecycle =
			request?.status === expectedStatus &&
			(input.transition.kind === "approve"
				? isValidBoundaryDate(request.approvedAt)
				: request.approvedAt === null ||
					isValidBoundaryDate(request.approvedAt)) &&
			(input.transition.kind === "approve"
				? request.rejectionReason === null
				: request.rejectionReason === input.transition.reason);
		const validPendingCompatibilityLifecycle =
			hasCanonicalWorkflow &&
			request?.status === "pending" &&
			request.approvedAt === null &&
			request.rejectionReason === null;
		if (
			!request ||
			request.id !== input.legacyApprovalRequestId ||
			request.organizationId !== input.organizationId ||
			request.entityType !== "time_entry" ||
			request.entityId !== input.workPeriodId ||
			request.requestedBy !== input.periodEmployeeId ||
			request.requestedBy !== input.expectedRequesterEmployeeId ||
			(!validTerminalLifecycle && !validPendingCompatibilityLifecycle)
		) {
			throw timeCorrectionFinalizationConflict();
		}
		legacyRequester = request.requestedBy;
		legacyTerminalLifecycle = validTerminalLifecycle;
		const metadataLessHistoricalRejection =
			request.metadata === null &&
			input.transition.kind === "reject" &&
			input.allowMetadataLessLegacyFallback &&
			input.expectedApprovalWorkflowId === null;
		const validMetadata = input.allowObservedLegacyMetadata
			? sameCorrectionPayload(request.metadata, input.correction)
			: input.expectedApprovalWorkflowId !== null
				? sameCanonicalCompatibilityMetadata(
						request.metadata,
						input.correction,
						input.expectedApprovalWorkflowId,
						input.organizationId,
					)
				: sameCorrectionPayload(request.metadata, input.correction);
		if (!metadataLessHistoricalRejection && !validMetadata) {
			throw timeCorrectionFinalizationConflict();
		}
	}

	if (
		input.expectedApprovalWorkflowId !== null &&
		input.expectedApprovalWorkflowVersion !== null
	) {
		const workflow = (await input.dbService.db.query.approvalWorkflow.findFirst(
			{
				where: and(
					eq(approvalWorkflow.id, input.expectedApprovalWorkflowId),
					eq(approvalWorkflow.organizationId, input.organizationId),
					eq(approvalWorkflow.version, input.expectedApprovalWorkflowVersion),
				),
			},
		)) as PersistedCanonicalTimeCorrectionWorkflow | null;
		const expectedStatus =
			input.transition.kind === "approve" ? "approved" : "rejected";
		const validCanonicalTerminal =
			workflow?.status === expectedStatus &&
			isValidBoundaryDate(workflow.completedAt);
		const validObservedPending =
			legacyTerminalLifecycle &&
			workflow?.status === "pending" &&
			workflow.completedAt === null;
		if (
			!workflow ||
			workflow.id !== input.expectedApprovalWorkflowId ||
			workflow.organizationId !== input.organizationId ||
			workflow.workflowType !== "time_correction" ||
			workflow.sourceType !== "time_entry" ||
			workflow.sourceId !== input.workPeriodId ||
			workflow.requesterEmployeeId !== input.periodEmployeeId ||
			workflow.requesterEmployeeId !== input.expectedRequesterEmployeeId ||
			(!validCanonicalTerminal && !validObservedPending) ||
			!Number.isSafeInteger(workflow.version) ||
			workflow.version !== input.expectedApprovalWorkflowVersion ||
			!sameCanonicalCorrectionContext(
				workflow.contextSnapshot,
				input.correction,
			) ||
			(legacyRequester !== null &&
				legacyRequester !== workflow.requesterEmployeeId)
		) {
			throw timeCorrectionFinalizationConflict();
		}
	}
}

function temporalEndpoint(
	entry: LockedTimeCorrectionEntry,
): TimeCorrectionTemporalEndpoint {
	if (
		!entry.timezone ||
		!TIME_CORRECTION_TIMEZONE_SOURCES.has(entry.timezoneSource)
	) {
		throw timeCorrectionFinalizationConflict();
	}
	const endpoint = {
		id: entry.id,
		instant: instantFromTimeCorrectionBoundary(entry.timestamp),
		utcOffsetMinutes: entry.utcOffsetMinutes,
		timezone: entry.timezone,
	};
	try {
		validateTimeCorrectionTimezoneEvidence(endpoint);
		return endpoint;
	} catch {
		throw timeCorrectionFinalizationConflict();
	}
}

function currentEndpointPredecessorId(
	entry: LockedTimeCorrectionEntry | undefined,
	input: {
		id: string;
		organizationId: string;
		employeeId: string;
		type: "clock_in" | "clock_out";
	},
): string | null {
	if (
		!entry ||
		entry.id !== input.id ||
		entry.organizationId !== input.organizationId ||
		entry.employeeId !== input.employeeId
	) {
		throw timeCorrectionFinalizationConflict();
	}
	temporalEndpoint(entry);
	if (entry.type === input.type) {
		if (entry.replacesEntryId !== null) {
			throw timeCorrectionFinalizationConflict();
		}
		return null;
	}
	if (
		entry.type !== "correction" ||
		!entry.replacesEntryId ||
		entry.replacesEntryId === entry.id
	) {
		throw timeCorrectionFinalizationConflict();
	}
	return entry.replacesEntryId;
}

async function lockCurrentEndpointPredecessors(input: {
	dbService: ApprovalDbService;
	organizationId: string;
	employeeId: string;
	endpoints: Array<{
		entry: LockedTimeCorrectionEntry | undefined;
		id: string;
		type: "clock_in" | "clock_out";
	}>;
}): Promise<Map<string, LockedTimeCorrectionEntry>> {
	const predecessorIds = input.endpoints
		.map(({ entry, id, type }) =>
			currentEndpointPredecessorId(entry, {
				id,
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				type,
			}),
		)
		.filter((id): id is string => id !== null);
	if (new Set(predecessorIds).size !== predecessorIds.length) {
		throw timeCorrectionFinalizationConflict();
	}
	if (predecessorIds.length === 0) return new Map();
	const predecessors = (await input.dbService.db
		.select({
			id: timeEntry.id,
			organizationId: timeEntry.organizationId,
			employeeId: timeEntry.employeeId,
			type: timeEntry.type,
			timestamp: timeEntry.timestamp,
			utcOffsetMinutes: timeEntry.utcOffsetMinutes,
			timezone: timeEntry.timezone,
			timezoneSource: timeEntry.timezoneSource,
			replacesEntryId: timeEntry.replacesEntryId,
			isSuperseded: timeEntry.isSuperseded,
			supersededById: timeEntry.supersededById,
		})
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, input.organizationId),
				eq(timeEntry.employeeId, input.employeeId),
				inArray(timeEntry.id, predecessorIds),
			),
		)
		.orderBy(asc(timeEntry.id))
		.for("update")) as LockedTimeCorrectionEntry[];
	if (predecessors.length !== predecessorIds.length) {
		throw timeCorrectionFinalizationConflict();
	}
	const byId = new Map(predecessors.map((entry) => [entry.id, entry]));
	if (byId.size !== predecessorIds.length) {
		throw timeCorrectionFinalizationConflict();
	}
	return byId;
}

function validateCurrentEndpoint(
	entry: LockedTimeCorrectionEntry | undefined,
	predecessor: LockedTimeCorrectionEntry | undefined,
	input: {
		id: string;
		organizationId: string;
		employeeId: string;
		type: "clock_in" | "clock_out";
		requireActive?: boolean;
	},
): LockedTimeCorrectionEntry {
	const predecessorId = currentEndpointPredecessorId(entry, input);
	if (!entry) throw timeCorrectionFinalizationConflict();
	if (
		input.requireActive &&
		(entry.isSuperseded || entry.supersededById !== null)
	) {
		throw timeCorrectionFinalizationConflict();
	}
	if (predecessorId === null) {
		if (predecessor !== undefined) throw timeCorrectionFinalizationConflict();
		return entry;
	}
	if (
		!predecessor ||
		predecessor.id !== predecessorId ||
		predecessor.id === entry.id ||
		predecessor.organizationId !== input.organizationId ||
		predecessor.employeeId !== input.employeeId ||
		(predecessor.type !== input.type && predecessor.type !== "correction") ||
		!predecessor.isSuperseded ||
		predecessor.supersededById !== entry.id ||
		(predecessor.type === input.type && predecessor.replacesEntryId !== null) ||
		(predecessor.type === "correction" &&
			(!predecessor.replacesEntryId ||
				predecessor.replacesEntryId === predecessor.id ||
				predecessor.replacesEntryId === entry.id))
	) {
		throw timeCorrectionFinalizationConflict();
	}
	temporalEndpoint(predecessor);
	return entry;
}

function exactReplacementLineage(entry: LockedTimeCorrectionEntry) {
	return entry.replacesEntryId === null
		? isNull(timeEntry.replacesEntryId)
		: eq(timeEntry.replacesEntryId, entry.replacesEntryId);
}

function validateCorrectionEntry(
	entry: LockedTimeCorrectionEntry | undefined,
	input: {
		id: string;
		organizationId: string;
		employeeId: string;
		originalId: string;
	},
): LockedTimeCorrectionEntry {
	if (
		!entry ||
		entry.id !== input.id ||
		entry.organizationId !== input.organizationId ||
		entry.employeeId !== input.employeeId ||
		entry.type !== "correction" ||
		entry.replacesEntryId !== input.originalId ||
		entry.supersededById !== null
	) {
		throw timeCorrectionFinalizationConflict();
	}
	temporalEndpoint(entry);
	return entry;
}

async function finalizeTimeCorrectionTerminalDetailedInTransaction(
	input: FinalizeTimeCorrectionTerminalInput,
): Promise<TimeCorrectionTerminalDetailedResult> {
	const correction = normalizeTimeCorrectionWorkflowPayload({
		timeCorrection: input.correction,
	}).timeCorrection;
	const employeeIds = [
		...new Set([input.expectedRequesterEmployeeId, input.actorEmployeeId]),
	].sort();
	const lockedEmployees = await input.dbService.db
		.select({
			id: employee.id,
			organizationId: employee.organizationId,
			userId: employee.userId,
			isActive: employee.isActive,
		})
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.isActive, true),
				inArray(employee.id, employeeIds),
			),
		)
		.orderBy(asc(employee.id))
		.for("update");
	if (
		lockedEmployees.length !== employeeIds.length ||
		lockedEmployees.some(
			(row, index) =>
				row.id !== employeeIds[index] ||
				row.organizationId !== input.organizationId ||
				row.isActive !== true,
		)
	) {
		throw timeCorrectionFinalizationConflict();
	}
	const periodRows = await input.dbService.db
		.select({
			id: workPeriod.id,
			organizationId: workPeriod.organizationId,
			employeeId: workPeriod.employeeId,
			clockInId: workPeriod.clockInId,
			clockOutId: workPeriod.clockOutId,
			canonicalRecordId: workPeriod.canonicalRecordId,
			approvalWorkflowId: workPeriod.approvalWorkflowId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
			isActive: workPeriod.isActive,
			approvalStatus: workPeriod.approvalStatus,
			pendingChanges: workPeriod.pendingChanges,
			deletedAt: workPeriod.deletedAt,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
			),
		)
		.for("update");
	if (periodRows.length !== 1) throw timeCorrectionFinalizationConflict();
	const period = periodRows[0] as LockedTimeCorrectionPeriod;
	if (
		period.id !== input.workPeriodId ||
		period.organizationId !== input.organizationId ||
		period.deletedAt !== null ||
		period.approvalStatus !== "approved"
	) {
		throw timeCorrectionFinalizationConflict();
	}
	let expectedApprovalWorkflowId = input.expectedApprovalWorkflowId;
	let expectedApprovalWorkflowVersion = input.expectedApprovalWorkflowVersion;
	let allowObservedLegacyMetadata = false;
	if (
		expectedApprovalWorkflowId === null &&
		expectedApprovalWorkflowVersion === null &&
		period.approvalWorkflowId !== null &&
		input.legacyApprovalRequestId !== null
	) {
		const observed = (await input.dbService.db.query.approvalWorkflow.findFirst(
			{
				where: and(
					eq(approvalWorkflow.id, period.approvalWorkflowId),
					eq(approvalWorkflow.organizationId, input.organizationId),
					eq(approvalWorkflow.workflowType, "time_correction"),
					eq(approvalWorkflow.sourceType, "time_entry"),
					eq(approvalWorkflow.sourceId, period.id),
				),
			},
		)) as PersistedCanonicalTimeCorrectionWorkflow | null;
		if (
			!observed ||
			observed.id !== period.approvalWorkflowId ||
			observed.organizationId !== input.organizationId ||
			observed.requesterEmployeeId !== period.employeeId ||
			observed.status !== "pending" ||
			!Number.isSafeInteger(observed.version) ||
			observed.version < 1 ||
			observed.completedAt !== null ||
			!sameCanonicalCorrectionContext(observed.contextSnapshot, correction)
		) {
			throw timeCorrectionFinalizationConflict();
		}
		expectedApprovalWorkflowId = observed.id;
		expectedApprovalWorkflowVersion = observed.version;
		allowObservedLegacyMetadata = true;
	}
	if (period.approvalWorkflowId !== expectedApprovalWorkflowId) {
		throw timeCorrectionFinalizationConflict();
	}
	await validatePersistedTimeCorrectionEvidence({
		dbService: input.dbService,
		organizationId: input.organizationId,
		workPeriodId: input.workPeriodId,
		periodEmployeeId: period.employeeId,
		expectedRequesterEmployeeId: input.expectedRequesterEmployeeId,
		expectedApprovalWorkflowId,
		expectedApprovalWorkflowVersion,
		legacyApprovalRequestId: input.legacyApprovalRequestId,
		correction,
		transition: input.transition,
		allowMetadataLessLegacyFallback: input.allowMetadataLessLegacyFallback,
		allowObservedLegacyMetadata,
	});

	const correctionIds = [
		correction.clockInCorrectionId,
		correction.clockOutCorrectionId,
	].filter((id): id is string => Boolean(id));
	if (correction.clockOutCorrectionId && !period.clockOutId) {
		throw timeCorrectionFinalizationConflict();
	}
	const entryIds = [period.clockInId, period.clockOutId, ...correctionIds]
		.filter((id): id is string => Boolean(id))
		.sort();
	if (new Set(entryIds).size !== entryIds.length) {
		throw timeCorrectionFinalizationConflict();
	}
	const lockedEntries = (await input.dbService.db
		.select({
			id: timeEntry.id,
			organizationId: timeEntry.organizationId,
			employeeId: timeEntry.employeeId,
			type: timeEntry.type,
			timestamp: timeEntry.timestamp,
			utcOffsetMinutes: timeEntry.utcOffsetMinutes,
			timezone: timeEntry.timezone,
			timezoneSource: timeEntry.timezoneSource,
			replacesEntryId: timeEntry.replacesEntryId,
			isSuperseded: timeEntry.isSuperseded,
			supersededById: timeEntry.supersededById,
		})
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, input.organizationId),
				eq(timeEntry.employeeId, period.employeeId),
				inArray(timeEntry.id, entryIds),
			),
		)
		.orderBy(asc(timeEntry.id))
		.for("update")) as LockedTimeCorrectionEntry[];
	if (lockedEntries.length !== entryIds.length) {
		throw timeCorrectionFinalizationConflict();
	}
	const entriesById = new Map(lockedEntries.map((entry) => [entry.id, entry]));
	if (entriesById.size !== entryIds.length)
		throw timeCorrectionFinalizationConflict();
	const currentClockInCandidate = entriesById.get(period.clockInId);
	const currentClockOutCandidate = period.clockOutId
		? entriesById.get(period.clockOutId)
		: undefined;
	const predecessorsById = await lockCurrentEndpointPredecessors({
		dbService: input.dbService,
		organizationId: input.organizationId,
		employeeId: period.employeeId,
		endpoints: [
			{
				entry: currentClockInCandidate,
				id: period.clockInId,
				type: "clock_in",
			},
			...(period.clockOutId
				? [
						{
							entry: currentClockOutCandidate,
							id: period.clockOutId,
							type: "clock_out" as const,
						},
					]
				: []),
		],
	});
	const originalClockIn = validateCurrentEndpoint(
		currentClockInCandidate,
		currentClockInCandidate?.replacesEntryId
			? predecessorsById.get(currentClockInCandidate.replacesEntryId)
			: undefined,
		{
			id: period.clockInId,
			organizationId: input.organizationId,
			employeeId: period.employeeId,
			type: "clock_in",
		},
	);
	const originalClockOut = period.clockOutId
		? validateCurrentEndpoint(
				currentClockOutCandidate,
				currentClockOutCandidate?.replacesEntryId
					? predecessorsById.get(currentClockOutCandidate.replacesEntryId)
					: undefined,
				{
					id: period.clockOutId,
					organizationId: input.organizationId,
					employeeId: period.employeeId,
					type: "clock_out",
				},
			)
		: null;
	if (
		!sameDatabaseInstant(period.startTime, originalClockIn.timestamp) ||
		!sameDatabaseInstant(period.endTime, originalClockOut?.timestamp ?? null) ||
		period.isActive !== (originalClockOut === null)
	) {
		throw timeCorrectionFinalizationConflict();
	}
	const clockInCorrection = correction.clockInCorrectionId
		? validateCorrectionEntry(entriesById.get(correction.clockInCorrectionId), {
				id: correction.clockInCorrectionId,
				organizationId: input.organizationId,
				employeeId: period.employeeId,
				originalId: period.clockInId,
			})
		: null;
	const clockOutCorrection = correction.clockOutCorrectionId
		? validateCorrectionEntry(
				entriesById.get(correction.clockOutCorrectionId),
				{
					id: correction.clockOutCorrectionId,
					organizationId: input.organizationId,
					employeeId: period.employeeId,
					originalId: period.clockOutId ?? "",
				},
			)
		: null;

	const employees = (await input.dbService.db.query.employee.findMany({
		where: and(
			eq(employee.organizationId, input.organizationId),
			eq(employee.isActive, true),
			inArray(employee.id, [period.employeeId, input.actorEmployeeId]),
		),
		with: { user: true },
	})) as FinalizerEmployee[];
	const requester = employees.find(
		(candidate) => candidate.id === period.employeeId,
	);
	const actor = employees.find(
		(candidate) => candidate.id === input.actorEmployeeId,
	);
	if (
		!requester ||
		requester.organizationId !== input.organizationId ||
		!requester.isActive ||
		!actor ||
		actor.organizationId !== input.organizationId ||
		actor.userId !== input.actorUserId ||
		!actor.isActive
	) {
		throw timeCorrectionFinalizationConflict();
	}

	let canonical: LockedCanonicalWorkRecord | null = null;
	if (period.canonicalRecordId) {
		const canonicalRows = (await input.dbService.db
			.select({
				id: timeRecord.id,
				organizationId: timeRecord.organizationId,
				employeeId: timeRecord.employeeId,
				recordKind: timeRecord.recordKind,
				startAt: timeRecord.startAt,
				endAt: timeRecord.endAt,
				durationMinutes: timeRecord.durationMinutes,
				approvalState: timeRecord.approvalState,
			})
			.from(timeRecord)
			.where(
				and(
					eq(timeRecord.id, period.canonicalRecordId),
					eq(timeRecord.organizationId, input.organizationId),
					eq(timeRecord.employeeId, period.employeeId),
					eq(timeRecord.recordKind, "work"),
				),
			)
			.for("update")) as LockedCanonicalWorkRecord[];
		canonical = canonicalRows[0] ?? null;
		if (
			canonicalRows.length !== 1 ||
			!canonical ||
			canonical.id !== period.canonicalRecordId ||
			canonical.organizationId !== input.organizationId ||
			canonical.employeeId !== period.employeeId ||
			canonical.recordKind !== "work" ||
			canonical.approvalState !== period.approvalStatus ||
			!sameDatabaseInstant(canonical.startAt, period.startTime) ||
			!sameDatabaseInstant(canonical.endAt, period.endTime) ||
			canonical.durationMinutes !== period.durationMinutes
		) {
			throw timeCorrectionFinalizationConflict();
		}
	} else if (expectedApprovalWorkflowId !== null) {
		throw timeCorrectionFinalizationConflict();
	}

	const originalEntries = [originalClockIn, originalClockOut].filter(
		(entry): entry is LockedTimeCorrectionEntry => Boolean(entry),
	);
	const correctionEntries = [clockInCorrection, clockOutCorrection].filter(
		(entry): entry is LockedTimeCorrectionEntry => Boolean(entry),
	);
	const modernState =
		originalEntries.every(
			(entry) => !entry.isSuperseded && entry.supersededById === null,
		) && correctionEntries.every((entry) => entry.isSuperseded);
	const historicalRejectedState =
		correctionEntries.every((correctionEntry) => {
			const original = originalEntries.find(
				(candidate) => candidate.id === correctionEntry.replacesEntryId,
			);
			return (
				Boolean(original) &&
				original?.isSuperseded === true &&
				original.supersededById === correctionEntry.id &&
				correctionEntry.isSuperseded === false
			);
		}) &&
		originalEntries.every((original) => {
			const isCorrected = correctionEntries.some(
				(correctionEntry) => correctionEntry.replacesEntryId === original.id,
			);
			return (
				isCorrected ||
				(!original.isSuperseded && original.supersededById === null)
			);
		});
	const periodForResult: WorkPeriodRecord = {
		...period,
		employee: {
			userId: requester.userId,
			organizationId: requester.organizationId,
			user: requester.user,
		},
	};
	const originalNotificationTime = clockInCorrection
		? period.startTime
		: (period.endTime ?? period.startTime);
	const correctedNotificationTime =
		clockInCorrection?.timestamp ??
		clockOutCorrection?.timestamp ??
		originalNotificationTime;

	if (input.transition.kind === "reject") {
		if (modernState) {
			return {
				transition: "rejected",
				requesterEmployeeId: period.employeeId,
				dirtyFromDate: null,
				period: periodForResult,
				originalNotificationTime,
				correctedNotificationTime,
			};
		}
		if (
			!input.allowMetadataLessLegacyFallback ||
			expectedApprovalWorkflowId !== null ||
			!input.legacyApprovalRequestId ||
			!historicalRejectedState
		) {
			throw timeCorrectionFinalizationConflict();
		}
		for (const correctionEntry of correctionEntries) {
			const original = originalEntries.find(
				(candidate) => candidate.id === correctionEntry.replacesEntryId,
			);
			if (!original) throw timeCorrectionFinalizationConflict();
			const reactivated = await input.dbService.db
				.update(timeEntry)
				.set({ isSuperseded: false, supersededById: null })
				.where(
					and(
						eq(timeEntry.id, original.id),
						eq(timeEntry.organizationId, input.organizationId),
						eq(timeEntry.employeeId, period.employeeId),
						eq(timeEntry.type, original.type),
						eq(timeEntry.isSuperseded, true),
						eq(timeEntry.supersededById, correctionEntry.id),
						exactReplacementLineage(original),
					),
				)
				.returning({ id: timeEntry.id });
			requireSingleMutation(reactivated, original.id);
			const deactivated = await input.dbService.db
				.update(timeEntry)
				.set({ isSuperseded: true, supersededById: null })
				.where(
					and(
						eq(timeEntry.id, correctionEntry.id),
						eq(timeEntry.organizationId, input.organizationId),
						eq(timeEntry.employeeId, period.employeeId),
						eq(timeEntry.type, "correction"),
						eq(timeEntry.replacesEntryId, original.id),
						eq(timeEntry.isSuperseded, false),
						isNull(timeEntry.supersededById),
					),
				)
				.returning({ id: timeEntry.id });
			requireSingleMutation(deactivated, correctionEntry.id);
		}
		return {
			transition: "rejected",
			requesterEmployeeId: period.employeeId,
			dirtyFromDate: null,
			period: periodForResult,
			originalNotificationTime,
			correctedNotificationTime,
		};
	}

	if (!modernState) throw timeCorrectionFinalizationConflict();
	const correctedPeriod = calculateTimeCorrectionPeriod({
		action: correction.action,
		originalClockIn: temporalEndpoint(originalClockIn),
		originalClockOut: originalClockOut
			? temporalEndpoint(originalClockOut)
			: null,
		correctedClockIn: clockInCorrection
			? temporalEndpoint(clockInCorrection)
			: null,
		correctedClockOut: clockOutCorrection
			? temporalEndpoint(clockOutCorrection)
			: null,
	});
	const dirtyFromDate = dirtyFromDateForTimeCorrection([
		...(clockInCorrection
			? [temporalEndpoint(originalClockIn), temporalEndpoint(clockInCorrection)]
			: []),
		...(originalClockOut && clockOutCorrection
			? [
					temporalEndpoint(originalClockOut),
					temporalEndpoint(clockOutCorrection),
				]
			: []),
	]);

	for (const [original, correctionEntry] of [
		[originalClockIn, clockInCorrection],
		[originalClockOut, clockOutCorrection],
	] as const) {
		if (!original || !correctionEntry) continue;
		const activated = await input.dbService.db
			.update(timeEntry)
			.set({ isSuperseded: false, supersededById: null })
			.where(
				and(
					eq(timeEntry.id, correctionEntry.id),
					eq(timeEntry.organizationId, input.organizationId),
					eq(timeEntry.employeeId, period.employeeId),
					eq(timeEntry.type, "correction"),
					eq(timeEntry.replacesEntryId, original.id),
					eq(timeEntry.isSuperseded, true),
					isNull(timeEntry.supersededById),
				),
			)
			.returning({ id: timeEntry.id });
		requireSingleMutation(activated, correctionEntry.id);
		const superseded = await input.dbService.db
			.update(timeEntry)
			.set({ isSuperseded: true, supersededById: correctionEntry.id })
			.where(
				and(
					eq(timeEntry.id, original.id),
					eq(timeEntry.organizationId, input.organizationId),
					eq(timeEntry.employeeId, period.employeeId),
					eq(timeEntry.type, original.type),
					eq(timeEntry.isSuperseded, false),
					isNull(timeEntry.supersededById),
					exactReplacementLineage(original),
				),
			)
			.returning({ id: timeEntry.id });
		requireSingleMutation(superseded, original.id);
	}

	const finalizedAt = instantToTimeCorrectionDate(input.finalizedAt);
	const updatedPeriods = await input.dbService.db
		.update(workPeriod)
		.set({
			clockInId: correctedPeriod.clockIn.id,
			clockOutId: correctedPeriod.clockOut?.id ?? null,
			startTime: instantToTimeCorrectionDate(correctedPeriod.clockIn.instant),
			endTime: correctedPeriod.clockOut
				? instantToTimeCorrectionDate(correctedPeriod.clockOut.instant)
				: null,
			durationMinutes: correctedPeriod.durationMinutes,
			updatedAt: finalizedAt,
			...(correctedPeriod.isDeletion
				? {
						deletedAt: finalizedAt,
						deletedBy: input.actorUserId,
						deletionReason: input.transition.reason,
						deletionApprovalRequestId: input.legacyApprovalRequestId,
					}
				: {}),
		})
		.where(
			and(
				eq(workPeriod.id, period.id),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, period.employeeId),
				eq(workPeriod.clockInId, period.clockInId),
				...(period.clockOutId
					? [eq(workPeriod.clockOutId, period.clockOutId)]
					: [isNull(workPeriod.clockOutId)]),
				eq(workPeriod.startTime, period.startTime),
				...(period.endTime
					? [eq(workPeriod.endTime, period.endTime)]
					: [isNull(workPeriod.endTime)]),
				...(period.durationMinutes === null
					? [isNull(workPeriod.durationMinutes)]
					: [eq(workPeriod.durationMinutes, period.durationMinutes)]),
				eq(workPeriod.approvalStatus, period.approvalStatus),
				...(expectedApprovalWorkflowId
					? [eq(workPeriod.approvalWorkflowId, expectedApprovalWorkflowId)]
					: [isNull(workPeriod.approvalWorkflowId)]),
				isNull(workPeriod.deletedAt),
			),
		)
		.returning({ id: workPeriod.id });
	requireSingleMutation(updatedPeriods, period.id);

	if (canonical) {
		const updatedCanonical = await input.dbService.db
			.update(timeRecord)
			.set({
				startAt: instantToTimeCorrectionDate(correctedPeriod.clockIn.instant),
				endAt: correctedPeriod.clockOut
					? instantToTimeCorrectionDate(correctedPeriod.clockOut.instant)
					: null,
				durationMinutes: correctedPeriod.durationMinutes,
				updatedAt: finalizedAt,
				updatedBy: input.actorUserId,
			})
			.where(
				and(
					eq(timeRecord.id, canonical.id),
					eq(timeRecord.organizationId, input.organizationId),
					eq(timeRecord.employeeId, period.employeeId),
					eq(timeRecord.recordKind, "work"),
					eq(timeRecord.startAt, canonical.startAt),
					...(canonical.endAt
						? [eq(timeRecord.endAt, canonical.endAt)]
						: [isNull(timeRecord.endAt)]),
					...(canonical.durationMinutes === null
						? [isNull(timeRecord.durationMinutes)]
						: [eq(timeRecord.durationMinutes, canonical.durationMinutes)]),
					eq(timeRecord.approvalState, canonical.approvalState),
				),
			)
			.returning({ id: timeRecord.id });
		requireSingleMutation(updatedCanonical, canonical.id);
	}

	return {
		transition: "approved",
		requesterEmployeeId: period.employeeId,
		dirtyFromDate,
		period: periodForResult,
		originalNotificationTime,
		correctedNotificationTime,
	};
}

export async function finalizeTimeCorrectionTerminalInTransaction(
	input: FinalizeTimeCorrectionTerminalInput,
): Promise<TimeCorrectionTerminalResult> {
	const result =
		await finalizeTimeCorrectionTerminalDetailedInTransaction(input);
	return {
		transition: result.transition,
		requesterEmployeeId: result.requesterEmployeeId,
		dirtyFromDate: result.dirtyFromDate,
	};
}

function ensureWorkPeriod(
	period: WorkPeriodRecord | null,
): Effect.Effect<WorkPeriodRecord, NotFoundError> {
	return period
		? Effect.succeed(period)
		: Effect.fail(
				new NotFoundError({
					message: "Work period not found",
					entityType: "work_period",
				}),
			);
}

function isPendingApprovalUniqueConflict(error: DatabaseError) {
	const cause = error.cause as
		| { code?: unknown; constraint?: unknown }
		| undefined;
	return (
		cause?.code === "23505" &&
		cause.constraint === "approvalRequest_pending_entity_unique_idx"
	);
}

function pendingTimeCorrectionConflict(workPeriodId: string) {
	return new ConflictError({
		message:
			"A time correction approval is already pending for this work period",
		conflictType: "pending_time_correction_approval",
		details: { workPeriodId },
	});
}

function loadWorkPeriod(
	dbService: ApprovalDbService,
	entityId: string,
	organizationId: string,
): Effect.Effect<WorkPeriodRecord, AnyAppError, never> {
	return dbService
		.query("getWorkPeriod", async () => {
			return await dbService.db.query.workPeriod.findFirst({
				where: and(
					eq(workPeriod.id, entityId),
					eq(workPeriod.organizationId, organizationId),
				),
				with: {
					employee: {
						with: { user: true },
					},
				},
			});
		})
		.pipe(
			Effect.flatMap((period) =>
				ensureWorkPeriod(period as unknown as WorkPeriodRecord | null),
			),
		);
}

function loadActiveCorrectionEntries(
	dbService: ApprovalDbService,
	period: WorkPeriodRecord,
	replacesEntryId: string,
) {
	return dbService
		.query("getCorrectionEntries", async () => {
			return await dbService.db
				.select()
				.from(timeEntry)
				.where(
					and(
						eq(timeEntry.type, "correction"),
						eq(timeEntry.employeeId, period.employeeId),
						eq(timeEntry.organizationId, period.organizationId),
						eq(timeEntry.replacesEntryId, replacesEntryId),
						eq(timeEntry.isSuperseded, false),
					),
				);
		})
		.pipe(
			Effect.map((entries) =>
				(entries as CorrectionEntry[]).filter((entry) => !entry.isSuperseded),
			),
		);
}

function correctionEntryIdsFromApproval(approval: PendingApprovalRequest) {
	const metadata = approval.metadata as TimeCorrectionApprovalMetadata | null;
	return metadata?.timeCorrection;
}

export function calculateCorrectedDurationMinutes(
	startTime: Date,
	endTime: Date,
) {
	const start = instantFromTimeCorrectionBoundary(startTime);
	const end = instantFromTimeCorrectionBoundary(endTime);
	return Math.floor(start.until(end).total("minutes"));
}

export function buildTimeCorrectionApprovalPolicyContext(input: {
	organizationId: string;
	requesterEmployeeId: string;
	teamId: string | null;
	workPeriodId: string;
	overtimeRisk: ApprovalPolicyOvertimeRisk | null;
}): ApprovalPolicyEvaluationContext {
	return {
		organizationId: input.organizationId,
		approvalType: "time_entry",
		requesterEmployeeId: input.requesterEmployeeId,
		teamId: input.teamId,
		locationId: null,
		absenceCategoryId: null,
		travelExpenseAmount: null,
		overtimeRisk: input.overtimeRisk,
		employeeGroupIds: [],
		entityType: "time_entry",
		entityId: input.workPeriodId,
	};
}

export interface TimeCorrectionPostCommitEffects {
	authority: "legacy" | "canonical";
	submittedToEmployeeId: string | null;
	terminal:
		| {
				kind: "approved";
				dirtyFromDate: string;
				requesterEmployeeId: string;
		  }
		| { kind: "rejected"; requesterEmployeeId: string }
		| null;
}

export interface ExecuteTimeCorrectionSubmissionInput {
	dbService: ApprovalDbService;
	/** The caller-owned repository transaction context containing dbService. */
	context: ApprovalWorkflowTransactionContext;
	organizationId: string;
	requesterEmployeeId: string;
	teamId: string | null;
	workPeriodId: string;
	defaultApproverId: string | null;
	reason: string | null;
	overtimeRisk: ApprovalPolicyOvertimeRisk | null;
	submissionKey: string;
	submissionId?: string;
	correction: TimeCorrectionWorkflowPayload["timeCorrection"];
	nowInstant?: () => Instant;
	captureLegacyState?: typeof captureTimeCorrectionLegacyApprovalState;
}

export async function lockTimeCorrectionSubmissionSourceInTransaction(input: {
	dbService: ApprovalDbService;
	organizationId: string;
	requesterEmployeeId: string;
	workPeriodId: string;
	requesterUserId?: string;
	expectedApprovalWorkflowId?: string | null;
}): Promise<{
	id: string;
	organizationId: string;
	employeeId: string;
	approvalWorkflowId: string | null;
	requesterUserId: string;
}> {
	const employeeRows = await input.dbService.db
		.select({
			id: employee.id,
			organizationId: employee.organizationId,
			userId: employee.userId,
			isActive: employee.isActive,
		})
		.from(employee)
		.where(
			and(
				eq(employee.id, input.requesterEmployeeId),
				eq(employee.organizationId, input.organizationId),
				eq(employee.isActive, true),
				input.requesterUserId
					? eq(employee.userId, input.requesterUserId)
					: undefined,
			),
		)
		.for("update");
	const requester = employeeRows[0];
	if (
		employeeRows.length !== 1 ||
		!requester ||
		requester.id !== input.requesterEmployeeId ||
		requester.organizationId !== input.organizationId ||
		requester.isActive !== true ||
		!requester.userId ||
		(input.requesterUserId !== undefined &&
			requester.userId !== input.requesterUserId)
	) {
		throw new Error("Time correction submission source is unavailable");
	}
	const hasExpectedLink = Object.hasOwn(input, "expectedApprovalWorkflowId");
	const periodRows = await input.dbService.db
		.select({
			id: workPeriod.id,
			organizationId: workPeriod.organizationId,
			employeeId: workPeriod.employeeId,
			approvalWorkflowId: workPeriod.approvalWorkflowId,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.requesterEmployeeId),
				hasExpectedLink
					? input.expectedApprovalWorkflowId === null
						? isNull(workPeriod.approvalWorkflowId)
						: eq(
								workPeriod.approvalWorkflowId,
								input.expectedApprovalWorkflowId as string,
							)
					: undefined,
			),
		)
		.for("update");
	const period = periodRows[0];
	if (
		periodRows.length !== 1 ||
		!period ||
		period.id !== input.workPeriodId ||
		period.organizationId !== input.organizationId ||
		period.employeeId !== input.requesterEmployeeId ||
		(hasExpectedLink &&
			period.approvalWorkflowId !== input.expectedApprovalWorkflowId)
	) {
		throw new Error("Time correction submission source is unavailable");
	}
	return { ...period, requesterUserId: requester.userId };
}

type TimeCorrectionSubmissionResult = TimeCorrectionApprovalWorkflowResult & {
	disposition: "executed" | "replayed";
	postCommit: TimeCorrectionPostCommitEffects;
};

function exactSubmissionDbService(
	input: Pick<ExecuteTimeCorrectionSubmissionInput, "context" | "dbService">,
): void {
	if (input.context.dbService.db !== (input.dbService.db as unknown)) {
		throw new Error(
			"Time correction submission requires one transaction context",
		);
	}
}

function requesterAutoCompletionActor(input: {
	started: Awaited<ReturnType<typeof startApprovalWorkflow>>;
	requesterEmployeeId: string;
	requesterUserId: string;
}): { employeeId: string; userId: string } {
	if (
		input.started.kind !== "created" ||
		!input.started.terminal ||
		input.started.status !== "approved" ||
		input.started.snapshot.status !== "approved" ||
		input.started.snapshot.requesterEmployeeId !== input.requesterEmployeeId ||
		input.started.snapshot.stages.length === 0 ||
		input.started.snapshot.stages.some(
			(stage) =>
				stage.activationMode !== "requester_auto_approve" ||
				stage.status !== "approved" ||
				stage.assignments.length !== 0,
		)
	) {
		throw new Error(
			"Time correction submission reached invalid requester auto-completion",
		);
	}
	return {
		employeeId: input.requesterEmployeeId,
		userId: input.requesterUserId,
	};
}

function fixedTimeCorrectionGate(
	organizationId: string,
	authority: Awaited<
		ReturnType<ApprovalWorkflowTransactionContext["writeGate"]["acquire"]>
	>,
) {
	return {
		acquire: async (scope: {
			organizationId: string;
			workflowType: "time_correction";
		}) => {
			if (
				scope.organizationId !== organizationId ||
				scope.workflowType !== "time_correction"
			) {
				throw new Error("Time correction rollout scope mismatch");
			}
			return authority;
		},
	};
}

function resultCycle(
	result: TimeCorrectionApprovalWorkflowResult,
): ExpectedTimeCorrectionLegacyCycle {
	return {
		approvalRequestId: result.approvalRequestId,
		...(result.kind === "chain_created" && result.chainInstanceId
			? { chainInstanceId: result.chainInstanceId }
			: {}),
	};
}

async function submittedToEmployeeId(
	dbService: ApprovalDbService,
	organizationId: string,
	approvalRequestId: string,
): Promise<string | null> {
	const request = await dbService.db.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, approvalRequestId),
			eq(approvalRequest.organizationId, organizationId),
		),
		columns: { approverId: true },
	});
	return request?.approverId ?? null;
}

function legacySubmissionPostCommit(
	input: ExecuteTimeCorrectionSubmissionInput,
	result: TimeCorrectionApprovalWorkflowResult,
	submittedTo: string | null,
): TimeCorrectionPostCommitEffects {
	if (result.kind !== "auto_completed") {
		return {
			authority: "legacy",
			submittedToEmployeeId: submittedTo,
			terminal: null,
		};
	}
	const dirtyFromDate =
		result.autoCompletion.workBalanceDirtyMark?.dirtyFromDate;
	if (!dirtyFromDate) {
		throw new Error("Approved time correction is missing dirty-date evidence");
	}
	return {
		authority: "legacy",
		submittedToEmployeeId: null,
		terminal: {
			kind: "approved",
			dirtyFromDate,
			requesterEmployeeId: input.requesterEmployeeId,
		},
	};
}

export async function resolveTimeCorrectionCompatibilityApprovalId(input: {
	dbService: ApprovalDbService;
	organizationId: string;
	workPeriodId: string;
	workflow: ApprovalWorkflowSnapshot;
}): Promise<string> {
	if (input.workflow.status !== "pending") return input.workflow.id;
	const currentStage = input.workflow.stages.find(
		(stage) =>
			stage.sequence === input.workflow.currentStageOrder &&
			stage.status === "pending",
	);
	if (!currentStage) {
		throw new Error("Canonical time correction active stage is missing");
	}
	const requests = await input.dbService.db.query.approvalRequest.findMany({
		where: and(
			eq(approvalRequest.organizationId, input.organizationId),
			eq(approvalRequest.entityType, "time_entry"),
			eq(approvalRequest.entityId, input.workPeriodId),
			eq(approvalRequest.status, "pending"),
			sql`${approvalRequest.metadata} -> 'workflow' ->> 'id' = ${input.workflow.id}`,
			sql`${approvalRequest.metadata} -> 'workflow' ->> 'organizationId' = ${input.organizationId}`,
			sql`${approvalRequest.metadata} -> 'stage' ->> 'id' = ${currentStage.id}`,
			sql`${approvalRequest.metadata} -> 'stage' ->> 'sequence' = ${String(input.workflow.currentStageOrder)}`,
		),
		limit: 2,
	});
	const matches = requests.filter((request) => {
		const metadata = request.metadata as {
			workflow?: { id?: unknown; organizationId?: unknown };
			stage?: { id?: unknown; sequence?: unknown };
		} | null;
		return (
			request.status === "pending" &&
			metadata?.workflow?.id === input.workflow.id &&
			metadata.workflow.organizationId === input.organizationId &&
			metadata.stage?.id === currentStage.id &&
			metadata.stage.sequence === input.workflow.currentStageOrder
		);
	});
	if (matches.length !== 1) {
		throw new Error(
			"Canonical time correction active compatibility target is invalid",
		);
	}
	return matches[0]?.id ?? input.workflow.id;
}

async function resolveOriginalTimeCorrectionCompatibilityApprovalId(input: {
	dbService: ApprovalDbService;
	organizationId: string;
	workPeriodId: string;
	workflow: ApprovalWorkflowSnapshot;
}): Promise<string | null> {
	const originalStage = input.workflow.stages.find(
		(stage) => stage.activationMode !== "requester_auto_approve",
	);
	if (!originalStage) return null;
	const requests = await input.dbService.db.query.approvalRequest.findMany({
		where: and(
			eq(approvalRequest.organizationId, input.organizationId),
			eq(approvalRequest.entityType, "time_entry"),
			eq(approvalRequest.entityId, input.workPeriodId),
			sql`${approvalRequest.metadata} -> 'workflow' ->> 'id' = ${input.workflow.id}`,
			sql`${approvalRequest.metadata} -> 'workflow' ->> 'organizationId' = ${input.organizationId}`,
			sql`${approvalRequest.metadata} -> 'stage' ->> 'id' = ${originalStage.id}`,
			sql`${approvalRequest.metadata} -> 'stage' ->> 'sequence' = ${String(originalStage.sequence)}`,
		),
		limit: 2,
	});
	const matches = requests.filter((request) => {
		const metadata = request.metadata as {
			workflow?: { id?: unknown; organizationId?: unknown };
			stage?: { id?: unknown; sequence?: unknown };
		} | null;
		return (
			metadata?.workflow?.id === input.workflow.id &&
			metadata.workflow.organizationId === input.organizationId &&
			metadata.stage?.id === originalStage.id &&
			metadata.stage.sequence === originalStage.sequence
		);
	});
	if (matches.length > 1) {
		throw pendingTimeCorrectionConflict(input.workPeriodId);
	}
	return matches[0]?.id ?? null;
}

async function loadCanonicalAutoCompletionReplay(input: {
	dbService: ApprovalDbService;
	organizationId: string;
	requesterEmployeeId: string;
	workPeriodId: string;
	correction: TimeCorrectionWorkflowPayload["timeCorrection"];
}): Promise<TimeCorrectionAutoCompletionResult> {
	const period = (await input.dbService.db.query.workPeriod.findFirst({
		where: and(
			eq(workPeriod.id, input.workPeriodId),
			eq(workPeriod.organizationId, input.organizationId),
			eq(workPeriod.employeeId, input.requesterEmployeeId),
		),
		with: { employee: { with: { user: true } } },
	})) as WorkPeriodRecord | null;
	if (!period) throw timeCorrectionFinalizationConflict();
	const correctionIds = [
		input.correction.clockInCorrectionId,
		input.correction.clockOutCorrectionId,
	].filter((id): id is string => Boolean(id));
	const corrections = (await input.dbService.db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, input.organizationId),
			eq(timeEntry.employeeId, input.requesterEmployeeId),
			eq(timeEntry.type, "correction"),
			inArray(timeEntry.id, correctionIds),
		),
	})) as LockedTimeCorrectionEntry[];
	if (corrections.length !== correctionIds.length) {
		throw timeCorrectionFinalizationConflict();
	}
	const originalIds = corrections.map((entry) => entry.replacesEntryId);
	if (originalIds.some((id): id is null => id === null)) {
		throw timeCorrectionFinalizationConflict();
	}
	const originals = (await input.dbService.db.query.timeEntry.findMany({
		where: and(
			eq(timeEntry.organizationId, input.organizationId),
			eq(timeEntry.employeeId, input.requesterEmployeeId),
			inArray(timeEntry.id, originalIds as string[]),
		),
	})) as LockedTimeCorrectionEntry[];
	if (originals.length !== originalIds.length) {
		throw timeCorrectionFinalizationConflict();
	}
	const clockInCorrection = input.correction.clockInCorrectionId
		? corrections.find(
				(entry) => entry.id === input.correction.clockInCorrectionId,
			)
		: null;
	const clockOutCorrection = input.correction.clockOutCorrectionId
		? corrections.find(
				(entry) => entry.id === input.correction.clockOutCorrectionId,
			)
		: null;
	const originalFor = (entry: LockedTimeCorrectionEntry | null | undefined) =>
		entry
			? originals.find((candidate) => candidate.id === entry.replacesEntryId)
			: null;
	const relevant = [
		originalFor(clockInCorrection),
		clockInCorrection,
		originalFor(clockOutCorrection),
		clockOutCorrection,
	].filter((entry): entry is LockedTimeCorrectionEntry => Boolean(entry));
	if (relevant.length !== corrections.length * 2) {
		throw timeCorrectionFinalizationConflict();
	}
	const originalNotificationTime =
		originalFor(clockInCorrection)?.timestamp ??
		originalFor(clockOutCorrection)?.timestamp ??
		period.startTime;
	const correctedNotificationTime =
		clockInCorrection?.timestamp ??
		clockOutCorrection?.timestamp ??
		originalNotificationTime;
	const dirtyFromDate = dirtyFromDateForTimeCorrection(
		relevant.map(temporalEndpoint),
	);
	if (!dirtyFromDate) throw timeCorrectionFinalizationConflict();
	return {
		period,
		originalNotificationTime,
		correctedNotificationTime,
		workBalanceDirtyMark: {
			employeeId: input.requesterEmployeeId,
			organizationId: input.organizationId,
			dirtyFromDate,
		},
	};
}

export async function executeTimeCorrectionSubmissionInTransaction(
	input: ExecuteTimeCorrectionSubmissionInput,
): Promise<TimeCorrectionSubmissionResult> {
	exactSubmissionDbService(input);
	const correction = normalizeTimeCorrectionWorkflowPayload({
		timeCorrection: input.correction,
	}).timeCorrection;
	if (!input.submissionKey.trim()) {
		throw new ValidationError({
			message: "Time correction submission key is required",
			field: "submissionKey",
		});
	}
	if (
		input.submissionId !== undefined &&
		!SUBMISSION_UUID.test(input.submissionId)
	) {
		throw new ValidationError({
			message: "Time correction submission ID must be a valid UUID",
			field: "submissionId",
		});
	}
	const lockedSource = await lockTimeCorrectionSubmissionSourceInTransaction({
		dbService: input.dbService,
		organizationId: input.organizationId,
		requesterEmployeeId: input.requesterEmployeeId,
		workPeriodId: input.workPeriodId,
	});
	const authority = await input.context.writeGate.acquire({
		organizationId: input.organizationId,
		workflowType: "time_correction",
	});
	const fixedGate = fixedTimeCorrectionGate(input.organizationId, authority);
	const transactionContext = {
		...input.context,
		writeGate: fixedGate,
		compatibilityWriter:
			input.context.compatibilityWriter.withWriteGate(fixedGate),
	} as ApprovalWorkflowTransactionContext;

	if (
		authority.mode === "legacy" ||
		authority.mode === "shadow" ||
		authority.mode === "ready"
	) {
		if (input.submissionId) {
			const cycleRequests =
				await input.dbService.db.query.approvalRequest.findMany({
					where: and(
						eq(approvalRequest.organizationId, input.organizationId),
						eq(approvalRequest.entityType, "time_entry"),
						eq(approvalRequest.entityId, input.workPeriodId),
						sql`${approvalRequest.metadata} -> 'submission' ->> 'submissionId' = ${input.submissionId}`,
					),
					limit: 2,
				});
			if (
				cycleRequests.some(
					(request) =>
						submissionIdFromMetadata(request.metadata) === input.submissionId &&
						submissionKeyFromMetadata(request.metadata) !== input.submissionKey,
				)
			) {
				throw pendingTimeCorrectionConflict(input.workPeriodId);
			}
		}
		const requests = await input.dbService.db.query.approvalRequest.findMany({
			where: and(
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.entityId, input.workPeriodId),
				sql`${approvalRequest.metadata} -> 'submission' ->> 'key' = ${input.submissionKey}`,
			),
			limit: 2,
		});
		let replayCandidates: typeof requests;
		try {
			replayCandidates = requests.filter(
				(request) =>
					submissionKeyFromMetadata(request.metadata) === input.submissionKey,
			);
		} catch {
			throw pendingTimeCorrectionConflict(input.workPeriodId);
		}
		if (replayCandidates.length > 1) {
			throw pendingTimeCorrectionConflict(input.workPeriodId);
		}
		const replay = replayCandidates[0];
		if (replay) {
			if (!sameCorrectionPayload(replay.metadata, correction)) {
				throw pendingTimeCorrectionConflict(input.workPeriodId);
			}
			const stage =
				await input.dbService.db.query.approvalChainStageInstance.findFirst({
					where: and(
						eq(approvalChainStageInstance.organizationId, input.organizationId),
						eq(approvalChainStageInstance.approvalRequestId, replay.id),
					),
					columns: { chainInstanceId: true },
				});
			let evidence: TimeCorrectionSubmissionEvidence | null;
			try {
				evidence = parseSubmissionEvidence(
					replay.metadata,
					input.submissionKey,
					input.submissionId,
				);
			} catch {
				throw pendingTimeCorrectionConflict(input.workPeriodId);
			}
			if (!evidence) {
				const historicalAuto = parseHistoricalAutoApprovalEvidence(
					replay.metadata,
				);
				if (
					historicalAuto === "invalid" ||
					(historicalAuto === "requester_auto_approved" &&
						replay.status !== "approved")
				) {
					throw pendingTimeCorrectionConflict(input.workPeriodId);
				}
				evidence = submissionEvidenceFor(
					input.submissionKey,
					historicalAuto === "requester_auto_approved"
						? "auto_completed"
						: stage?.chainInstanceId
							? "chain_created"
							: "default_created",
					input.submissionId,
				);
			}
			const replayChainInstanceId =
				stage?.chainInstanceId ??
				cancelledChainInstanceIdFromMetadata({
					metadata: replay.metadata,
					organizationId: input.organizationId,
					requesterEmployeeId: input.requesterEmployeeId,
					requesterUserId: lockedSource.requesterUserId,
					workPeriodId: input.workPeriodId,
				});
			if (evidence.resultKind === "chain_created" && !replayChainInstanceId) {
				throw pendingTimeCorrectionConflict(input.workPeriodId);
			}
			if (evidence.resultKind === "auto_completed") {
				return {
					disposition: "replayed",
					kind: "auto_completed",
					chainInstanceId: stage?.chainInstanceId ?? null,
					approvalRequestId: replay.id,
					reason: "requester_is_approver",
					autoCompletion: await loadCanonicalAutoCompletionReplay({
						dbService: input.dbService,
						organizationId: input.organizationId,
						requesterEmployeeId: input.requesterEmployeeId,
						workPeriodId: input.workPeriodId,
						correction,
					}),
					postCommit: {
						authority: "legacy",
						submittedToEmployeeId: null,
						terminal: null,
					},
				};
			}
			return {
				disposition: "replayed",
				kind: evidence.resultKind,
				...(evidence.resultKind === "chain_created" && replayChainInstanceId
					? { chainInstanceId: replayChainInstanceId }
					: {}),
				approvalRequestId: replay.id,
				postCommit: {
					authority: "legacy",
					submittedToEmployeeId: null,
					terminal: null,
				},
			} as TimeCorrectionSubmissionResult;
		}
		const pending = requests.find((request) => request.status === "pending");
		if (pending) {
			throw pendingTimeCorrectionConflict(input.workPeriodId);
		}
		let created: TimeCorrectionApprovalWorkflowResult | null = null;
		let captureCount = 0;
		const capturedAt = (input.nowInstant ?? (() => systemClock.nowInstant()))();
		const capture =
			input.captureLegacyState ?? captureTimeCorrectionLegacyApprovalState;
		const coordinator = createLegacyApprovalWriteCoordinator({
			writeGate: fixedGate,
			compatibilityWriter: transactionContext.compatibilityWriter,
		});
		const result = await coordinator.execute({
			organizationId: input.organizationId,
			workflowType: "time_correction",
			sourceIdentity: {
				organizationId: input.organizationId,
				workflowType: "time_correction",
				sourceType: "time_entry",
				sourceId: input.workPeriodId,
			},
			actor: {
				kind: "employee",
				employeeId: input.requesterEmployeeId,
				userId: null,
			},
			idempotencyKey: input.submissionKey,
			expectedVersion: null,
			captureState: async () => {
				captureCount += 1;
				return await capture({
					dbService: input.dbService,
					organizationId: input.organizationId,
					workPeriodId: input.workPeriodId,
					capturedAt,
					...(captureCount > 1 && created
						? {
								expectedCorrection: correction,
								expectedLegacyCycle: resultCycle(created),
							}
						: {}),
				});
			},
			mutate: async () => {
				created = await Effect.runPromise(
					createTimeCorrectionApprovalWorkflow(input.dbService, {
						organizationId: input.organizationId,
						requesterEmployeeId: input.requesterEmployeeId,
						teamId: input.teamId,
						workPeriodId: input.workPeriodId,
						defaultApproverId: input.defaultApproverId,
						reason: input.reason ?? undefined,
						overtimeRisk: input.overtimeRisk,
						correctionAction: correction.action,
						correctionEntryIds: {
							clockInCorrectionId: correction.clockInCorrectionId,
							clockOutCorrectionId: correction.clockOutCorrectionId,
						},
						transactionBehavior: "existing",
						submissionKey: input.submissionKey,
						submissionId: input.submissionId,
					}),
				);
				return created;
			},
			afterMirror: async (observed) => {
				await bindTimeCorrectionWorkflowToWorkPeriod({
					dbService: input.dbService,
					organizationId: input.organizationId,
					workPeriodId: input.workPeriodId,
					employeeId: input.requesterEmployeeId,
					workflowId: observed.snapshot.id,
				});
			},
		});
		const submittedTo =
			result.kind === "auto_completed"
				? null
				: await submittedToEmployeeId(
						input.dbService,
						input.organizationId,
						result.approvalRequestId,
					);
		return {
			...result,
			disposition: "executed",
			postCommit: legacySubmissionPostCommit(input, result, submittedTo),
		};
	}

	const sourceIdentity = {
		organizationId: input.organizationId,
		workflowType: "time_correction" as const,
		sourceType: "time_entry",
		sourceId: input.workPeriodId,
	};
	const routingContext = {
		organizationId: input.organizationId,
		workflowType: "time_correction" as const,
		source: { type: "time_entry", id: input.workPeriodId },
		requesterEmployeeId: input.requesterEmployeeId,
		teamIds: input.teamId ? [input.teamId] : [],
		locationId: null,
		absenceCategoryId: null,
		travelExpenseAmount: null,
		overtimeRisk: input.overtimeRisk,
		employeeGroupIds: [],
	};
	const contextSnapshot = { ...routingContext, timeCorrection: correction };
	if (input.submissionId) {
		const cycleWorkflow =
			await input.dbService.db.query.approvalWorkflow.findFirst({
				where: and(
					eq(approvalWorkflow.organizationId, input.organizationId),
					eq(approvalWorkflow.workflowType, "time_correction"),
					eq(approvalWorkflow.sourceType, sourceIdentity.sourceType),
					eq(approvalWorkflow.sourceId, sourceIdentity.sourceId),
					sql`${approvalWorkflow.contextSnapshot} -> 'submission' ->> 'submissionId' = ${input.submissionId}`,
				),
			});
		if (
			cycleWorkflow &&
			submissionIdFromMetadata(cycleWorkflow.contextSnapshot) ===
				input.submissionId &&
			submissionKeyFromMetadata(cycleWorkflow.contextSnapshot) !==
				input.submissionKey
		) {
			throw pendingTimeCorrectionConflict(input.workPeriodId);
		}
	}
	const expectedWorkflowId = deriveApprovalWorkflowId({
		organizationId: input.organizationId,
		workflowType: "time_correction",
		sourceType: sourceIdentity.sourceType,
		sourceId: sourceIdentity.sourceId,
		allocationKey: input.submissionKey,
	});
	const exactWorkflowRow =
		await input.dbService.db.query.approvalWorkflow.findFirst({
			where: and(
				eq(approvalWorkflow.id, expectedWorkflowId),
				eq(approvalWorkflow.organizationId, input.organizationId),
				eq(approvalWorkflow.workflowType, "time_correction"),
				eq(approvalWorkflow.sourceType, sourceIdentity.sourceType),
				eq(approvalWorkflow.sourceId, sourceIdentity.sourceId),
			),
			columns: { id: true },
		});
	if (exactWorkflowRow?.id === expectedWorkflowId) {
		const replaySnapshot = await transactionContext.repository.loadSnapshot({
			organizationId: input.organizationId,
			workflowId: expectedWorkflowId,
		});
		if (
			replaySnapshot.organizationId !== input.organizationId ||
			replaySnapshot.workflowType !== "time_correction" ||
			replaySnapshot.sourceType !== sourceIdentity.sourceType ||
			replaySnapshot.sourceId !== sourceIdentity.sourceId ||
			replaySnapshot.requesterEmployeeId !== input.requesterEmployeeId ||
			!sameCorrectionPayload(replaySnapshot.contextSnapshot, correction)
		) {
			throw pendingTimeCorrectionConflict(input.workPeriodId);
		}
		let evidence: TimeCorrectionSubmissionEvidence | null;
		try {
			evidence = parseSubmissionEvidence(
				replaySnapshot.contextSnapshot,
				input.submissionKey,
				input.submissionId,
			);
		} catch {
			throw pendingTimeCorrectionConflict(input.workPeriodId);
		}
		if (!evidence) {
			const historicalAuto = parseHistoricalAutoApprovalEvidence(
				replaySnapshot.contextSnapshot,
			);
			const autoCompletedByStages = replaySnapshot.stages.every(
				(stage) => stage.activationMode === "requester_auto_approve",
			);
			const hasHumanStage = replaySnapshot.stages.some(
				(stage) => stage.activationMode !== "requester_auto_approve",
			);
			if (
				historicalAuto === "invalid" ||
				(historicalAuto === "requester_auto_approved" &&
					(!autoCompletedByStages || replaySnapshot.status !== "approved")) ||
				(historicalAuto === "absent" && !hasHumanStage)
			) {
				throw pendingTimeCorrectionConflict(input.workPeriodId);
			}
			evidence = submissionEvidenceFor(
				input.submissionKey,
				historicalAuto === "requester_auto_approved"
					? "auto_completed"
					: replaySnapshot.stages.length > 1
						? "chain_created"
						: "default_created",
				input.submissionId,
			);
		}
		await verifyTimeCorrectionWorkflowBinding({
			dbService: input.dbService,
			organizationId: input.organizationId,
			workPeriodId: input.workPeriodId,
			employeeId: input.requesterEmployeeId,
			workflowId: replaySnapshot.id,
		});
		const compatibilityId =
			authority.mode === "canonical"
				? await resolveOriginalTimeCorrectionCompatibilityApprovalId({
						dbService: input.dbService,
						organizationId: input.organizationId,
						workPeriodId: input.workPeriodId,
						workflow: replaySnapshot,
					})
				: null;
		const originalHumanStage = replaySnapshot.stages.find(
			(stage) => stage.activationMode !== "requester_auto_approve",
		);
		const approvalRequestId =
			compatibilityId ??
			originalHumanStage?.legacyApprovalRequestId ??
			(authority.mode === "canonical" ? originalHumanStage?.id : null) ??
			originalHumanStage?.assignments.at(0)?.id ??
			replaySnapshot.id;
		if (evidence.resultKind === "auto_completed") {
			return {
				disposition: "replayed",
				kind: "auto_completed",
				chainInstanceId:
					replaySnapshot.stages.length > 1 ? replaySnapshot.id : null,
				approvalRequestId,
				reason: "requester_is_approver",
				autoCompletion: await loadCanonicalAutoCompletionReplay({
					dbService: input.dbService,
					organizationId: input.organizationId,
					requesterEmployeeId: input.requesterEmployeeId,
					workPeriodId: input.workPeriodId,
					correction,
				}),
				postCommit: {
					authority: "canonical",
					submittedToEmployeeId: null,
					terminal: null,
				},
			};
		}
		return {
			disposition: "replayed",
			kind: evidence.resultKind,
			...(evidence.resultKind === "chain_created"
				? { chainInstanceId: replaySnapshot.id }
				: {}),
			approvalRequestId,
			postCommit: {
				authority: "canonical",
				submittedToEmployeeId: null,
				terminal: null,
			},
		} as TimeCorrectionSubmissionResult;
	}
	const started = await startApprovalWorkflow({
		context: transactionContext,
		organizationId: input.organizationId,
		workflowType: "time_correction",
		sourceIdentity,
		requesterEmployeeId: input.requesterEmployeeId,
		actor: {
			kind: "employee",
			employeeId: input.requesterEmployeeId,
			userId: null,
		},
		submissionKey: input.submissionKey,
		defaultApproverEmployeeId: input.defaultApproverId,
		routingContext,
		contextSnapshot,
		finalizeContextSnapshot: ({ snapshot, contextSnapshot: stableContext }) => {
			const resultKind: TimeCorrectionSubmissionResultKind =
				snapshot.status === "approved"
					? "auto_completed"
					: snapshot.stages.length > 1
						? "chain_created"
						: "default_created";
			return {
				...stableContext,
				submission: submissionEvidenceFor(
					input.submissionKey,
					resultKind,
					input.submissionId,
				),
			};
		},
		displayProjection: {
			displayPayload: {
				title: "Time correction",
				action: correction.action,
				endpoints: [
					...(correction.clockInCorrectionId ? ["Clock in"] : []),
					...(correction.clockOutCorrectionId ? ["Clock out"] : []),
				],
			},
			searchText: `time correction ${correction.action}`,
		},
		bindSourceWorkflow: async (workflowId) => {
			await bindTimeCorrectionWorkflowToWorkPeriod({
				dbService: input.dbService,
				organizationId: input.organizationId,
				workPeriodId: input.workPeriodId,
				employeeId: input.requesterEmployeeId,
				workflowId,
			});
			return {
				organizationId: input.organizationId,
				sourceType: sourceIdentity.sourceType,
				sourceId: sourceIdentity.sourceId,
				workflowId,
				affectedRows: 1,
			};
		},
		verifySourceWorkflow: async (workflowId) => {
			await verifyTimeCorrectionWorkflowBinding({
				dbService: input.dbService,
				organizationId: input.organizationId,
				workPeriodId: input.workPeriodId,
				employeeId: input.requesterEmployeeId,
				workflowId,
			});
			return {
				organizationId: input.organizationId,
				sourceType: sourceIdentity.sourceType,
				sourceId: sourceIdentity.sourceId,
				workflowId,
				affectedRows: 1,
			};
		},
	});
	if (started.kind === "created" && authority.mode === "canonical") {
		await transactionContext.compatibilityWriter.mirrorCanonicalToLegacy({
			result: {
				snapshot: started.snapshot,
				events: started.events,
				projection: started.projection,
				outbox: started.outbox,
			},
		});
	}
	const compatibilityId =
		authority.mode === "canonical"
			? await resolveTimeCorrectionCompatibilityApprovalId({
					dbService: input.dbService,
					organizationId: input.organizationId,
					workPeriodId: input.workPeriodId,
					workflow: started.snapshot,
				})
			: null;
	const activeAssignmentId = started.snapshot.stages
		.find(
			(stage) =>
				stage.sequence === started.snapshot.currentStageOrder &&
				stage.status === "pending",
		)
		?.assignments.find((assignment) => assignment.status === "pending")?.id;
	const approvalId =
		compatibilityId ?? activeAssignmentId ?? started.snapshot.id;
	if (started.terminal) {
		if (started.status !== "approved") {
			throw new Error(
				"Time correction submission reached an invalid terminal state",
			);
		}
		if (started.kind === "existing") {
			const autoCompletion = await loadCanonicalAutoCompletionReplay({
				dbService: input.dbService,
				organizationId: input.organizationId,
				requesterEmployeeId: input.requesterEmployeeId,
				workPeriodId: input.workPeriodId,
				correction,
			});
			return {
				disposition: "replayed",
				kind: "auto_completed",
				chainInstanceId:
					started.snapshot.stages.length > 1 ? started.snapshot.id : null,
				approvalRequestId: approvalId,
				reason: "requester_is_approver",
				autoCompletion,
				postCommit: {
					authority: "canonical",
					submittedToEmployeeId: null,
					terminal: null,
				},
			};
		}
		const requester = requesterAutoCompletionActor({
			started,
			requesterEmployeeId: input.requesterEmployeeId,
			requesterUserId: lockedSource.requesterUserId,
		});
		const finalized = await finalizeTimeCorrectionTerminalDetailedInTransaction(
			{
				dbService: input.dbService,
				organizationId: input.organizationId,
				workPeriodId: input.workPeriodId,
				expectedApprovalWorkflowId: started.snapshot.id,
				expectedApprovalWorkflowVersion: started.snapshot.version,
				expectedRequesterEmployeeId: input.requesterEmployeeId,
				actorEmployeeId: requester.employeeId,
				actorUserId: requester.userId,
				correction,
				legacyApprovalRequestId:
					started.snapshot.status === "pending" ? compatibilityId : null,
				transition: { kind: "approve", reason: input.reason },
				finalizedAt: started.snapshot.completedAt ?? systemClock.nowInstant(),
				allowMetadataLessLegacyFallback: false,
			},
		);
		return {
			disposition: "executed",
			kind: "auto_completed",
			chainInstanceId:
				started.snapshot.stages.length > 1 ? started.snapshot.id : null,
			approvalRequestId: approvalId,
			reason: "requester_is_approver",
			autoCompletion: {
				period: finalized.period,
				originalNotificationTime: finalized.originalNotificationTime,
				correctedNotificationTime: finalized.correctedNotificationTime,
				workBalanceDirtyMark: finalized.dirtyFromDate
					? {
							employeeId: finalized.requesterEmployeeId,
							organizationId: input.organizationId,
							dirtyFromDate: finalized.dirtyFromDate,
						}
					: undefined,
			},
			postCommit: {
				authority: "canonical",
				submittedToEmployeeId: null,
				terminal: null,
			},
		};
	}
	return {
		disposition: "executed",
		kind:
			started.snapshot.stages.length > 1 ? "chain_created" : "default_created",
		...(started.snapshot.stages.length > 1
			? { chainInstanceId: started.snapshot.id }
			: {}),
		approvalRequestId: approvalId,
		postCommit: {
			authority: "canonical",
			submittedToEmployeeId: null,
			terminal: null,
		},
	} as TimeCorrectionSubmissionResult;
}

export interface TimeCorrectionDecisionRuntime {
	repository: ApprovalWorkflowRepository;
	transitionEngine: Pick<ApprovalTransitionEngine, "executeInTransaction">;
}

async function dispatchTimeCorrectionDecisionPostCommit(input: {
	dbService: ApprovalDbService;
	actor: CurrentApprover;
	approvalRequestId: string;
	effects: TimeCorrectionPostCommitEffects | null;
	reason?: string;
}): Promise<void> {
	const effects = input.effects;
	if (effects?.authority !== "legacy" || effects.terminal === null) {
		return;
	}
	const request = await input.dbService.db.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, input.approvalRequestId),
			eq(approvalRequest.organizationId, input.actor.organizationId),
			eq(approvalRequest.entityType, "time_entry"),
		),
	});
	if (!request)
		throw new Error("Committed time correction request was not found");
	const correction = normalizeTimeCorrectionWorkflowPayload(
		request.metadata,
	).timeCorrection;
	const result = await loadCanonicalAutoCompletionReplay({
		dbService: input.dbService,
		organizationId: input.actor.organizationId,
		requesterEmployeeId: effects.terminal.requesterEmployeeId,
		workPeriodId: request.entityId,
		correction,
	});
	if (effects.terminal.kind === "approved") {
		await markEmployeeWorkBalanceDirtyIfNeeded({
			employeeId: effects.terminal.requesterEmployeeId,
			organizationId: input.actor.organizationId,
			dirtyFromDate: effects.terminal.dirtyFromDate,
		});
		notifyApprovedCorrection(
			result.period,
			request.entityId,
			input.actor,
			result.originalNotificationTime,
			result.correctedNotificationTime,
		);
		return;
	}
	notifyRejectedCorrection(
		result.period,
		request.entityId,
		input.actor,
		input.reason ?? request.rejectionReason ?? "",
		result.originalNotificationTime,
		result.correctedNotificationTime,
	);
}

export async function completeTimeCorrectionDecisionAfterCommit<
	T extends { postCommit: TimeCorrectionPostCommitEffects | null },
>(input: {
	execute(): Promise<T>;
	dispatch(effects: TimeCorrectionPostCommitEffects): Promise<void>;
	onDispatchError?(error: unknown): void;
}): Promise<T> {
	const result = await input.execute();
	if (
		result.postCommit?.authority !== "legacy" ||
		result.postCommit.terminal === null
	) {
		return result;
	}
	try {
		await input.dispatch(result.postCommit);
	} catch (error) {
		input.onDispatchError?.(error);
	}
	return result;
}

export interface ExecuteTimeCorrectionDecisionInput {
	runtime: TimeCorrectionDecisionRuntime;
	organizationId: string;
	actorEmployeeId: string;
	actorUserId: string;
	approvalRequestId: string;
	action: "approve" | "reject";
	reason?: string;
	query?: ApprovalDbService["query"];
	processLegacy(
		dbService: ApprovalDbService,
		actor: CurrentApprover,
		transactionBehavior: "existing",
		workPeriodId: string,
	): Promise<unknown>;
	processOrdinary?(input: {
		dbService: ApprovalDbService;
		actor: CurrentApprover;
		workPeriodId: string;
		kind: "manual_time_submission" | "policy_clock_out";
	}): Promise<unknown>;
	captureLegacyState?: typeof captureTimeCorrectionLegacyApprovalState;
	nowInstant?: () => Instant;
}

function decisionFingerprint(reason: string | undefined): string {
	return createHash("sha256")
		.update(reason ?? "")
		.digest("hex");
}

interface CompatibilityTargetMetadata {
	workflowId: string;
	organizationId: string;
	stageId: string;
	stageSequence: number;
	assignmentId: string | null;
}

function exactOwnDataRecord(
	value: unknown,
	allowedKeys: readonly string[],
	requiredKeys: readonly string[],
): Record<string, unknown> | null {
	try {
		if (!value || typeof value !== "object" || Array.isArray(value))
			return null;
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) return null;
		const descriptors = Object.getOwnPropertyDescriptors(value);
		const keys = Reflect.ownKeys(descriptors);
		if (
			keys.some(
				(key) => typeof key !== "string" || !allowedKeys.includes(key),
			) ||
			requiredKeys.some((key) => !keys.includes(key)) ||
			keys.some((key) => {
				const descriptor = descriptors[String(key)];
				return !descriptor?.enumerable || !("value" in descriptor);
			})
		) {
			return null;
		}
		const stringKeys = keys as string[];
		return Object.fromEntries(
			stringKeys.map((key) => [key, descriptors[key]?.value]),
		);
	} catch {
		return null;
	}
}

function parseCompatibilityTargetMetadata(
	metadata: unknown,
): CompatibilityTargetMetadata | null {
	const root = exactOwnDataRecord(
		metadata,
		["workflow", "stage", "timeCorrection", "submission"],
		["workflow", "stage"],
	);
	if (!root) return null;
	const workflow = exactOwnDataRecord(
		root.workflow,
		["id", "organizationId"],
		["id", "organizationId"],
	);
	const stage = exactOwnDataRecord(
		root.stage,
		["id", "sequence", "assignmentId"],
		["id", "sequence"],
	);
	if (!workflow || !stage) return null;
	const assignmentId = stage.assignmentId;
	if (
		typeof workflow.id !== "string" ||
		workflow.id.length === 0 ||
		typeof workflow.organizationId !== "string" ||
		workflow.organizationId.length === 0 ||
		typeof stage.id !== "string" ||
		stage.id.length === 0 ||
		typeof stage.sequence !== "number" ||
		!Number.isSafeInteger(stage.sequence) ||
		stage.sequence < 1 ||
		(assignmentId !== undefined &&
			(typeof assignmentId !== "string" || assignmentId.length === 0))
	) {
		return null;
	}
	return {
		workflowId: workflow.id,
		organizationId: workflow.organizationId,
		stageId: stage.id,
		stageSequence: stage.sequence,
		assignmentId: typeof assignmentId === "string" ? assignmentId : null,
	};
}

export async function executeTimeCorrectionDecisionInTransaction(
	input: ExecuteTimeCorrectionDecisionInput,
) {
	try {
		return await input.runtime.repository.withTransaction(async (context) => {
			const transactionDb = context.dbService
				.db as unknown as ApprovalDbService["db"];
			const dbService: ApprovalDbService = {
				db: transactionDb,
				query:
					input.query ??
					(<T>(_name: string, operation: () => Promise<T>) =>
						Effect.promise(operation)),
			};
			const actors = await transactionDb.query.employee.findMany({
				where: and(
					eq(employee.organizationId, input.organizationId),
					eq(employee.userId, input.actorUserId),
					eq(employee.isActive, true),
				),
				with: { user: true },
				limit: 2,
			});
			const actor = actors[0] as CurrentApprover | undefined;
			if (
				actors.length !== 1 ||
				!actor ||
				actor.id !== input.actorEmployeeId ||
				actor.organizationId !== input.organizationId ||
				actor.userId !== input.actorUserId ||
				actor.user?.id !== input.actorUserId
			) {
				throw new NotFoundError({
					message: "Approval not found",
					entityType: "approval_request",
				});
			}
			const memberships = await transactionDb.query.member.findMany({
				where: and(
					eq(member.organizationId, input.organizationId),
					eq(member.userId, input.actorUserId),
				),
				columns: { organizationId: true, userId: true, status: true },
				limit: 2,
			});
			const membership = memberships[0];
			if (
				memberships.length !== 1 ||
				!membership ||
				membership.organizationId !== input.organizationId ||
				membership.userId !== input.actorUserId ||
				membership.status !== "approved"
			) {
				throw new NotFoundError({
					message: "Approval not found",
					entityType: "approval_request",
				});
			}
			const requestRow = await transactionDb.query.approvalRequest.findFirst({
				where: and(
					eq(approvalRequest.id, input.approvalRequestId),
					eq(approvalRequest.organizationId, input.organizationId),
					eq(approvalRequest.entityType, "time_entry"),
				),
			});
			const assignmentTarget = requestRow
				? null
				: await transactionDb.query.approvalStageAssignment.findFirst({
						where: and(
							eq(approvalStageAssignment.id, input.approvalRequestId),
							eq(approvalStageAssignment.organizationId, input.organizationId),
						),
						columns: { id: true, stageId: true },
					});
			const assignmentStage = assignmentTarget
				? await transactionDb.query.approvalWorkflowStage.findFirst({
						where: and(
							eq(approvalWorkflowStage.id, assignmentTarget.stageId),
							eq(approvalWorkflowStage.organizationId, input.organizationId),
						),
						columns: { workflowId: true },
					})
				: null;
			const canonicalTarget = requestRow
				? null
				: await transactionDb.query.approvalWorkflow.findFirst({
						where: and(
							eq(
								approvalWorkflow.id,
								assignmentStage?.workflowId ?? input.approvalRequestId,
							),
							eq(approvalWorkflow.organizationId, input.organizationId),
							eq(approvalWorkflow.workflowType, "time_correction"),
							eq(approvalWorkflow.sourceType, "time_entry"),
						),
						columns: {
							id: true,
							sourceId: true,
							requesterEmployeeId: true,
							status: true,
							contextSnapshot: true,
						},
					});
			if (
				(!requestRow && !canonicalTarget) ||
				(requestRow && requestRow.id !== input.approvalRequestId) ||
				(canonicalTarget && !canonicalTarget.requesterEmployeeId) ||
				(assignmentTarget && assignmentTarget.id !== input.approvalRequestId)
			) {
				throw new NotFoundError({
					message: "Approval not found",
					entityType: "approval_request",
				});
			}
			const request = requestRow ?? {
				id: input.approvalRequestId,
				entityId: canonicalTarget?.sourceId ?? "",
				requestedBy: canonicalTarget?.requesterEmployeeId ?? "",
				status: canonicalTarget?.status ?? "pending",
				metadata: canonicalTarget?.contextSnapshot ?? null,
				reason: null,
			};
			const period = await transactionDb.query.workPeriod.findFirst({
				where: and(
					eq(workPeriod.id, request.entityId),
					eq(workPeriod.organizationId, input.organizationId),
					eq(workPeriod.employeeId, request.requestedBy),
				),
				columns: {
					id: true,
					organizationId: true,
					employeeId: true,
					pendingChanges: true,
					clockInId: true,
					clockOutId: true,
					approvalWorkflowId: true,
				},
			});
			if (!period) {
				throw new NotFoundError({
					message: "Approval not found",
					entityType: "approval_request",
				});
			}
			let kind = classifyTimeApprovalRequest({
				metadata: request.metadata,
				reason: request.reason,
				pendingChanges: period.pendingChanges,
			});
			if (kind === "unclassified") {
				const endpointIds = [period.clockInId, period.clockOutId].filter(
					(id): id is string => Boolean(id),
				);
				const correctionEvidence = endpointIds.length
					? await transactionDb.query.timeEntry.findFirst({
							where: and(
								eq(timeEntry.organizationId, input.organizationId),
								eq(timeEntry.employeeId, request.requestedBy),
								eq(timeEntry.type, "correction"),
								eq(timeEntry.isSuperseded, false),
								inArray(timeEntry.replacesEntryId, endpointIds),
							),
						})
					: null;
				kind = classifyTimeApprovalRequest({
					metadata: request.metadata,
					reason: request.reason,
					pendingChanges: period.pendingChanges,
					hasRelationalCorrectionEvidence: Boolean(correctionEvidence),
				});
			}
			if (kind === "unclassified") {
				throw new ValidationError({
					message:
						"This legacy time approval could not be classified. Reconcile it before making a decision.",
					field: "approvalRequest.metadata.timeRequest.kind",
				});
			}
			if (kind === "manual_time_submission" || kind === "policy_clock_out") {
				if (!input.processOrdinary) {
					throw new Error(
						"Ordinary time approval decision handler is unavailable",
					);
				}
				return {
					kind,
					domainResult: await input.processOrdinary({
						dbService,
						actor,
						workPeriodId: period.id,
						kind,
					}),
					commandResult: undefined,
					postCommit: null,
				};
			}

			const authority = await context.writeGate.acquire({
				organizationId: input.organizationId,
				workflowType: "time_correction",
			});
			const fixedGate = fixedTimeCorrectionGate(
				input.organizationId,
				authority,
			);
			const decisionContext = {
				...context,
				writeGate: fixedGate,
				compatibilityWriter:
					context.compatibilityWriter.withWriteGate(fixedGate),
			} as ApprovalWorkflowTransactionContext;
			if (
				authority.mode === "legacy" ||
				authority.mode === "shadow" ||
				authority.mode === "ready"
			) {
				if (!requestRow) {
					throw new NotFoundError({
						message: "Approval not found",
						entityType: "approval_request",
					});
				}
				if (request.status !== "pending") {
					throw new ConflictError({
						message: `Approval request is already ${request.status}`,
						conflictType: "approval_status",
					});
				}
				const stage =
					await transactionDb.query.approvalChainStageInstance.findFirst({
						where: and(
							eq(
								approvalChainStageInstance.organizationId,
								input.organizationId,
							),
							eq(approvalChainStageInstance.approvalRequestId, request.id),
						),
						columns: { chainInstanceId: true },
					});
				const expectedCycle = {
					approvalRequestId: request.id,
					...(stage?.chainInstanceId
						? { chainInstanceId: stage.chainInstanceId }
						: {}),
				};
				const correction = correctionPayload(request.metadata);
				const capturedAt = (
					input.nowInstant ?? (() => systemClock.nowInstant())
				)();
				const observedWorkflow =
					authority.mode === "legacy"
						? null
						: period.approvalWorkflowId
							? await context.repository.loadSnapshot({
									organizationId: input.organizationId,
									workflowId: period.approvalWorkflowId,
								})
							: null;
				if (
					authority.mode !== "legacy" &&
					(!observedWorkflow ||
						observedWorkflow.organizationId !== input.organizationId ||
						observedWorkflow.workflowType !== "time_correction" ||
						observedWorkflow.sourceType !== "time_entry" ||
						observedWorkflow.sourceId !== period.id ||
						observedWorkflow.requesterEmployeeId !== period.employeeId ||
						observedWorkflow.status !== "pending")
				) {
					throw new ConflictError({
						message:
							"Approval workflow decision conflicts with the current state",
						conflictType: "approval_transition",
					});
				}
				const capture =
					input.captureLegacyState ?? captureTimeCorrectionLegacyApprovalState;
				const coordinator = createLegacyApprovalWriteCoordinator({
					writeGate: fixedGate,
					compatibilityWriter: decisionContext.compatibilityWriter,
				});
				const domainResult = await coordinator.execute({
					organizationId: input.organizationId,
					workflowType: "time_correction",
					sourceIdentity: {
						organizationId: input.organizationId,
						workflowType: "time_correction",
						sourceType: "time_entry",
						sourceId: period.id,
					},
					actor: {
						kind: "employee",
						employeeId: actor.id,
						userId: actor.userId,
					},
					idempotencyKey: `time-correction:${period.id}:${request.id}:${input.action}:${decisionFingerprint(input.reason)}`,
					expectedVersion: observedWorkflow?.version ?? null,
					captureState: () =>
						capture({
							dbService,
							organizationId: input.organizationId,
							workPeriodId: period.id,
							capturedAt,
							expectedCorrection: correction,
							expectedLegacyCycle: expectedCycle,
						}),
					mutate: () =>
						input.processLegacy(dbService, actor, "existing", period.id),
					afterMirror: async (observed) => {
						await bindTimeCorrectionWorkflowToWorkPeriod({
							dbService,
							organizationId: input.organizationId,
							workPeriodId: period.id,
							employeeId: period.employeeId,
							workflowId: observed.snapshot.id,
						});
					},
				});
				const terminalResult = domainResult as
					| TimeCorrectionApprovalResult
					| undefined;
				return {
					kind: "time_correction" as const,
					domainResult,
					commandResult: undefined,
					postCommit: terminalResult
						? {
								authority: "legacy" as const,
								submittedToEmployeeId: null,
								terminal:
									input.action === "approve"
										? {
												kind: "approved" as const,
												dirtyFromDate:
													terminalResult.workBalanceDirtyMark?.dirtyFromDate ??
													"",
												requesterEmployeeId: period.employeeId,
											}
										: {
												kind: "rejected" as const,
												requesterEmployeeId: period.employeeId,
											},
							}
						: null,
				};
			}

			if (!period.approvalWorkflowId) {
				throw new ConflictError({
					message:
						"Approval workflow decision conflicts with the current state",
					conflictType: "approval_transition",
				});
			}
			const workflow = await context.repository.loadSnapshot({
				organizationId: input.organizationId,
				workflowId: period.approvalWorkflowId,
			});
			if (
				workflow.organizationId !== input.organizationId ||
				workflow.workflowType !== "time_correction" ||
				workflow.sourceType !== "time_entry" ||
				workflow.sourceId !== period.id ||
				workflow.requesterEmployeeId !== period.employeeId
			) {
				throw new ConflictError({
					message:
						"Approval workflow decision conflicts with the current state",
					conflictType: "approval_transition",
				});
			}
			const targets = requestRow
				? (() => {
						const metadata = parseCompatibilityTargetMetadata(request.metadata);
						if (
							!metadata ||
							metadata.workflowId !== workflow.id ||
							metadata.organizationId !== input.organizationId ||
							typeof requestRow.approverId !== "string"
						) {
							return [];
						}
						const stages = workflow.stages.filter(
							(stage) =>
								stage.id === metadata.stageId &&
								stage.sequence === metadata.stageSequence &&
								(request.status !== "pending" ||
									stage.sequence === workflow.currentStageOrder) &&
								stage.organizationId === input.organizationId &&
								stage.workflowId === workflow.id &&
								stage.legacyApprovalRequestId === input.approvalRequestId,
						);
						const stage = stages[0];
						if (stages.length !== 1 || !stage) return [];
						return stage.assignments
							.filter(
								(assignment) =>
									(metadata.assignmentId !== null
										? assignment.id === metadata.assignmentId
										: request.status === "pending" &&
											assignment.status === "pending") &&
									assignment.organizationId === input.organizationId &&
									assignment.workflowId === workflow.id &&
									assignment.stageId === stage.id &&
									assignment.approverEmployeeId === requestRow.approverId,
							)
							.map((assignment) => ({ stage, assignment }));
					})()
				: workflow.stages.flatMap((stage) =>
						stage.assignments
							.filter(
								(assignment) =>
									assignment.id === input.approvalRequestId &&
									assignment.organizationId === input.organizationId &&
									assignment.workflowId === workflow.id &&
									assignment.stageId === stage.id,
							)
							.map((assignment) => ({ stage, assignment })),
					);
			const target = targets[0];
			if (targets.length !== 1 || !target) {
				throw new ConflictError({
					message:
						"Approval workflow decision conflicts with the current state",
					conflictType: "approval_transition",
				});
			}
			const commandResult =
				await input.runtime.transitionEngine.executeInTransaction(
					decisionContext,
					{
						organizationId: input.organizationId,
						workflowId: workflow.id,
						expectedVersion: workflow.version,
						idempotencyKey: `time-correction:${input.organizationId}:${workflow.id}:${input.approvalRequestId}:${input.action}:${decisionFingerprint(input.reason)}`,
						principal: { kind: "employee", userId: actor.userId },
						command:
							input.action === "approve"
								? {
										type: "approve",
										stageId: target.stage.id,
										assignmentId: target.assignment.id,
									}
								: {
										type: "reject",
										stageId: target.stage.id,
										assignmentId: target.assignment.id,
										reason: input.reason ?? "",
									},
					},
				);
			return {
				kind: "time_correction" as const,
				domainResult: undefined,
				commandResult,
				postCommit: {
					authority: "canonical" as const,
					submittedToEmployeeId: null,
					terminal: null,
				},
			};
		});
	} catch (error) {
		throw translateTimeCorrectionDecisionError(error);
	}
}

export function decideTimeCorrectionWithStableTargetEffect(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	approvalRequestId: string,
	action: "approve" | "reject",
	reason?: string,
	options?: ApprovalActionOptions,
) {
	return Effect.tryPromise({
		try: async () => {
			const runtime = createProductionApprovalWorkflowRuntime({
				db: dbService.db,
				adapters: {
					absence: {
						clock: systemClock,
						finalizeAbsenceTerminal: async () => {
							throw new Error("Absence finalization is outside this boundary");
						},
						deleteCancelledAbsence: async () => {
							throw new Error("Absence cancellation is outside this boundary");
						},
					},
					timeCorrection: {
						clock: systemClock,
						finalizeTimeCorrectionTerminal:
							finalizeTimeCorrectionTerminalInTransaction,
						deleteCancelledCorrections:
							deleteCancelledTimeCorrectionsInTransaction,
					},
				},
				canManageApproval: async (authorization) => {
					if (
						authorization.organizationId !== currentEmployee.organizationId ||
						authorization.actorEmployeeId !== currentEmployee.id
					) {
						return false;
					}
					const ability = await getAbility();
					if (ability?.cannot("manage", "Approval") === false) return true;
					const command = authorization.command;
					if (command.type !== "approve" && command.type !== "reject") {
						return false;
					}
					const stage = authorization.workflow.stages.find(
						(candidate) =>
							candidate.id === command.stageId &&
							candidate.sequence === authorization.workflow.currentStageOrder &&
							candidate.status === "pending",
					);
					if (!stage?.legacyApprovalRequestId) return false;
					return await isEligibleManagerForApprovalRequest({
						db: authorization.dbService.db as never,
						approvalRequestId: stage.legacyApprovalRequestId,
						managerEmployeeId: currentEmployee.id,
						organizationId: authorization.organizationId,
					});
				},
				clock: systemClock,
			});
			const execution = await completeTimeCorrectionDecisionAfterCommit({
				execute: () =>
					executeTimeCorrectionDecisionInTransaction({
						runtime,
						organizationId: currentEmployee.organizationId,
						actorEmployeeId: currentEmployee.id,
						actorUserId: currentEmployee.userId,
						approvalRequestId,
						action,
						reason,
						query: dbService.query,
						processLegacy: async (
							transactionDbService,
							actor,
							_transactionBehavior,
							workPeriodId,
						) =>
							await Effect.runPromise(
								processApprovalWithCurrentEmployee(
									transactionDbService,
									actor,
									"time_entry",
									workPeriodId,
									action,
									reason,
									action === "approve"
										? persistApprovedTimeCorrection
										: (service, entityId, approver, approval) =>
												persistRejectedTimeCorrection(
													service,
													entityId,
													approver,
													reason ?? "",
													approval,
												),
									undefined,
									{ ...options, approvalRequestId, transactional: true },
									undefined,
									"existing",
								).pipe(
									Effect.provideService(
										ApprovalAuditLogger,
										createApprovalAuditLogger(transactionDbService),
									),
								) as Effect.Effect<unknown, AnyAppError, never>,
							),
						processOrdinary: async ({
							dbService: transactionDbService,
							actor,
							workPeriodId,
							kind,
						}) =>
							await Effect.runPromise(
								decideWorkPeriodWithCurrentApproverInTransaction(
									transactionDbService,
									actor,
									workPeriodId,
									kind,
									action,
									reason,
									{ ...options, approvalRequestId },
								).pipe(
									Effect.provideService(
										ApprovalAuditLogger,
										createApprovalAuditLogger(transactionDbService),
									),
								) as Effect.Effect<unknown, AnyAppError, never>,
							),
					}),
				dispatch: (effects) =>
					dispatchTimeCorrectionDecisionPostCommit({
						dbService,
						actor: currentEmployee,
						approvalRequestId,
						effects,
						reason,
					}),
				onDispatchError: (error) =>
					logger.error(
						{ error, approvalRequestId, action },
						"Time correction decision after-commit work failed",
					),
			});
			if (
				(execution.kind === "manual_time_submission" ||
					execution.kind === "policy_clock_out") &&
				execution.domainResult
			) {
				await Effect.runPromise(
					notifyWorkPeriodApprovalAfterCommit(
						execution.domainResult as WorkPeriodApprovalResult,
						currentEmployee,
						dbService,
					),
				);
			}
		},
		catch: (error) => error as AnyAppError,
	});
}

export function createTimeCorrectionApprovalWorkflow(
	dbService: ApprovalDbService,
	input: {
		organizationId: string;
		requesterEmployeeId: string;
		teamId: string | null;
		workPeriodId: string;
		defaultApproverId: string | null;
		reason?: string;
		overtimeRisk: ApprovalPolicyOvertimeRisk | null;
		transactionBehavior?: "open" | "existing";
		submissionKey?: string;
		submissionId?: string;
		correctionAction?: TimeCorrectionAction;
		correctionEntryIds?: {
			clockInCorrectionId?: string;
			clockOutCorrectionId?: string;
		};
	},
): Effect.Effect<TimeCorrectionApprovalWorkflowResult, AnyAppError, never> {
	const correctionAction = input.correctionAction ?? "edit";
	const correctionEntryIds = input.correctionEntryIds;
	if (
		correctionEntryIds &&
		Object.hasOwn(correctionEntryIds, "clockInCorrectionId") &&
		correctionEntryIds.clockInCorrectionId !== undefined &&
		(typeof correctionEntryIds.clockInCorrectionId !== "string" ||
			correctionEntryIds.clockInCorrectionId.trim().length === 0)
	) {
		return Effect.fail(
			new ValidationError({
				message: "Correction entry IDs must not be blank",
				field: "correctionEntryIds.clockInCorrectionId",
			}),
		);
	}
	if (
		correctionEntryIds &&
		Object.hasOwn(correctionEntryIds, "clockOutCorrectionId") &&
		correctionEntryIds.clockOutCorrectionId !== undefined &&
		(typeof correctionEntryIds.clockOutCorrectionId !== "string" ||
			correctionEntryIds.clockOutCorrectionId.trim().length === 0)
	) {
		return Effect.fail(
			new ValidationError({
				message: "Correction entry IDs must not be blank",
				field: "correctionEntryIds.clockOutCorrectionId",
			}),
		);
	}
	if (
		correctionEntryIds &&
		!correctionEntryIds.clockInCorrectionId &&
		!correctionEntryIds.clockOutCorrectionId
	) {
		return Effect.fail(
			new ValidationError({
				message:
					"Time correction approval must link at least one correction entry",
				field: "correctionEntryIds",
			}),
		);
	}
	if (
		correctionAction === "delete" &&
		(!correctionEntryIds?.clockInCorrectionId ||
			!correctionEntryIds.clockOutCorrectionId)
	) {
		return Effect.fail(
			new ValidationError({
				message:
					"Deletion approval requires clock-in and clock-out correction entries",
				field: "correctionEntryIds",
			}),
		);
	}

	const metadata: Record<string, unknown> | undefined = input.correctionEntryIds
		? {
				timeCorrection: {
					action: correctionAction,
					...(input.correctionEntryIds.clockInCorrectionId
						? {
								clockInCorrectionId:
									input.correctionEntryIds.clockInCorrectionId,
							}
						: {}),
					...(input.correctionEntryIds.clockOutCorrectionId
						? {
								clockOutCorrectionId:
									input.correctionEntryIds.clockOutCorrectionId,
							}
						: {}),
				},
			}
		: undefined;

	const createApproval = ensureNoPendingTimeCorrectionApproval(
		dbService,
		input.organizationId,
		input.workPeriodId,
	).pipe(
		Effect.flatMap(() =>
			resolvePolicyAndCreateApproval(dbService, {
				context: buildTimeCorrectionApprovalPolicyContext(input),
				defaultApproverId: input.defaultApproverId,
				reason: input.reason,
				metadata,
				...(input.submissionKey
					? {
							metadataForResultKind: (
								resultKind: TimeCorrectionSubmissionResultKind,
							) => ({
								...(metadata ?? {}),
								submission: submissionEvidenceFor(
									input.submissionKey as string,
									resultKind,
									input.submissionId,
								),
							}),
						}
					: {}),
				transactionBehavior: input.transactionBehavior,
			}),
		),
		Effect.catchAll((error) => {
			if (
				error instanceof DatabaseError &&
				isPendingApprovalUniqueConflict(error)
			) {
				return Effect.fail(pendingTimeCorrectionConflict(input.workPeriodId));
			}

			return Effect.fail(error);
		}),
	);

	return createApproval.pipe(
		Effect.flatMap(
			(
				result,
			): Effect.Effect<
				TimeCorrectionApprovalWorkflowResult,
				AnyAppError,
				never
			> =>
				result.kind === "auto_completed"
					? Effect.all({
							requester: loadAutoApprovalRequester(
								dbService,
								input.requesterEmployeeId,
								input.organizationId,
							),
							approval: loadAutoCompletedApprovalRequest(
								dbService,
								result.approvalRequestId,
								input.organizationId,
							),
						}).pipe(
							Effect.flatMap(({ requester, approval }) =>
								persistApprovedTimeCorrection(
									dbService,
									input.workPeriodId,
									requester,
									approval,
								),
							),
							Effect.map((autoCompletion) => ({ ...result, autoCompletion })),
						)
					: Effect.succeed(result),
		),
	);
}

export async function runAutoCompletedTimeCorrectionMaintenance(
	result: TimeCorrectionApprovalResult,
) {
	await markEmployeeWorkBalanceDirtyIfNeeded(result.workBalanceDirtyMark);
}

function loadAutoApprovalRequester(
	dbService: ApprovalDbService,
	requesterEmployeeId: string,
	organizationId: string,
) {
	return dbService
		.query("getAutoApprovalRequester", async () => {
			return await dbService.db.query.employee.findFirst({
				where: and(
					eq(employee.id, requesterEmployeeId),
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
				),
				with: { user: true },
			});
		})
		.pipe(
			Effect.flatMap((requester) =>
				requester
					? Effect.succeed(requester as CurrentApprover)
					: Effect.fail(
							new NotFoundError({
								message: "Auto-approval requester not found",
								entityType: "employee",
								entityId: requesterEmployeeId,
							}),
						),
			),
		);
}

function loadAutoCompletedApprovalRequest(
	dbService: ApprovalDbService,
	approvalRequestId: string,
	organizationId: string,
) {
	return dbService
		.query("getAutoCompletedApprovalRequest", async () => {
			return await dbService.db.query.approvalRequest.findFirst({
				where: and(
					eq(approvalRequest.id, approvalRequestId),
					eq(approvalRequest.organizationId, organizationId),
					eq(approvalRequest.status, "approved"),
				),
			});
		})
		.pipe(
			Effect.flatMap((approval) =>
				approval
					? Effect.succeed(approval as PendingApprovalRequest)
					: Effect.fail(
							new NotFoundError({
								message: "Auto-completed approval request not found",
								entityType: "approval_request",
								entityId: approvalRequestId,
							}),
						),
			),
		);
}

function ensureNoPendingTimeCorrectionApproval(
	dbService: ApprovalDbService,
	organizationId: string,
	workPeriodId: string,
) {
	return dbService
		.query("getPendingTimeCorrectionApproval", async () => {
			return await dbService.db.query.approvalRequest.findFirst({
				where: and(
					eq(approvalRequest.organizationId, organizationId),
					eq(approvalRequest.entityType, "time_entry"),
					eq(approvalRequest.entityId, workPeriodId),
					eq(approvalRequest.status, "pending"),
				),
			});
		})
		.pipe(
			Effect.flatMap((pendingApproval) =>
				pendingApproval
					? Effect.fail(pendingTimeCorrectionConflict(workPeriodId))
					: Effect.void,
			),
		);
}

export async function syncCanonicalWorkCorrection(
	input: {
		organizationId: string;
		canonicalRecordId: string | null;
		startAt: Date;
		endAt: Date | null;
		durationMinutes: number | null;
		updatedBy: string;
	},
	client: ApprovalDbService["db"] = db,
): Promise<void> {
	if (!input.canonicalRecordId) {
		return;
	}

	await client
		.update(timeRecord)
		.set({
			startAt: input.startAt,
			endAt: input.endAt,
			durationMinutes: input.durationMinutes,
			updatedAt: currentTimestamp(),
			updatedBy: input.updatedBy,
		})
		.where(
			and(
				eq(timeRecord.id, input.canonicalRecordId),
				eq(timeRecord.organizationId, input.organizationId),
				eq(timeRecord.recordKind, "work"),
			),
		);
}

export function approveTimeCorrectionWithCurrentApproverEffect(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	workPeriodId: string,
	options?: ApprovalActionOptions,
) {
	return processApprovalWithCurrentEmployee(
		dbService,
		currentEmployee,
		"time_entry",
		workPeriodId,
		"approve",
		undefined,
		handleApprovedTimeCorrection,
		undefined,
		{ ...options, transactional: true },
		{
			updateEntity: persistApprovedTimeCorrection,
			afterCommit: (result, _dbService, entityId, approver) =>
				completeApprovedTimeCorrectionAfterCommit(entityId, approver, result),
		},
	);
}

export function rejectTimeCorrectionWithCurrentApproverEffect(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	workPeriodId: string,
	reason: string,
	options?: ApprovalActionOptions,
) {
	return processApprovalWithCurrentEmployee(
		dbService,
		currentEmployee,
		"time_entry",
		workPeriodId,
		"reject",
		reason,
		(decisionDbService, entityId, approver, approval) =>
			handleRejectedTimeCorrection(
				decisionDbService,
				entityId,
				approver,
				reason,
				approval,
			),
		undefined,
		{ ...options, transactional: true },
		{
			updateEntity: (decisionDbService, entityId, approver, approval) =>
				persistRejectedTimeCorrection(
					decisionDbService,
					entityId,
					approver,
					reason,
					approval,
				),
			afterCommit: (result, _dbService, entityId, approver) =>
				notifyRejectedTimeCorrectionAfterCommit(
					entityId,
					approver,
					reason,
					result,
				),
		},
	);
}

function markWorkBalanceDirtyAfterCommit(mark?: WorkBalanceDirtyMark) {
	return mark
		? Effect.promise(() => markEmployeeWorkBalanceDirtyIfNeeded(mark))
		: Effect.void;
}

async function markEmployeeWorkBalanceDirtyIfNeeded(
	mark?: WorkBalanceDirtyMark,
) {
	if (!mark) return;
	try {
		await markEmployeeWorkBalanceDirty(mark);
	} catch (error) {
		logger.error({ error, ...mark }, "Failed to mark work balance dirty");
	}
}

function notifyApprovedCorrection(
	period: WorkPeriodRecord,
	entityId: string,
	currentEmployee: CurrentApprover,
	originalTime: Date,
	correctedTime: Date,
) {
	void onTimeCorrectionApproved({
		workPeriodId: entityId,
		employeeUserId: period.employee.userId,
		employeeName: period.employee.user.name,
		organizationId: period.employee.organizationId,
		originalTime,
		correctedTime,
		approverName: currentEmployee.user.name,
	});
}

function notifyRejectedCorrection(
	period: WorkPeriodRecord,
	entityId: string,
	currentEmployee: CurrentApprover,
	reason: string,
	originalTime: Date,
	correctedTime: Date,
) {
	void onTimeCorrectionRejected({
		workPeriodId: entityId,
		employeeUserId: period.employee.userId,
		employeeName: period.employee.user.name,
		organizationId: period.employee.organizationId,
		originalTime,
		correctedTime,
		approverName: currentEmployee.user.name,
		rejectionReason: reason,
	});
}

function persistApprovedTimeCorrection(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	approval: PendingApprovalRequest,
) {
	return Effect.tryPromise({
		try: async () => {
			const metadata = correctionEntryIdsFromApproval(approval);
			const requestedBy = (
				approval as PendingApprovalRequest & {
					requestedBy?: unknown;
				}
			).requestedBy;
			if (typeof requestedBy !== "string" || requestedBy.length === 0) {
				throw timeCorrectionFinalizationConflict();
			}
			if (!metadata) {
				throw new ValidationError({
					message: "Time correction approval metadata is required",
					field: "timeCorrection",
				});
			}
			const correction = normalizeTimeCorrectionWorkflowPayload({
				timeCorrection: {
					action: metadata.action ?? "edit",
					...(metadata.clockInCorrectionId
						? { clockInCorrectionId: metadata.clockInCorrectionId }
						: {}),
					...(metadata.clockOutCorrectionId
						? { clockOutCorrectionId: metadata.clockOutCorrectionId }
						: {}),
				},
			}).timeCorrection;
			const result = await finalizeTimeCorrectionTerminalDetailedInTransaction({
				dbService,
				organizationId: approval.organizationId,
				workPeriodId: entityId,
				expectedApprovalWorkflowId: null,
				expectedApprovalWorkflowVersion: null,
				expectedRequesterEmployeeId: requestedBy,
				actorEmployeeId: currentEmployee.id,
				actorUserId: currentEmployee.userId,
				correction,
				legacyApprovalRequestId: approval.id,
				transition: { kind: "approve", reason: approval.reason ?? null },
				finalizedAt: systemClock.nowInstant(),
				allowMetadataLessLegacyFallback: false,
			});
			return {
				period: result.period,
				workBalanceDirtyMark: {
					employeeId: result.requesterEmployeeId,
					organizationId: approval.organizationId,
					...(result.dirtyFromDate
						? { dirtyFromDate: result.dirtyFromDate }
						: {}),
				},
				originalNotificationTime: result.originalNotificationTime,
				correctedNotificationTime: result.correctedNotificationTime,
			};
		},
		catch: (error) => error as AnyAppError,
	});
}

function handleApprovedTimeCorrection(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	approval: PendingApprovalRequest,
) {
	return persistApprovedTimeCorrection(
		dbService,
		entityId,
		currentEmployee,
		approval,
	).pipe(
		Effect.tap((result) =>
			completeApprovedTimeCorrectionAfterCommit(
				entityId,
				currentEmployee,
				result,
			),
		),
	);
}

function completeApprovedTimeCorrectionAfterCommit(
	entityId: string,
	currentEmployee: CurrentApprover,
	result: TimeCorrectionAutoCompletionResult,
) {
	return Effect.all(
		[
			markWorkBalanceDirtyAfterCommit(result.workBalanceDirtyMark),
			notifyApprovedTimeCorrectionAfterCommit(
				entityId,
				currentEmployee,
				result,
			),
		],
		{ concurrency: 2 },
	).pipe(Effect.map(() => undefined));
}

function notifyApprovedTimeCorrectionAfterCommit(
	entityId: string,
	currentEmployee: CurrentApprover,
	result: {
		period: WorkPeriodRecord;
		originalNotificationTime: Date;
		correctedNotificationTime: Date;
	},
) {
	return Effect.sync(() =>
		notifyApprovedCorrection(
			result.period,
			entityId,
			currentEmployee,
			result.originalNotificationTime,
			result.correctedNotificationTime,
		),
	);
}

type RejectedTimeCorrectionResult = TimeCorrectionApprovalResult & {
	originalNotificationTime: Date;
	correctedNotificationTime: Date;
};

function persistRejectedTimeCorrection(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	reason: string,
	approval: PendingApprovalRequest,
) {
	return Effect.gen(function* (_) {
		const correctionEntryIds = correctionEntryIdsFromApproval(approval);
		const requestedBy = (
			approval as PendingApprovalRequest & {
				requestedBy?: unknown;
			}
		).requestedBy;
		if (typeof requestedBy !== "string" || requestedBy.length === 0) {
			return yield* _(Effect.fail(timeCorrectionFinalizationConflict()));
		}
		let correction: TimeCorrectionWorkflowPayload["timeCorrection"];
		if (correctionEntryIds) {
			correction = normalizeTimeCorrectionWorkflowPayload({
				timeCorrection: {
					action: correctionEntryIds.action ?? "edit",
					...(correctionEntryIds.clockInCorrectionId
						? { clockInCorrectionId: correctionEntryIds.clockInCorrectionId }
						: {}),
					...(correctionEntryIds.clockOutCorrectionId
						? { clockOutCorrectionId: correctionEntryIds.clockOutCorrectionId }
						: {}),
				},
			}).timeCorrection;
		} else {
			const period = yield* _(
				loadWorkPeriod(dbService, entityId, approval.organizationId),
			);
			const clockInEntries = yield* _(
				loadActiveCorrectionEntries(dbService, period, period.clockInId),
			);
			const clockOutEntries = period.clockOutId
				? yield* _(
						loadActiveCorrectionEntries(dbService, period, period.clockOutId),
					)
				: [];
			const correctionCount = clockInEntries.length + clockOutEntries.length;
			if (
				correctionCount < 1 ||
				correctionCount > 2 ||
				clockInEntries.length > 1 ||
				clockOutEntries.length > 1
			) {
				return yield* _(Effect.fail(timeCorrectionFinalizationConflict()));
			}
			correction = normalizeTimeCorrectionWorkflowPayload({
				timeCorrection: {
					action: "edit",
					...(clockInEntries[0]
						? { clockInCorrectionId: clockInEntries[0].id }
						: {}),
					...(clockOutEntries[0]
						? { clockOutCorrectionId: clockOutEntries[0].id }
						: {}),
				},
			}).timeCorrection;
		}
		const result = yield* _(
			Effect.tryPromise({
				try: () =>
					finalizeTimeCorrectionTerminalDetailedInTransaction({
						dbService,
						organizationId: approval.organizationId,
						workPeriodId: entityId,
						expectedApprovalWorkflowId: null,
						expectedApprovalWorkflowVersion: null,
						expectedRequesterEmployeeId: requestedBy,
						actorEmployeeId: currentEmployee.id,
						actorUserId: currentEmployee.userId,
						correction,
						legacyApprovalRequestId: approval.id,
						transition: { kind: "reject", reason },
						finalizedAt: systemClock.nowInstant(),
						allowMetadataLessLegacyFallback: !correctionEntryIds,
					}),
				catch: (error) => error as AnyAppError,
			}),
		);
		return {
			period: result.period,
			originalNotificationTime: result.originalNotificationTime,
			correctedNotificationTime: result.correctedNotificationTime,
		} satisfies RejectedTimeCorrectionResult;
	});
}

function notifyRejectedTimeCorrectionAfterCommit(
	entityId: string,
	currentEmployee: CurrentApprover,
	reason: string,
	result: RejectedTimeCorrectionResult,
) {
	return Effect.sync(() =>
		notifyRejectedCorrection(
			result.period,
			entityId,
			currentEmployee,
			reason,
			result.originalNotificationTime,
			result.correctedNotificationTime,
		),
	);
}

function handleRejectedTimeCorrection(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	reason: string,
	approval: PendingApprovalRequest,
) {
	return persistRejectedTimeCorrection(
		dbService,
		entityId,
		currentEmployee,
		reason,
		approval,
	).pipe(
		Effect.tap((result) =>
			notifyRejectedTimeCorrectionAfterCommit(
				entityId,
				currentEmployee,
				reason,
				result,
			),
		),
	);
}

export async function approveTimeCorrectionEffect(
	approvalRequestId: string,
): Promise<ServerActionResult<void>> {
	return processAuthenticatedTimeCorrectionDecision(
		approvalRequestId,
		"approve",
	);
}

export async function rejectTimeCorrectionEffect(
	approvalRequestId: string,
	reason: string,
): Promise<ServerActionResult<void>> {
	return processAuthenticatedTimeCorrectionDecision(
		approvalRequestId,
		"reject",
		reason,
	);
}

function authenticatedTimeCorrectionDecisionEffect(
	approvalRequestId: string,
	action: "approve" | "reject",
	reason?: string,
) {
	return Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const organizationId = session.session.activeOrganizationId;
		if (!organizationId) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Active organization not found",
						entityType: "organization",
					}),
				),
			);
		}
		const currentEmployee = yield* _(
			dbService
				.query("getTimeCorrectionApprovalActor", async () => {
					return await dbService.db.query.employee.findFirst({
						where: and(
							eq(employee.userId, session.user.id),
							eq(employee.organizationId, organizationId),
							eq(employee.isActive, true),
						),
						with: { user: true },
					});
				})
				.pipe(
					Effect.flatMap((actor) =>
						actor &&
						actor.organizationId === organizationId &&
						actor.userId === session.user.id
							? Effect.succeed(actor as CurrentApprover)
							: Effect.fail(
									new NotFoundError({
										message: "Employee profile not found",
										entityType: "employee",
									}),
								),
					),
				),
		);

		yield* _(
			decideTimeCorrectionWithStableTargetEffect(
				dbService as ApprovalDbService,
				currentEmployee,
				approvalRequestId,
				action,
				reason,
			),
		);
	});
}

function processAuthenticatedTimeCorrectionDecision(
	approvalRequestId: string,
	action: "approve" | "reject",
	reason?: string,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		authenticatedTimeCorrectionDecisionEffect(
			approvalRequestId,
			action,
			reason,
		).pipe(Effect.provide(AppLayer)) as Effect.Effect<void, AnyAppError, never>,
	);
}
