import { createHash } from "node:crypto";
import {
	compareInstants,
	instantFromDate,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import { canonicalJson } from "./absence-facts";
import { ApprovalEvidenceError } from "./errors";
import type { WorkPeriodEndpointFacts } from "./work-period-facts";

/**
 * Submitted facts of an approval-based time correction (#301). The submission
 * owner captures them from the locked, requester-owned period before routing or
 * an auto-completing finalization can change it: the baseline as it stood, the
 * requested values, the changed-field mask and the intent (edit, metadata-only
 * or deletion). A later read of the period is never the submitted baseline.
 */
export const TIME_CORRECTION_EVIDENCE_SCHEMA_VERSION = 1;

export type TimeCorrectionEvidenceIntent = "edit" | "metadata_only" | "delete";

export interface TimeCorrectionRequestedEndpoint {
	/** The endpoint entry the correction replaces. */
	originalEntryId: string;
	/** The pending correction entry carrying the requested instant. */
	correctionEntryId: string;
	at: string;
	utcOffsetMinutes: number;
	timezone: string;
	timezoneSource: string;
}

/**
 * Requested attribution. `unchanged` means the proposal does not carry the field
 * (legacy contract); `set` carries a value, where an explicit null clears it.
 */
export type TimeCorrectionRequestedValue =
	| { kind: "unchanged" }
	| { kind: "set"; value: string | null };

export interface TimeCorrectionSubmittedFacts {
	schemaVersion: typeof TIME_CORRECTION_EVIDENCE_SCHEMA_VERSION;
	kind: "time_correction";
	organizationId: string;
	workPeriodId: string;
	canonicalRecordId: string | null;
	subjectEmployeeId: string;
	requesterEmployeeId: string;
	intent: TimeCorrectionEvidenceIntent;
	/** The requester-owned period as locked at submission. */
	baseline: {
		clockIn: WorkPeriodEndpointFacts;
		/** Null for active work, which may only correct its start. */
		clockOut: WorkPeriodEndpointFacts | null;
		/** The stored minutes as persisted; never recomputed. */
		storedDurationMinutes: number | null;
		/** UTC elapsed time between the endpoints, kept apart from stored minutes. */
		elapsedSeconds: number | null;
		attribution: {
			projectId: string | null;
			workCategoryId: string | null;
			workLocationType: string | null;
		};
	};
	requested: {
		clockIn: TimeCorrectionRequestedEndpoint | null;
		clockOut: TimeCorrectionRequestedEndpoint | null;
		workLocationType: TimeCorrectionRequestedValue;
		workCategoryId: TimeCorrectionRequestedValue;
	};
	changeMask: {
		clockIn: boolean;
		clockOut: boolean;
		workLocation: boolean;
		workCategory: boolean;
	};
}

export interface TimeCorrectionEntryRow {
	id: string;
	organizationId: string;
	employeeId: string;
	type: string;
	timestamp: Date;
	utcOffsetMinutes: number;
	timezone: string | null;
	timezoneSource: string;
	replacesEntryId: string | null;
}

export interface TimeCorrectionFactsInput {
	requesterEmployeeId: string;
	period: {
		id: string;
		organizationId: string;
		employeeId: string;
		clockInId: string;
		clockOutId: string | null;
		canonicalRecordId: string | null;
		startTime: Date;
		endTime: Date | null;
		durationMinutes: number | null;
		deletedAt: Date | null;
		projectId: string | null;
		workCategoryId: string | null;
		workLocationType: string | null;
	};
	clockIn: TimeCorrectionEntryRow | null;
	clockOut: TimeCorrectionEntryRow | null;
	correction: {
		action: "edit" | "delete";
		/** Present only for the current contract. */
		workLocationType?: string;
		workCategoryId?: string | null;
	};
	/** The pending correction entries the submission appended or verified. */
	corrections: {
		clockIn: TimeCorrectionEntryRow | null;
		clockOut: TimeCorrectionEntryRow | null;
	};
}

function incomplete(field: string): never {
	throw new ApprovalEvidenceError("evidence_incomplete", { field });
}

function endpoint(
	period: TimeCorrectionFactsInput["period"],
	field: "clock_in" | "clock_out",
	entry: TimeCorrectionEntryRow | null,
	expectedId: string | null,
	expectedAt: Date | null,
): WorkPeriodEndpointFacts {
	if (
		!entry ||
		expectedAt === null ||
		entry.id !== expectedId ||
		entry.organizationId !== period.organizationId ||
		entry.employeeId !== period.employeeId ||
		(entry.type !== field && entry.type !== "correction") ||
		compareInstants(instantFromDate(entry.timestamp), instantFromDate(expectedAt)) !== 0 ||
		!Number.isSafeInteger(entry.utcOffsetMinutes)
	) {
		return incomplete(field);
	}
	return {
		entryId: entry.id,
		at: instantToCanonicalString(instantFromDate(expectedAt)),
		utcOffsetMinutes: entry.utcOffsetMinutes,
		timezone: entry.timezone,
		timezoneSource: entry.timezoneSource,
	};
}

function requestedEndpoint(
	period: TimeCorrectionFactsInput["period"],
	field: "clock_in" | "clock_out",
	correction: TimeCorrectionEntryRow | null,
	originalId: string | null,
): TimeCorrectionRequestedEndpoint | null {
	if (!correction) return null;
	if (
		originalId === null ||
		correction.type !== "correction" ||
		correction.replacesEntryId !== originalId ||
		correction.organizationId !== period.organizationId ||
		correction.employeeId !== period.employeeId ||
		!correction.timezone ||
		!Number.isSafeInteger(correction.utcOffsetMinutes)
	) {
		return incomplete(`requested_${field}`);
	}
	return {
		originalEntryId: originalId,
		correctionEntryId: correction.id,
		at: instantToCanonicalString(instantFromDate(correction.timestamp)),
		utcOffsetMinutes: correction.utcOffsetMinutes,
		timezone: correction.timezone,
		timezoneSource: correction.timezoneSource,
	};
}

function requestedValue(
	correction: TimeCorrectionFactsInput["correction"],
	key: "workLocationType" | "workCategoryId",
): TimeCorrectionRequestedValue {
	return Object.hasOwn(correction, key)
		? { kind: "set", value: correction[key] ?? null }
		: { kind: "unchanged" };
}

function changes(requested: TimeCorrectionRequestedValue, current: string | null): boolean {
	return requested.kind === "set" && requested.value !== current;
}

/**
 * Builds the submitted facts from the locked, requester-owned period and the
 * pending correction entries. Anything unverifiable throws `evidence_incomplete`
 * instead of being guessed.
 */
export function buildTimeCorrectionSubmittedFacts(
	input: TimeCorrectionFactsInput,
): TimeCorrectionSubmittedFacts {
	const { period } = input;
	if (period.deletedAt !== null) return incomplete("work_period");
	if (input.requesterEmployeeId !== period.employeeId) return incomplete("roles");
	const clockIn = endpoint(period, "clock_in", input.clockIn, period.clockInId, period.startTime);
	const clockOut =
		period.clockOutId === null
			? null
			: endpoint(period, "clock_out", input.clockOut, period.clockOutId, period.endTime);
	if ((clockOut === null) !== (period.endTime === null)) return incomplete("interval");
	const requested = {
		clockIn: requestedEndpoint(period, "clock_in", input.corrections.clockIn, period.clockInId),
		clockOut: requestedEndpoint(period, "clock_out", input.corrections.clockOut, period.clockOutId),
		workLocationType: requestedValue(input.correction, "workLocationType"),
		workCategoryId: requestedValue(input.correction, "workCategoryId"),
	};
	const intent: TimeCorrectionEvidenceIntent =
		input.correction.action === "delete"
			? "delete"
			: requested.clockIn || requested.clockOut
				? "edit"
				: "metadata_only";
	if (intent === "delete" && (!requested.clockIn || !requested.clockOut)) {
		return incomplete("deletion_endpoints");
	}
	const start = instantFromDate(period.startTime);
	const end = period.endTime ? instantFromDate(period.endTime) : null;
	return {
		schemaVersion: TIME_CORRECTION_EVIDENCE_SCHEMA_VERSION,
		kind: "time_correction",
		organizationId: period.organizationId,
		workPeriodId: period.id,
		canonicalRecordId: period.canonicalRecordId,
		subjectEmployeeId: period.employeeId,
		requesterEmployeeId: input.requesterEmployeeId,
		intent,
		baseline: {
			clockIn,
			clockOut,
			storedDurationMinutes: period.durationMinutes,
			elapsedSeconds: end ? end.since(start).total({ unit: "seconds" }) : null,
			attribution: {
				projectId: period.projectId,
				workCategoryId: period.workCategoryId,
				workLocationType: period.workLocationType,
			},
		},
		requested,
		changeMask: {
			clockIn: requested.clockIn !== null,
			clockOut: requested.clockOut !== null,
			workLocation: changes(requested.workLocationType, period.workLocationType),
			workCategory: changes(requested.workCategoryId, period.workCategoryId),
		},
	};
}

/** Versioned identity of the reviewed proposal: every submitted fact is material. */
export function fingerprintTimeCorrectionFacts(facts: TimeCorrectionSubmittedFacts): string {
	return `time_correction:v${TIME_CORRECTION_EVIDENCE_SCHEMA_VERSION}:${createHash("sha256")
		.update(canonicalJson(facts as unknown as Record<string, unknown>))
		.digest("hex")}`;
}

export type TimeCorrectionRevisionComparison =
	| { kind: "current" }
	| { kind: "material_change"; changedFields: string[] };

/**
 * Compares the live period with the submitted baseline. A moved or replaced
 * endpoint, changed stored minutes or attribution, deletion, or rows that can
 * no longer be verified hold the decision.
 */
export function compareLiveTimeCorrectionWithRevision(
	submitted: TimeCorrectionSubmittedFacts,
	live: TimeCorrectionFactsInput,
): TimeCorrectionRevisionComparison {
	let liveFacts: TimeCorrectionSubmittedFacts;
	try {
		liveFacts = buildTimeCorrectionSubmittedFacts(live);
	} catch (error) {
		if (!(error instanceof ApprovalEvidenceError)) throw error;
		return {
			kind: "material_change",
			changedFields: [`unverifiable:${error.details.field ?? error.code}`],
		};
	}
	const changedFields = (
		[
			["canonicalRecordId", submitted.canonicalRecordId, liveFacts.canonicalRecordId],
			["baseline", submitted.baseline, liveFacts.baseline],
			["requested", submitted.requested, liveFacts.requested],
		] as const
	)
		.filter(([, left, right]) => canonicalJson(left) !== canonicalJson(right))
		.map(([field]) => field);
	return changedFields.length > 0
		? { kind: "material_change", changedFields: [...changedFields] }
		: { kind: "current" };
}
