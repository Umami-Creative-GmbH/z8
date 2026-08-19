import { sql } from "drizzle-orm";
import { instantFromDB } from "@/lib/datetime/drizzle-adapter";
import {
	compareInstants,
	type Instant,
	instantToCanonicalString,
	isInstant,
	parseInstant,
} from "@/lib/datetime/temporal-core";
import {
	isValidIanaTimezone,
	type TimeEntryTimezoneSource,
} from "@/lib/time-tracking/timezone-capture";
import {
	isWorkLocationType,
	type WorkLocationType,
} from "@/lib/time-tracking/work-location";
import type { ApprovalDbService } from "../server/types";
import { classifyTimeApprovalRequest } from "../time-request-kind";
import type {
	JsonObject,
	LegacyApprovalChainRowSnapshot,
	LegacyApprovalChainSnapshot,
	LegacyApprovalRequestSnapshot,
	VerifiedLegacyApprovalState,
} from "../workflow/ports";
import { normalizeStableData } from "../workflow/stable-data";
import {
	type CurrentTimeCorrectionWorkflowContract,
	normalizeTimeCorrectionOriginalWorkMetadata,
	normalizeTimeCorrectionWorkflowPayload,
	type TimeCorrectionOriginalWorkMetadata,
	type TimeCorrectionWorkflowPayload,
} from "./time-correction-contract";

type TimeCorrectionLegacyStateCaptureErrorCode =
	| "capture_failed"
	| "query_failed";

export class TimeCorrectionLegacyStateCaptureError extends Error {
	readonly code: TimeCorrectionLegacyStateCaptureErrorCode;

	constructor(code: TimeCorrectionLegacyStateCaptureErrorCode) {
		super("Time correction legacy approval state capture failed");
		this.name = "TimeCorrectionLegacyStateCaptureError";
		this.code = code;
	}
}

export interface CaptureTimeCorrectionLegacyApprovalStateInput {
	dbService: ApprovalDbService;
	organizationId: string;
	workPeriodId: string;
	capturedAt: Instant;
	/** Internal carry-forward evidence from a prior verified capture, never public authority. */
	expectedCorrection?: TimeCorrectionWorkflowPayload["timeCorrection"];
	/** Exact transaction-internal cycle selection evidence, never public authority. */
	expectedLegacyCycle?: ExpectedTimeCorrectionLegacyCycle;
	/** Prior verified direct-cycle evidence, used only to prove physical request deletion. */
	priorVerifiedDirectRequest?: PriorVerifiedDirectTimeCorrectionRequestEvidence;
	/** Narrow replay path after verified cancellation has already deleted correction rows. */
	allowCancelledReplayWithoutCorrectionRows?: boolean;
}

export interface ExpectedTimeCorrectionLegacyCycle {
	approvalRequestId?: string;
	chainInstanceId?: string;
}

export interface PriorVerifiedDirectTimeCorrectionRequestEvidence {
	readonly approvalRequest: LegacyApprovalRequestSnapshot | null;
	readonly chain: LegacyApprovalChainSnapshot | null;
	readonly chainRows: readonly LegacyApprovalChainRowSnapshot[];
}

type RequestStatus = "pending" | "approved" | "rejected";
type ChainStatus = RequestStatus | "cancelled";
type EndpointType = "clock_in" | "clock_out";

interface EntrySnapshot {
	id: string;
	organizationId: string;
	employeeId: string;
	type: "clock_in" | "clock_out" | "correction";
	instant: Instant;
	utcOffsetMinutes: number;
	timezone: string;
	timezoneSource: TimeEntryTimezoneSource;
	replacesEntryId: string | null;
	isSuperseded: boolean;
	supersededById: string | null;
	isDeleted: boolean;
}

interface CorrectionEntrySnapshot extends EntrySnapshot {
	endpointType: EndpointType;
}

interface WorkPeriodSnapshot {
	id: string;
	organizationId: string;
	employeeId: string;
	clockInId: string;
	clockOutId: string | null;
	startTime: Instant;
	endTime: Instant | null;
	durationMinutes: number | null;
	isActive: boolean;
	approvalStatus: RequestStatus;
	pendingChanges: unknown;
	deletedAt: Instant | null;
	canonicalRecordId: string;
	approvalWorkflowId: string | null;
	workLocationType: WorkLocationType | null;
	workCategoryId: string | null;
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

interface CanonicalWorkSnapshot {
	recordId: string;
	organizationId: string;
	recordKind: string;
	workLocationType: WorkLocationType | null;
	workCategoryId: string | null;
}

const TIMEZONE_SOURCES = new Set<TimeEntryTimezoneSource>([
	"browser",
	"user_setting",
	"manager_target_user_setting",
	"historical_inference",
	"backfill",
]);
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fail(
	code: TimeCorrectionLegacyStateCaptureErrorCode = "capture_failed",
): never {
	throw new TimeCorrectionLegacyStateCaptureError(code);
}

function normalizeExpectedLegacyCycle(
	value: ExpectedTimeCorrectionLegacyCycle | undefined,
): Readonly<ExpectedTimeCorrectionLegacyCycle> | null {
	if (value === undefined) return null;
	try {
		const approvalRequestId = value.approvalRequestId;
		const chainInstanceId = value.chainInstanceId;
		if (
			(!approvalRequestId && !chainInstanceId) ||
			(approvalRequestId !== undefined && !UUID.test(approvalRequestId)) ||
			(chainInstanceId !== undefined && !UUID.test(chainInstanceId))
		) {
			return fail();
		}
		return Object.freeze({
			...(approvalRequestId ? { approvalRequestId } : {}),
			...(chainInstanceId ? { chainInstanceId } : {}),
		});
	} catch {
		return fail();
	}
}

function validatePriorVerifiedDirectRequest(input: {
	evidence: PriorVerifiedDirectTimeCorrectionRequestEvidence | undefined;
	expectedRequestId: string;
	expectedPayload: TimeCorrectionWorkflowPayload;
	organizationId: string;
	workPeriodId: string;
	employeeId: string;
}): void {
	const evidence = record(input.evidence);
	if (evidence.chain !== null || array(evidence.chainRows).length !== 0) fail();
	const request = record(evidence.approvalRequest);
	if (request.reason !== null) string(request.reason);
	if (
		string(request.id) !== input.expectedRequestId ||
		!UUID.test(input.expectedRequestId) ||
		string(request.organizationId) !== input.organizationId ||
		string(request.entityType) !== "time_entry" ||
		string(request.entityId) !== input.workPeriodId ||
		string(request.requestedBy) !== input.employeeId ||
		string(request.approverId).length === 0 ||
		request.status !== "pending" ||
		request.rejectionReason !== null ||
		request.approvedAt !== null ||
		!isInstant(request.updatedAt)
	) {
		fail();
	}
	const payload = normalizeTimeCorrectionMetadata(request.metadata);
	if (JSON.stringify(payload) !== JSON.stringify(input.expectedPayload)) fail();
}

function record(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return fail();
	}
	return value as Record<string, unknown>;
}

function normalizeTimeCorrectionMetadata(
	value: unknown,
): TimeCorrectionWorkflowPayload {
	const metadata = record(value);
	const descriptor = Object.getOwnPropertyDescriptor(
		metadata,
		"timeCorrection",
	);
	if (!descriptor?.enumerable || !("value" in descriptor)) return fail();
	return normalizeTimeCorrectionWorkflowPayload({
		timeCorrection: descriptor.value,
	});
}

function originalWorkMetadataFromApprovalMetadata(
	value: unknown,
	correction: TimeCorrectionWorkflowPayload["timeCorrection"],
): TimeCorrectionOriginalWorkMetadata | null {
	const metadata = record(value);
	const descriptor = Object.getOwnPropertyDescriptor(
		metadata,
		"timeCorrectionOriginalWorkMetadata",
	);
	if (!descriptor) {
		return Object.hasOwn(correction, "workLocationType") ? fail() : null;
	}
	if (!descriptor.enumerable || !("value" in descriptor)) return fail();
	try {
		return normalizeTimeCorrectionOriginalWorkMetadata(descriptor.value);
	} catch {
		return fail();
	}
}

function requesterCancellationMetadata(input: {
	value: unknown;
	organizationId: string;
	workPeriodId: string;
	employeeId: string;
	approvedAt: unknown;
}): JsonObject | null {
	const metadata = record(input.value);
	const descriptor = Object.getOwnPropertyDescriptor(metadata, "cancellation");
	if (!descriptor) return null;
	if (!descriptor.enumerable || !("value" in descriptor)) return fail();
	const cancellation = record(descriptor.value);
	const keys = Reflect.ownKeys(cancellation);
	if (
		keys.length !== 7 ||
		keys.some((key) => {
			if (typeof key !== "string") return true;
			const child = Object.getOwnPropertyDescriptor(cancellation, key);
			return !child?.enumerable || !("value" in child);
		}) ||
		cancellation.kind !== "requester" ||
		cancellation.organizationId !== input.organizationId ||
		cancellation.requesterEmployeeId !== input.employeeId ||
		typeof cancellation.requesterUserId !== "string" ||
		cancellation.requesterUserId.length === 0 ||
		cancellation.workPeriodId !== input.workPeriodId
	) {
		return fail();
	}
	if (
		cancellation.chainInstanceId !== null &&
		(typeof cancellation.chainInstanceId !== "string" ||
			!UUID.test(cancellation.chainInstanceId))
	) {
		return fail();
	}
	let cancelledAt: Instant;
	try {
		cancelledAt = parseInstant(string(cancellation.cancelledAt));
	} catch {
		return fail();
	}
	const approvedAt = requiredInstant(input.approvedAt);
	if (compareInstants(cancelledAt, approvedAt) !== 0) return fail();
	const payload = normalizeTimeCorrectionMetadata(metadata);
	const submission = Object.getOwnPropertyDescriptor(metadata, "submission");
	if (!submission?.enumerable || !("value" in submission)) return fail();
	const evidence = record(submission.value);
	const evidenceKeys = Reflect.ownKeys(evidence);
	const hasSubmissionId = Object.hasOwn(evidence, "submissionId");
	if (
		evidenceKeys.length !== (hasSubmissionId ? 4 : 3) ||
		evidenceKeys.some((key) => {
			if (
				typeof key !== "string" ||
				!["key", "submissionId", "resultKind", "originalStatus"].includes(key)
			) {
				return true;
			}
			const child = Object.getOwnPropertyDescriptor(evidence, key);
			return !child?.enumerable || !("value" in child);
		}) ||
		typeof evidence.key !== "string" ||
		evidence.key.length === 0 ||
		(hasSubmissionId &&
			(typeof evidence.submissionId !== "string" ||
				!UUID.test(evidence.submissionId))) ||
		(evidence.resultKind !== "default_created" &&
			evidence.resultKind !== "chain_created") ||
		evidence.originalStatus !== "pending"
	) {
		return fail();
	}
	return normalizeStableData({
		...payload,
		submission: evidence,
		cancellation,
	}) as JsonObject;
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

function nullableWorkLocationType(value: unknown): WorkLocationType | null {
	if (value === null) return null;
	if (typeof value !== "string" || !isWorkLocationType(value)) return fail();
	return value;
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

function serializeInstant(value: Instant | null): string | null {
	return value === null ? null : instantToCanonicalString(value);
}

function serializeEntry(entry: EntrySnapshot) {
	return { ...entry, instant: instantToCanonicalString(entry.instant) };
}

function validateCurrentEndpoint(
	entry: EntrySnapshot,
	expectedType: EndpointType,
	predecessor: EntrySnapshot | undefined,
): void {
	if (entry.isDeleted || entry.isSuperseded || entry.supersededById !== null) {
		fail();
	}
	if (entry.type === expectedType) {
		if (entry.replacesEntryId !== null || predecessor !== undefined) fail();
		return;
	}
	if (
		entry.type !== "correction" ||
		!entry.replacesEntryId ||
		entry.replacesEntryId === entry.id ||
		!predecessor ||
		predecessor.id !== entry.replacesEntryId ||
		predecessor.id === entry.id ||
		predecessor.organizationId !== entry.organizationId ||
		predecessor.employeeId !== entry.employeeId ||
		predecessor.isDeleted ||
		!predecessor.isSuperseded ||
		predecessor.supersededById !== entry.id ||
		(predecessor.type !== expectedType && predecessor.type !== "correction") ||
		(predecessor.type === expectedType &&
			predecessor.replacesEntryId !== null) ||
		(predecessor.type === "correction" &&
			(!predecessor.replacesEntryId ||
				predecessor.replacesEntryId === predecessor.id ||
				predecessor.replacesEntryId === entry.id))
	) {
		fail();
	}
}

function decodeEntry(value: unknown): EntrySnapshot {
	const raw = record(value);
	const type = string(raw.type);
	if (type !== "clock_in" && type !== "clock_out" && type !== "correction") {
		return fail();
	}
	const utcOffsetMinutes = integer(raw.utcOffsetMinutes);
	const timezone = string(raw.timezone);
	const timezoneSource = string(raw.timezoneSource);
	const instant = requiredInstant(raw.timestamp);
	if (
		utcOffsetMinutes <= -1440 ||
		utcOffsetMinutes >= 1440 ||
		!isValidIanaTimezone(timezone) ||
		!TIMEZONE_SOURCES.has(timezoneSource as TimeEntryTimezoneSource)
	) {
		return fail();
	}
	let expectedOffsetMinutes: number;
	try {
		expectedOffsetMinutes =
			instant.toZonedDateTimeISO(timezone).offsetNanoseconds / 60_000_000_000;
	} catch {
		return fail();
	}
	if (
		!Number.isInteger(expectedOffsetMinutes) ||
		expectedOffsetMinutes !== utcOffsetMinutes
	) {
		return fail();
	}
	return {
		id: string(raw.id),
		organizationId: string(raw.organizationId),
		employeeId: string(raw.employeeId),
		type,
		instant,
		utcOffsetMinutes,
		timezone,
		timezoneSource: timezoneSource as TimeEntryTimezoneSource,
		replacesEntryId: nullableString(raw.replacesEntryId),
		isSuperseded: boolean(raw.isSuperseded),
		supersededById: nullableString(raw.supersededById),
		isDeleted: boolean(raw.isDeleted),
	};
}

function decodeCorrectionEntry(value: unknown): CorrectionEntrySnapshot {
	const raw = record(value);
	const endpointType = string(raw.endpointType);
	if (endpointType !== "clock_in" && endpointType !== "clock_out") {
		return fail();
	}
	return { ...decodeEntry(raw), endpointType };
}

function decodeWorkPeriod(value: unknown): WorkPeriodSnapshot {
	const raw = record(value);
	return {
		id: string(raw.id),
		organizationId: string(raw.organizationId),
		employeeId: string(raw.employeeId),
		clockInId: string(raw.clockInId),
		clockOutId: nullableString(raw.clockOutId),
		startTime: requiredInstant(raw.startTime),
		endTime: nullableInstant(raw.endTime),
		durationMinutes: nullableInteger(raw.durationMinutes),
		isActive: boolean(raw.isActive),
		approvalStatus: requestStatus(raw.approvalStatus),
		pendingChanges: raw.pendingChanges,
		deletedAt: nullableInstant(raw.deletedAt),
		canonicalRecordId: string(raw.canonicalRecordId),
		approvalWorkflowId: nullableString(raw.approvalWorkflowId),
		workLocationType: nullableWorkLocationType(raw.workLocationType),
		workCategoryId: nullableString(raw.workCategoryId),
	};
}

function decodeCanonicalRecord(value: unknown): CanonicalRecordSnapshot {
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

function decodeCanonicalWork(value: unknown): CanonicalWorkSnapshot {
	const raw = record(value);
	return {
		recordId: string(raw.recordId),
		organizationId: string(raw.organizationId),
		recordKind: string(raw.recordKind),
		workLocationType: nullableWorkLocationType(raw.workLocationType),
		workCategoryId: nullableString(raw.workCategoryId),
	};
}

function decodeRequest(
	value: unknown,
	payload: TimeCorrectionWorkflowPayload,
	cancellationMetadata: JsonObject | null,
): LegacyApprovalRequestSnapshot {
	const raw = record(value);
	const status = requestStatus(raw.status);
	const approvedAt = nullableInstant(raw.approvedAt);
	const rejectionReason = nullableString(raw.rejectionReason);
	if (
		cancellationMetadata
			? status !== "rejected" || rejectionReason !== null || approvedAt === null
			: (status === "approved" && approvedAt === null) ||
				(status !== "approved" && approvedAt !== null) ||
				(status === "rejected" && rejectionReason === null) ||
				(status !== "rejected" && rejectionReason !== null)
	) {
		return fail();
	}
	return {
		id: string(raw.id),
		organizationId: string(raw.organizationId),
		entityType: string(raw.entityType),
		entityId: string(raw.entityId),
		requestedBy: string(raw.requestedBy),
		approverId: string(raw.approverId),
		status,
		reason: nullableString(raw.reason),
		rejectionReason,
		approvedAt,
		metadata: cancellationMetadata ?? (payload as unknown as JsonObject),
		updatedAt: requiredInstant(raw.updatedAt),
	};
}

function decodeChain(value: unknown): LegacyApprovalChainSnapshot {
	const raw = record(value);
	const status = chainStatus(raw.status);
	const currentStageOrder = integer(raw.currentStageOrder);
	const completedAt = nullableInstant(raw.completedAt);
	if (
		currentStageOrder < 1 ||
		(status === "pending" && completedAt !== null) ||
		(status !== "pending" && completedAt === null)
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

function validateWorkPeriodShape(
	source: WorkPeriodSnapshot,
	clockIn: EntrySnapshot,
	clockOut: EntrySnapshot | null,
): void {
	if (
		clockIn.id !== source.clockInId ||
		!sameInstant(clockIn.instant, source.startTime) ||
		clockIn.isDeleted ||
		(clockOut === null) !== (source.clockOutId === null) ||
		(clockOut &&
			(clockOut.id !== source.clockOutId ||
				!sameInstant(clockOut.instant, source.endTime) ||
				clockOut.isDeleted))
	) {
		fail();
	}
	if (clockOut === null) {
		if (
			source.endTime !== null ||
			source.durationMinutes !== null ||
			!source.isActive
		) {
			fail();
		}
		return;
	}
	if (
		source.endTime === null ||
		source.durationMinutes === null ||
		source.durationMinutes < 0 ||
		source.isActive ||
		compareInstants(source.endTime, source.startTime) < 0
	) {
		fail();
	}
}

function validateChainLifecycle(input: {
	chain: LegacyApprovalChainSnapshot;
	rows: LegacyApprovalChainRowSnapshot[];
	requests: LegacyApprovalRequestSnapshot[];
}): LegacyApprovalRequestSnapshot | null {
	const { chain, rows, requests } = input;
	const currentIndex = rows.findIndex(
		(row) => row.stepOrder === chain.currentStageOrder,
	);
	if (currentIndex < 0) fail();
	const current = rows[currentIndex] ?? fail();
	const currentRequest = current.approvalRequestId
		? (requests.find((request) => request.id === current.approvalRequestId) ??
			null)
		: null;
	const earlier = rows.slice(0, currentIndex);
	const later = rows.slice(currentIndex + 1);
	const unactivated = (row: LegacyApprovalChainRowSnapshot) =>
		row.status === "cancelled" &&
		row.approvalRequestId === null &&
		row.decidedBy === null &&
		row.decidedAt === null;
	let coherent = false;
	switch (chain.status) {
		case "pending":
			coherent =
				earlier.every((row) => row.status === "approved") &&
				current.status === "pending" &&
				currentRequest?.status === "pending" &&
				later.every(unactivated);
			break;
		case "approved":
			coherent =
				currentIndex === rows.length - 1 &&
				rows.every((row) => row.status === "approved") &&
				currentRequest?.status === "approved";
			break;
		case "rejected":
			coherent =
				earlier.every((row) => row.status === "approved") &&
				current.status === "rejected" &&
				currentRequest?.status === "rejected" &&
				later.every(unactivated);
			break;
		case "cancelled":
			coherent =
				earlier.every((row) => row.status === "approved") &&
				unactivated(current) &&
				later.every(unactivated) &&
				currentRequest === null;
			break;
	}
	if (!coherent) fail();
	return currentRequest;
}

function decodeCapture(
	input: CaptureTimeCorrectionLegacyApprovalStateInput,
	queryResult: unknown,
	expectedPayload: TimeCorrectionWorkflowPayload | null,
	expectedCycle: Readonly<ExpectedTimeCorrectionLegacyCycle> | null,
): VerifiedLegacyApprovalState {
	const result = record(queryResult);
	const rows = array(result.rows);
	if (rows.length !== 1) fail();
	const envelope = record(rows[0]);
	if (envelope.source === null) fail();
	const source = decodeWorkPeriod(envelope.source);
	if (envelope.canonicalRecord === null) fail();
	const canonical = decodeCanonicalRecord(envelope.canonicalRecord);
	if (envelope.canonicalWork === null) fail();
	const canonicalWork = decodeCanonicalWork(envelope.canonicalWork);
	const current = record(envelope.currentEndpoints);
	const currentClockIn = decodeEntry(current.clockIn);
	const currentClockOut =
		current.clockOut === null ? null : decodeEntry(current.clockOut);
	const currentEndpointPredecessors = array(
		envelope.currentEndpointPredecessors,
	).map(decodeEntry);
	if (
		source.id !== input.workPeriodId ||
		source.organizationId !== input.organizationId ||
		currentClockIn.organizationId !== input.organizationId ||
		currentClockIn.employeeId !== source.employeeId ||
		source.pendingChanges !== null ||
		(currentClockOut &&
			(currentClockOut.organizationId !== input.organizationId ||
				currentClockOut.employeeId !== source.employeeId))
	) {
		fail();
	}
	if (
		new Set(currentEndpointPredecessors.map((entry) => entry.id)).size !==
			currentEndpointPredecessors.length ||
		currentEndpointPredecessors.some(
			(entry) =>
				entry.organizationId !== input.organizationId ||
				entry.employeeId !== source.employeeId,
		)
	) {
		fail();
	}
	const predecessorFor = (entry: EntrySnapshot): EntrySnapshot | undefined => {
		if (entry.replacesEntryId === null) return undefined;
		const matches = currentEndpointPredecessors.filter(
			(candidate) => candidate.id === entry.replacesEntryId,
		);
		if (matches.length !== 1) return fail();
		return matches[0];
	};
	validateCurrentEndpoint(
		currentClockIn,
		"clock_in",
		predecessorFor(currentClockIn),
	);
	if (currentClockOut) {
		validateCurrentEndpoint(
			currentClockOut,
			"clock_out",
			predecessorFor(currentClockOut),
		);
	}
	const expectedPredecessorCount = [currentClockIn, currentClockOut].filter(
		(entry) => entry?.type === "correction",
	).length;
	if (currentEndpointPredecessors.length !== expectedPredecessorCount) fail();
	validateWorkPeriodShape(source, currentClockIn, currentClockOut);
	if (
		canonical.id !== source.canonicalRecordId ||
		canonical.organizationId !== input.organizationId ||
		canonical.employeeId !== source.employeeId ||
		canonical.recordKind !== "work" ||
		canonical.approvalState !== source.approvalStatus ||
		!sameInstant(canonical.startAt, source.startTime) ||
		!sameInstant(canonical.endAt, source.endTime) ||
		canonical.durationMinutes !== source.durationMinutes ||
		canonicalWork.recordId !== source.canonicalRecordId ||
		canonicalWork.organizationId !== input.organizationId ||
		canonicalWork.recordKind !== "work" ||
		canonicalWork.workLocationType !== source.workLocationType ||
		canonicalWork.workCategoryId !== source.workCategoryId
	) {
		fail();
	}

	const correctionEntries = array(envelope.correctionEntries).map(
		decodeCorrectionEntry,
	);
	const priorVerifiedCorrectionIds = expectedPayload
		? [
				expectedPayload.timeCorrection.clockInCorrectionId,
				expectedPayload.timeCorrection.clockOutCorrectionId,
			].filter((id): id is string => Boolean(id))
		: [];
	const verifiedRelationalCorrectionIds: string[] = [];
	const verifiedRelationalCorrectionIdsByEndpoint: {
		clockIn: string[];
		clockOut: string[];
	} = { clockIn: [], clockOut: [] };
	for (const entry of correctionEntries) {
		verifiedRelationalCorrectionIds.push(entry.id);
		if (
			entry.id === source.clockInId ||
			entry.replacesEntryId === source.clockInId
		) {
			verifiedRelationalCorrectionIdsByEndpoint.clockIn.push(entry.id);
		}
		if (
			entry.id === source.clockOutId ||
			entry.replacesEntryId === source.clockOutId
		) {
			verifiedRelationalCorrectionIdsByEndpoint.clockOut.push(entry.id);
		}
	}
	verifiedRelationalCorrectionIds.push(...priorVerifiedCorrectionIds);
	if (
		input.allowCancelledReplayWithoutCorrectionRows === true &&
		expectedPayload?.timeCorrection.clockInCorrectionId
	) {
		verifiedRelationalCorrectionIdsByEndpoint.clockIn.push(
			expectedPayload.timeCorrection.clockInCorrectionId,
		);
	}
	if (
		input.allowCancelledReplayWithoutCorrectionRows === true &&
		expectedPayload?.timeCorrection.clockOutCorrectionId
	) {
		verifiedRelationalCorrectionIdsByEndpoint.clockOut.push(
			expectedPayload.timeCorrection.clockOutCorrectionId,
		);
	}
	const rawRequests = array(envelope.approvalRequests);
	const requestPayloads = rawRequests.map((value) => {
		const raw = record(value);
		if (
			classifyTimeApprovalRequest({
				metadata: raw.metadata,
				reason: raw.reason === null ? null : string(raw.reason),
				pendingChanges: source.pendingChanges,
				verifiedRelationalCorrectionIds,
				verifiedRelationalCorrectionIdsByEndpoint,
			}) !== "time_correction"
		) {
			return fail();
		}
		return normalizeTimeCorrectionMetadata(raw.metadata);
	});
	const requestPayload = requestPayloads[0] ?? null;
	const requestOriginalWorkMetadata = rawRequests.map((value, index) =>
		originalWorkMetadataFromApprovalMetadata(
			record(value).metadata,
			(requestPayloads[index] ?? fail()).timeCorrection,
		),
	);
	const originalWorkMetadata = requestOriginalWorkMetadata[0] ?? null;
	if (
		requestOriginalWorkMetadata.some(
			(candidate) =>
				JSON.stringify(candidate) !== JSON.stringify(originalWorkMetadata),
		)
	) {
		fail();
	}
	if (
		requestPayload &&
		requestPayloads.some(
			(candidate) =>
				JSON.stringify(candidate) !== JSON.stringify(requestPayload),
		)
	) {
		fail();
	}
	if (
		requestPayload &&
		expectedPayload &&
		JSON.stringify(requestPayload) !== JSON.stringify(expectedPayload)
	) {
		fail();
	}
	const payload = requestPayload ?? expectedPayload;
	const requestCancellationMetadata = rawRequests.map((value) => {
		const raw = record(value);
		return requesterCancellationMetadata({
			value: raw.metadata,
			organizationId: input.organizationId,
			workPeriodId: input.workPeriodId,
			employeeId: source.employeeId,
			approvedAt: raw.approvedAt,
		});
	});
	const requests = rawRequests.map((value, index) =>
		decodeRequest(
			value,
			requestPayloads[index] ?? fail(),
			requestCancellationMetadata[index] ?? null,
		),
	);
	const requestsById = new Map(
		requests.map((request) => [request.id, request] as const),
	);
	if (
		requestsById.size !== requests.length ||
		requests.some(
			(request) =>
				request.organizationId !== input.organizationId ||
				request.entityType !== "time_entry" ||
				request.entityId !== input.workPeriodId ||
				request.requestedBy !== source.employeeId,
		)
	) {
		fail();
	}

	const chains = array(envelope.chains);
	if (chains.length > 1) fail();
	const chain = chains[0] === undefined ? null : decodeChain(chains[0]);
	const chainRows = array(envelope.chainRows)
		.map(decodeChainRow)
		.sort((left, right) => left.stepOrder - right.stepOrder);
	if (
		new Set(chainRows.map((row) => row.stepOrder)).size !== chainRows.length ||
		new Set(chainRows.map((row) => row.id)).size !== chainRows.length
	) {
		fail();
	}
	const selectionEvidence = record(envelope.selectionEvidence);
	const pendingRequestCount = integer(selectionEvidence.pendingRequestCount);
	const eligiblePendingDirectRequestCount = integer(
		selectionEvidence.eligiblePendingDirectRequestCount,
	);
	const pendingChainCount = integer(selectionEvidence.pendingChainCount);
	const selectedRequestCount = integer(selectionEvidence.selectedRequestCount);
	const selectedChainCount = integer(selectionEvidence.selectedChainCount);
	const expectedRequestCount = integer(selectionEvidence.expectedRequestCount);
	const expectedChainCount = integer(selectionEvidence.expectedChainCount);
	if (
		pendingRequestCount < 0 ||
		pendingRequestCount > 1 ||
		eligiblePendingDirectRequestCount < 0 ||
		eligiblePendingDirectRequestCount > pendingRequestCount ||
		pendingChainCount < 0 ||
		pendingChainCount > 1 ||
		expectedRequestCount < 0 ||
		expectedRequestCount > 1 ||
		expectedChainCount < 0 ||
		expectedChainCount > 1 ||
		selectedRequestCount !== requests.length ||
		selectedChainCount !== chains.length
	) {
		fail();
	}
	if (expectedCycle) {
		if (
			expectedCycle.chainInstanceId
				? chain?.id !== expectedCycle.chainInstanceId ||
					expectedChainCount !== 1
				: chain !== null || expectedChainCount !== 0
		) {
			fail();
		}
		if (
			chain?.status === "cancelled" &&
			(pendingRequestCount !== 0 ||
				eligiblePendingDirectRequestCount !== 0 ||
				pendingChainCount !== 0)
		) {
			fail();
		}
		const expectedRequestId = expectedCycle.approvalRequestId;
		if (expectedRequestId) {
			const currentRequest = requestsById.get(expectedRequestId);
			if (currentRequest) {
				if (expectedRequestCount !== 1) fail();
			} else if (chain) {
				if (chain.status !== "cancelled" || expectedRequestCount !== 0) fail();
			} else {
				if (
					!expectedPayload ||
					requests.length !== 0 ||
					expectedRequestCount !== 0
				) {
					fail();
				}
				validatePriorVerifiedDirectRequest({
					evidence: input.priorVerifiedDirectRequest,
					expectedRequestId,
					expectedPayload,
					organizationId: input.organizationId,
					workPeriodId: input.workPeriodId,
					employeeId: source.employeeId,
				});
			}
		} else if (expectedRequestCount !== 0) {
			fail();
		}
	} else {
		const selectedPendingRequestCount = requests.filter(
			(request) => request.status === "pending",
		).length;
		const coherentNoCycle =
			pendingRequestCount === 0 &&
			eligiblePendingDirectRequestCount === 0 &&
			pendingChainCount === 0 &&
			requests.length === 0 &&
			chain === null;
		const coherentDirectCycle =
			pendingRequestCount === 1 &&
			eligiblePendingDirectRequestCount === 1 &&
			pendingChainCount === 0 &&
			requests.length === 1 &&
			selectedPendingRequestCount === 1 &&
			chain === null;
		const coherentChainCycle =
			pendingRequestCount === 1 &&
			eligiblePendingDirectRequestCount === 0 &&
			pendingChainCount === 1 &&
			selectedPendingRequestCount === 1 &&
			chain?.status === "pending";
		if (
			expectedRequestCount !== 0 ||
			expectedChainCount !== 0 ||
			expectedPayload !== null ||
			(!coherentNoCycle && !coherentDirectCycle && !coherentChainCycle)
		) {
			fail();
		}
	}
	let approvalRequest: LegacyApprovalRequestSnapshot | null;
	if (chain) {
		if (
			(chain.status === "cancelled" && payload === null) ||
			chain.organizationId !== input.organizationId ||
			chain.entityType !== "time_entry" ||
			chain.entityId !== input.workPeriodId ||
			chain.requesterEmployeeId !== source.employeeId ||
			chainRows.length === 0 ||
			chainRows.some(
				(row) =>
					row.organizationId !== input.organizationId ||
					row.chainInstanceId !== chain.id,
			)
		) {
			fail();
		}
		const linkedIds = chainRows.flatMap((row) =>
			row.approvalRequestId ? [row.approvalRequestId] : [],
		);
		const linkedIdSet = new Set(linkedIds);
		const chainRowsByRequestId = new Map(
			chainRows.flatMap((row) =>
				row.approvalRequestId ? [[row.approvalRequestId, row] as const] : [],
			),
		);
		if (
			linkedIdSet.size !== linkedIds.length ||
			linkedIds.some((id) => !requestsById.has(id)) ||
			requests.some((request) => !linkedIdSet.has(request.id))
		) {
			fail();
		}
		for (const request of requests) {
			const row = chainRowsByRequestId.get(request.id);
			if (
				!row ||
				row.resolvedApproverEmployeeId !== request.approverId ||
				row.status !== request.status
			) {
				fail();
			}
		}
		approvalRequest = validateChainLifecycle({
			chain,
			rows: chainRows,
			requests,
		});
	} else {
		if (chainRows.length > 0 || requests.length > 1) fail();
		approvalRequest = requests[0] ?? null;
		if (approvalRequest === null && source.approvalStatus !== "approved") {
			fail();
		}
	}
	const directRequesterCancellation =
		approvalRequest !== null &&
		approvalRequest.metadata !== null &&
		Object.hasOwn(approvalRequest.metadata, "cancellation");
	const correctionLifecycle =
		chain?.status ??
		(directRequesterCancellation ? "cancelled" : approvalRequest?.status) ??
		(payload && expectedPayload ? "cancelled" : null);

	const originalEntries = array(envelope.originalEntries).map(decodeEntry);
	const correctionEndpoints: Array<Record<string, unknown>> = [];
	const cancelledReplayWithoutCorrectionRows =
		input.allowCancelledReplayWithoutCorrectionRows === true &&
		((chain?.status === "cancelled" &&
			expectedCycle?.chainInstanceId === chain.id) ||
			(directRequesterCancellation &&
				expectedCycle?.approvalRequestId === approvalRequest?.id)) &&
		payload !== null &&
		correctionEntries.length === 0 &&
		originalEntries.length === 0 &&
		source.approvalStatus === "approved" &&
		source.deletedAt === null &&
		canonical.approvalState === "approved";
	if (payload && !cancelledReplayWithoutCorrectionRows) {
		const expected = [
			payload.timeCorrection.clockInCorrectionId
				? {
						endpointType: "clock_in" as const,
						correctionId: payload.timeCorrection.clockInCorrectionId,
						originalId:
							correctionLifecycle === "approved" ? null : source.clockInId,
					}
				: null,
			payload.timeCorrection.clockOutCorrectionId
				? {
						endpointType: "clock_out" as const,
						correctionId: payload.timeCorrection.clockOutCorrectionId,
						originalId:
							correctionLifecycle === "approved" ? null : source.clockOutId,
					}
				: null,
		].filter((value): value is NonNullable<typeof value> => value !== null);
		if (
			correctionEntries.length !== expected.length ||
			originalEntries.length !== expected.length
		) {
			fail();
		}
		for (const item of expected) {
			const matchingCorrections = correctionEntries.filter(
				(entry) =>
					entry.id === item.correctionId &&
					entry.endpointType === item.endpointType,
			);
			if (matchingCorrections.length !== 1) fail();
			const correction = matchingCorrections[0];
			const originals = originalEntries.filter(
				(entry) => entry.id === correction.replacesEntryId,
			);
			if (originals.length !== 1) fail();
			const original = originals[0];
			const currentEntry =
				item.endpointType === "clock_in" ? currentClockIn : currentClockOut;
			if (
				correction.type !== "correction" ||
				correction.organizationId !== input.organizationId ||
				correction.employeeId !== source.employeeId ||
				correction.isDeleted ||
				correction.supersededById !== null ||
				original.organizationId !== input.organizationId ||
				original.employeeId !== source.employeeId ||
				original.isDeleted ||
				(item.originalId !== null && original.id !== item.originalId)
			) {
				fail();
			}
			if (correctionLifecycle === "approved") {
				if (
					correction.isSuperseded ||
					!original.isSuperseded ||
					original.supersededById !== correction.id ||
					currentEntry?.id !== correction.id ||
					currentEntry.type !== "correction" ||
					correction.replacesEntryId !== original.id
				) {
					fail();
				}
			} else if (
				!correction.isSuperseded ||
				currentEntry?.id !== original.id ||
				correction.replacesEntryId !== currentEntry.id ||
				currentEntry.type !== original.type ||
				currentEntry.replacesEntryId !== original.replacesEntryId ||
				currentEntry.isSuperseded !== original.isSuperseded ||
				currentEntry.supersededById !== original.supersededById
			) {
				fail();
			}
			correctionEndpoints.push({
				endpointType: item.endpointType,
				originalEntryId: original.id,
				correctionEntryId: correction.id,
				instant: instantToCanonicalString(correction.instant),
				utcOffsetMinutes: correction.utcOffsetMinutes,
				timezone: correction.timezone,
				timezoneSource: correction.timezoneSource,
				correction: serializeEntry(correction),
				original: serializeEntry(original),
			});
		}
		if (
			payload.timeCorrection.action === "delete" &&
			(correctionEndpoints.length !== 2 ||
				!sameInstant(
					correctionEntries.find((entry) => entry.endpointType === "clock_in")
						?.instant ?? null,
					correctionEntries.find((entry) => entry.endpointType === "clock_out")
						?.instant ?? null,
				))
		) {
			fail();
		}
		if (payload.timeCorrection.action === "edit") {
			const proposedClockIn =
				correctionEntries.find((entry) => entry.endpointType === "clock_in")
					?.instant ?? currentClockIn.instant;
			const proposedClockOut =
				correctionEntries.find((entry) => entry.endpointType === "clock_out")
					?.instant ??
				currentClockOut?.instant ??
				null;
			if (
				(payload.timeCorrection.clockOutCorrectionId && !currentClockOut) ||
				(proposedClockOut !== null &&
					compareInstants(proposedClockIn, proposedClockOut) >= 0)
			) {
				fail();
			}
		}
	} else if (
		!cancelledReplayWithoutCorrectionRows &&
		(correctionEntries.length > 0 || originalEntries.length > 0)
	) {
		fail();
	}
	if (
		(source.deletedAt !== null &&
			(payload?.timeCorrection.action !== "delete" ||
				correctionLifecycle !== "approved")) ||
		(payload?.timeCorrection.action === "delete" &&
			correctionLifecycle === "approved" &&
			source.deletedAt === null)
	) {
		fail();
	}
	const identity = record(envelope.identityEvidence);
	const employeeEvidence = array(identity.employees).map((value) => {
		const employee = record(value);
		return {
			id: string(employee.id),
			organizationId: string(employee.organizationId),
		};
	});
	const requiredEmployeeIds = new Set([
		source.employeeId,
		...requests.flatMap((request) => [request.requestedBy, request.approverId]),
		...(chain ? [chain.requesterEmployeeId] : []),
		...chainRows.flatMap((row) => [
			row.resolvedApproverEmployeeId,
			...(row.decidedBy ? [row.decidedBy] : []),
		]),
	]);
	const ownedIds = new Set(
		employeeEvidence.flatMap((employee) =>
			employee.organizationId === input.organizationId ? [employee.id] : [],
		),
	);
	if (
		employeeEvidence.length !== ownedIds.size ||
		ownedIds.size !== requiredEmployeeIds.size ||
		[...requiredEmployeeIds].some((id) => !ownedIds.has(id))
	) {
		fail();
	}

	const sourceSnapshot = {
		id: source.id,
		organizationId: source.organizationId,
		employeeId: source.employeeId,
		status: correctionLifecycle ?? source.approvalStatus,
		canonicalRecordId: source.canonicalRecordId,
		approvalWorkflowId: source.approvalWorkflowId,
		workPeriod: {
			...source,
			pendingChanges: source.pendingChanges,
			startTime: instantToCanonicalString(source.startTime),
			endTime: serializeInstant(source.endTime),
			deletedAt: serializeInstant(source.deletedAt),
		},
		canonicalRecord: {
			...canonical,
			startAt: instantToCanonicalString(canonical.startAt),
			endAt: serializeInstant(canonical.endAt),
		},
		canonicalWork,
		currentEndpoints: {
			clockIn: serializeEntry(currentClockIn),
			clockOut: currentClockOut ? serializeEntry(currentClockOut) : null,
		},
		...(payload ? { timeCorrection: payload.timeCorrection } : {}),
		...(originalWorkMetadata
			? { timeCorrectionOriginalWorkMetadata: originalWorkMetadata }
			: {}),
		correctionEndpoints,
	};
	const displaySnapshot = {
		status: correctionLifecycle ?? source.approvalStatus,
		workPeriod: {
			id: source.id,
			startAt: instantToCanonicalString(source.startTime),
			endAt: serializeInstant(source.endTime),
			durationMinutes: source.durationMinutes,
			isDeleted: source.deletedAt !== null,
		},
		labels: {
			title: "Time correction",
			...(payload ? { action: payload.timeCorrection.action } : {}),
			endpoints: correctionEndpoints.map((endpoint) =>
				endpoint.endpointType === "clock_in" ? "Clock in" : "Clock out",
			),
		},
		...(payload && Object.hasOwn(payload.timeCorrection, "workLocationType")
			? {
					workMetadata: {
						original:
							originalWorkMetadata ??
							({
								workLocationType: source.workLocationType,
								workCategoryId: source.workCategoryId,
							} as const),
						requested: {
							workLocationType: (
								payload.timeCorrection as CurrentTimeCorrectionWorkflowContract
							).workLocationType,
							workCategoryId: (
								payload.timeCorrection as CurrentTimeCorrectionWorkflowContract
							).workCategoryId,
						},
					},
				}
			: {}),
	};

	return normalizeStableData({
		organizationId: input.organizationId,
		source: {
			organizationId: input.organizationId,
			workflowType: "time_correction",
			sourceType: "time_entry",
			sourceId: input.workPeriodId,
		},
		approvalRequest,
		chain,
		chainRows,
		sourceSnapshot,
		displaySnapshot,
		capturedAt: input.capturedAt,
	}) as VerifiedLegacyApprovalState;
}

export async function captureTimeCorrectionLegacyApprovalState(
	input: CaptureTimeCorrectionLegacyApprovalStateInput,
): Promise<VerifiedLegacyApprovalState> {
	let expectedPayload: TimeCorrectionWorkflowPayload | null = null;
	let expectedCycle: Readonly<ExpectedTimeCorrectionLegacyCycle> | null = null;
	try {
		expectedPayload = input.expectedCorrection
			? normalizeTimeCorrectionWorkflowPayload({
					timeCorrection: input.expectedCorrection,
				})
			: null;
		expectedCycle = normalizeExpectedLegacyCycle(input.expectedLegacyCycle);
	} catch {
		return fail();
	}
	const expectedPayloadJson = expectedPayload
		? JSON.stringify(expectedPayload)
		: null;
	let queryResult: unknown;
	try {
		queryResult = await input.dbService.db.execute(sql`
			with capture_input as (
				select
					${input.organizationId}::text as organization_id,
					${"time_entry"}::text as entity_type,
					${input.workPeriodId}::uuid as entity_id,
					${expectedPayloadJson}::jsonb as expected_payload,
					${expectedCycle?.approvalRequestId ?? null}::uuid as expected_request_id,
					${expectedCycle?.chainInstanceId ?? null}::uuid as expected_chain_id
			),
			source_rows as (
				select
					period.id,
					period.organization_id as "organizationId",
					period.employee_id as "employeeId",
					period.clock_in_id as "clockInId",
					period.clock_out_id as "clockOutId",
					period.start_time as "startTime",
					period.end_time as "endTime",
					period.duration_minutes as "durationMinutes",
					period.is_active as "isActive",
					period.approval_status as "approvalStatus",
					period.pending_changes as "pendingChanges",
					period.deleted_at as "deletedAt",
					period.canonical_record_id as "canonicalRecordId",
					period.approval_workflow_id as "approvalWorkflowId",
					period.work_location_type as "workLocationType",
					period.work_category_id as "workCategoryId"
				from work_period period
				cross join capture_input capture
				join employee
					on period.employee_id = employee.id
					and period.organization_id = employee.organization_id
					and employee.organization_id = capture.organization_id
				where period.organization_id = capture.organization_id
					and period.id = capture.entity_id
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
				from source_rows period
				cross join capture_input capture
				join time_record record
					on record.id = period."canonicalRecordId"
					and record.organization_id = capture.organization_id
					and record.employee_id = period."employeeId"
					and record.record_kind = 'work'
			),
			canonical_work_rows as (
				select
					work.record_id as "recordId",
					work.organization_id as "organizationId",
					work.record_kind as "recordKind",
					work.work_location_type as "workLocationType",
					work.work_category_id as "workCategoryId"
				from canonical_rows record
				cross join capture_input capture
				join time_record_work work
					on work.record_id = record.id
					and work.organization_id = capture.organization_id
					and work.record_kind = 'work'
			),
			request_candidate_counts as (
				select
					count(*) filter (where request.status = 'pending')::integer as "pendingRequestCount",
					count(*) filter (
						where request.status = 'pending'
							and not exists (
								select 1
								from approval_chain_stage_instance ownership_stage
								where ownership_stage.organization_id = capture.organization_id
									and ownership_stage.approval_request_id = request.id
							)
					)::integer as "eligiblePendingDirectRequestCount",
					count(*) filter (where request.id = capture.expected_request_id)::integer as "expectedRequestCount"
				from approval_request request
				cross join capture_input capture
				where request.organization_id = capture.organization_id
					and request.entity_type = capture.entity_type
					and request.entity_id = capture.entity_id
			),
			chain_candidate_counts as (
				select
					count(*) filter (where chain.status = 'pending')::integer as "pendingChainCount",
					count(*) filter (where chain.id = capture.expected_chain_id)::integer as "expectedChainCount"
				from approval_chain_instance chain
				cross join capture_input capture
				where chain.organization_id = capture.organization_id
					and chain.entity_type = capture.entity_type
					and chain.entity_id = capture.entity_id
			),
			chain_rows_source as (
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
				from approval_chain_instance chain
				cross join capture_input capture
				cross join request_candidate_counts request_counts
				cross join chain_candidate_counts chain_counts
				where chain.organization_id = capture.organization_id
					and chain.entity_type = capture.entity_type
					and chain.entity_id = capture.entity_id
					and request_counts."pendingRequestCount" <= 1
					and chain_counts."pendingChainCount" <= 1
					and (
						(
							capture.expected_chain_id is not null
							and chain_counts."expectedChainCount" = 1
							and chain_counts."pendingChainCount" = 0
							and request_counts."pendingRequestCount" = 0
							and request_counts."eligiblePendingDirectRequestCount" = 0
							and chain.id = capture.expected_chain_id
						)
						or (
							capture.expected_chain_id is null
							and capture.expected_request_id is null
							and chain.status = 'pending'
							and chain_counts."pendingChainCount" = 1
							and request_counts."pendingRequestCount" = 1
							and request_counts."eligiblePendingDirectRequestCount" = 0
						)
					)
			),
			stage_rows as (
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
				from approval_chain_stage_instance stage
				join chain_rows_source chain
					on stage.chain_instance_id = chain.id
					and stage.organization_id = chain."organizationId"
				cross join capture_input capture
				where stage.organization_id = capture.organization_id
				order by stage.step_order, stage.id
			),
			selected_request_ids as (
				select "approvalRequestId" as id
				from stage_rows
				where "approvalRequestId" is not null
				union
				select request.id
				from approval_request request
				cross join capture_input capture
				cross join request_candidate_counts request_counts
				cross join chain_candidate_counts chain_counts
				where request.organization_id = capture.organization_id
					and request.entity_type = capture.entity_type
					and request.entity_id = capture.entity_id
					and request_counts."pendingRequestCount" <= 1
					and chain_counts."pendingChainCount" <= 1
					and not exists (
						select 1
						from approval_chain_stage_instance stage
						where stage.organization_id = capture.organization_id
							and stage.approval_request_id = request.id
					)
					and (
						(
							capture.expected_request_id is not null
							and capture.expected_chain_id is null
							and request_counts."expectedRequestCount" = 1
							and request.id = capture.expected_request_id
						)
						or (
							capture.expected_request_id is null
							and capture.expected_chain_id is null
							and request.status = 'pending'
							and request_counts."pendingRequestCount" = 1
							and request_counts."eligiblePendingDirectRequestCount" = 1
							and chain_counts."pendingChainCount" = 0
						)
					)
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
				from selected_request_ids selected
				cross join capture_input capture
				join approval_request request
					on request.id = selected.id
					and request.organization_id = capture.organization_id
				where request.organization_id = capture.organization_id
					and request.entity_type = capture.entity_type
					and request.entity_id = capture.entity_id
				order by request.updated_at, request.id
			),
			payload_ids as (
				select request.id as request_id, 'clock_in'::text as endpoint_type,
					request.metadata -> 'timeCorrection' ->> 'clockInCorrectionId' as correction_id
				from request_rows request
				union all
				select request.id, 'clock_out'::text,
					request.metadata -> 'timeCorrection' ->> 'clockOutCorrectionId'
				from request_rows request
				union all
				select null::uuid, 'clock_in'::text,
					capture.expected_payload -> 'timeCorrection' ->> 'clockInCorrectionId'
				from capture_input capture
				where capture.expected_payload is not null
					and not exists (select 1 from request_rows)
				union all
				select null::uuid, 'clock_out'::text,
					capture.expected_payload -> 'timeCorrection' ->> 'clockOutCorrectionId'
				from capture_input capture
				where capture.expected_payload is not null
					and not exists (select 1 from request_rows)
			),
			correction_rows as (
				select distinct
					payload.endpoint_type as "endpointType",
					correction.id,
					correction.organization_id as "organizationId",
					correction.employee_id as "employeeId",
					correction.type,
					correction.timestamp,
					correction.utc_offset_minutes as "utcOffsetMinutes",
					correction.timezone,
					correction.timezone_source as "timezoneSource",
					correction.replaces_entry_id as "replacesEntryId",
					correction.is_superseded as "isSuperseded",
					correction.superseded_by_id as "supersededById",
					false as "isDeleted"
				from payload_ids payload
				cross join capture_input capture
				join source_rows period on true
				join time_entry correction
					on correction.id::text = payload.correction_id
					and correction.organization_id = capture.organization_id
					and correction.employee_id = period."employeeId"
			),
			original_rows as (
				select distinct
					original.id,
					original.organization_id as "organizationId",
					original.employee_id as "employeeId",
					original.type,
					original.timestamp,
					original.utc_offset_minutes as "utcOffsetMinutes",
					original.timezone,
					original.timezone_source as "timezoneSource",
					original.replaces_entry_id as "replacesEntryId",
					original.is_superseded as "isSuperseded",
					original.superseded_by_id as "supersededById",
					false as "isDeleted"
				from correction_rows correction
				cross join capture_input capture
				join source_rows period on true
				join time_entry original
					on original.id = correction."replacesEntryId"
					and original.organization_id = capture.organization_id
					and original.employee_id = period."employeeId"
			),
			current_endpoint_rows as (
				select
					endpoint.endpoint_type,
					entry.id,
					entry.organization_id as "organizationId",
					entry.employee_id as "employeeId",
					entry.type,
					entry.timestamp,
					entry.utc_offset_minutes as "utcOffsetMinutes",
					entry.timezone,
					entry.timezone_source as "timezoneSource",
					entry.replaces_entry_id as "replacesEntryId",
					entry.is_superseded as "isSuperseded",
					entry.superseded_by_id as "supersededById",
					false as "isDeleted"
				from source_rows period
				cross join capture_input capture
				cross join lateral (values
					('clock_in'::text, period."clockInId"),
					('clock_out'::text, period."clockOutId")
				) endpoint(endpoint_type, entry_id)
				join time_entry entry
					on entry.id = endpoint.entry_id
					and entry.organization_id = capture.organization_id
					and entry.employee_id = period."employeeId"
			),
			current_endpoint_predecessor_rows as (
				select distinct
					predecessor.id,
					predecessor.organization_id as "organizationId",
					predecessor.employee_id as "employeeId",
					predecessor.type,
					predecessor.timestamp,
					predecessor.utc_offset_minutes as "utcOffsetMinutes",
					predecessor.timezone,
					predecessor.timezone_source as "timezoneSource",
					predecessor.replaces_entry_id as "replacesEntryId",
					predecessor.is_superseded as "isSuperseded",
					predecessor.superseded_by_id as "supersededById",
					false as "isDeleted"
				from current_endpoint_rows current
				cross join capture_input capture
				join source_rows period on true
				join time_entry predecessor
					on predecessor.id = current."replacesEntryId"
					and predecessor.organization_id = capture.organization_id
					and predecessor.employee_id = period."employeeId"
				where current.type = 'correction'
			),
			required_employee_ids as (
				select "employeeId" as id from source_rows
				union select "requestedBy" from request_rows
				union select "approverId" from request_rows
				union select "requesterEmployeeId" from chain_rows_source
				union select "resolvedApproverEmployeeId" from stage_rows
				union select "decidedBy" from stage_rows where "decidedBy" is not null
			),
			employee_identity_rows as (
				select employee.id, employee.organization_id as "organizationId"
				from required_employee_ids required
				cross join capture_input capture
				join employee
					on employee.id = required.id
					and employee.organization_id = capture.organization_id
			)
			select
				(select row_to_json(source) from source_rows source limit 1) as source,
				(select row_to_json(record) from canonical_rows record limit 1) as "canonicalRecord",
				(select row_to_json(work) from canonical_work_rows work limit 1) as "canonicalWork",
				json_build_object(
					'clockIn', (select row_to_json(endpoint) from current_endpoint_rows endpoint where endpoint.endpoint_type = 'clock_in' limit 1),
					'clockOut', (select row_to_json(endpoint) from current_endpoint_rows endpoint where endpoint.endpoint_type = 'clock_out' limit 1)
				) as "currentEndpoints",
				coalesce((select json_agg(predecessor) from current_endpoint_predecessor_rows predecessor), '[]'::json) as "currentEndpointPredecessors",
				coalesce((select json_agg(request) from request_rows request), '[]'::json) as "approvalRequests",
				coalesce((select json_agg(chain) from chain_rows_source chain), '[]'::json) as chains,
				coalesce((select json_agg(stage) from stage_rows stage), '[]'::json) as "chainRows",
				coalesce((select json_agg(correction) from correction_rows correction), '[]'::json) as "correctionEntries",
				coalesce((select json_agg(original) from original_rows original), '[]'::json) as "originalEntries",
				json_build_object(
					'pendingRequestCount', (select "pendingRequestCount" from request_candidate_counts),
					'eligiblePendingDirectRequestCount', (select "eligiblePendingDirectRequestCount" from request_candidate_counts),
					'expectedRequestCount', (select "expectedRequestCount" from request_candidate_counts),
					'pendingChainCount', (select "pendingChainCount" from chain_candidate_counts),
					'expectedChainCount', (select "expectedChainCount" from chain_candidate_counts),
					'selectedRequestCount', (select count(*)::integer from request_rows),
					'selectedChainCount', (select count(*)::integer from chain_rows_source)
				) as "selectionEvidence",
				json_build_object(
					'employees', coalesce((select json_agg(employee) from employee_identity_rows employee), '[]'::json)
				) as "identityEvidence"
		`);
	} catch {
		return fail("query_failed");
	}
	try {
		return decodeCapture(input, queryResult, expectedPayload, expectedCycle);
	} catch (error) {
		if (error instanceof TimeCorrectionLegacyStateCaptureError) throw error;
		return fail();
	}
}
