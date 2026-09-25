import { createHash } from "node:crypto";
import { instantFromDate, instantToCanonicalString } from "@/lib/datetime/temporal-core";
import type { PolicyClockOutBreakSnapshot } from "@/lib/time-tracking/policy-clock-out-break-snapshot";
import type { PolicyClockOutSurchargeSnapshot } from "@/lib/time-tracking/policy-clock-out-surcharge-snapshot";
import { canonicalJson } from "./absence-facts";
import { ApprovalEvidenceError } from "./errors";

/**
 * Submitted facts of a manual time submission or policy clock-out (#302). The
 * submission owner captures them from the locked work graph before routing or
 * terminal finalization can change it; a later read of the period is never the
 * submitted interval.
 */
export const WORK_PERIOD_EVIDENCE_SCHEMA_VERSION = 1;

export type WorkPeriodEvidenceKind = "manual_time_submission" | "policy_clock_out";

export interface WorkPeriodEndpointFacts {
	entryId: string;
	/** Exact UTC instant of the event. */
	at: string;
	/** The event's own captured offset; endpoints may differ across travel/DST. */
	utcOffsetMinutes: number;
	timezone: string | null;
	timezoneSource: string;
}

export interface WorkPeriodSubmittedInterval {
	clockIn: WorkPeriodEndpointFacts;
	clockOut: WorkPeriodEndpointFacts;
	/** The minutes stored with the submission. Never recomputed. */
	storedDurationMinutes: number;
	/** UTC elapsed time between the endpoints, kept apart from stored minutes. */
	elapsedSeconds: number;
}

/**
 * Captured policy inputs. A break snapshot only discloses that an adjustment
 * may apply; the numerical deduction exists only as committed result evidence.
 */
export type WorkPeriodSubmittedPolicy =
	| {
			kind: "manual_time_submission";
			surchargeSnapshot: PolicyClockOutSurchargeSnapshot | null;
	  }
	| {
			kind: "policy_clock_out";
			breakAdjustment: "may_apply" | "not_applicable";
			breakPolicySnapshot: PolicyClockOutBreakSnapshot;
			surchargeSnapshot: PolicyClockOutSurchargeSnapshot | null;
	  };

export interface WorkPeriodSubmittedFacts {
	schemaVersion: typeof WORK_PERIOD_EVIDENCE_SCHEMA_VERSION;
	kind: WorkPeriodEvidenceKind;
	organizationId: string;
	workPeriodId: string;
	canonicalRecordId: string;
	subjectEmployeeId: string;
	requesterEmployeeId: string;
	interval: WorkPeriodSubmittedInterval;
	policy: WorkPeriodSubmittedPolicy;
	/** References the FKs may clear later; descriptive, not material. */
	attribution: {
		projectId: string | null;
		workCategoryId: string | null;
		workLocationType: string | null;
	};
}

interface EntryRow {
	id: string;
	organizationId: string;
	employeeId: string;
	type: string;
	timestamp: Date;
	utcOffsetMinutes: number;
	timezone: string | null;
	timezoneSource: string;
}

export interface WorkPeriodFactsInput {
	kind: WorkPeriodEvidenceKind;
	requesterEmployeeId: string;
	period: {
		id: string;
		organizationId: string;
		employeeId: string;
		clockInId: string | null;
		clockOutId: string | null;
		canonicalRecordId: string | null;
		startTime: Date;
		endTime: Date | null;
		durationMinutes: number | null;
		isActive: boolean;
		deletedAt: Date | null;
		projectId: string | null;
		workCategoryId: string | null;
		workLocationType: string | null;
	};
	clockIn: EntryRow | null;
	clockOut: EntryRow | null;
	policy: {
		breakPolicySnapshot: PolicyClockOutBreakSnapshot | null;
		surchargeSnapshot: PolicyClockOutSurchargeSnapshot | null;
	};
}

function incomplete(field: string): never {
	throw new ApprovalEvidenceError("evidence_incomplete", { field });
}

function endpoint(
	input: WorkPeriodFactsInput,
	field: "clock_in" | "clock_out",
	entry: EntryRow | null,
	expectedId: string | null,
	expectedAt: Date | null,
): WorkPeriodEndpointFacts {
	if (
		!entry ||
		!expectedAt ||
		entry.id !== expectedId ||
		entry.organizationId !== input.period.organizationId ||
		entry.employeeId !== input.period.employeeId ||
		entry.type !== field ||
		entry.timestamp.getTime() !== expectedAt.getTime() ||
		!Number.isSafeInteger(entry.utcOffsetMinutes)
	) {
		return incomplete(field);
	}
	return {
		entryId: entry.id,
		at: instantToCanonicalString(instantFromDate(entry.timestamp)),
		utcOffsetMinutes: entry.utcOffsetMinutes,
		timezone: entry.timezone,
		timezoneSource: entry.timezoneSource,
	};
}

export function breakAdjustmentDisclosure(
	snapshot: PolicyClockOutBreakSnapshot,
): "may_apply" | "not_applicable" {
	if (snapshot.resolution !== "work_policy" || !snapshot.regulationEnabled) {
		return "not_applicable";
	}
	return snapshot.breakRules.length > 0 || snapshot.regulation.maxUninterruptedMinutes !== null
		? "may_apply"
		: "not_applicable";
}

function policy(input: WorkPeriodFactsInput): WorkPeriodSubmittedPolicy {
	if (input.kind === "manual_time_submission") {
		return { kind: input.kind, surchargeSnapshot: input.policy.surchargeSnapshot };
	}
	const breakPolicySnapshot = input.policy.breakPolicySnapshot ?? incomplete("break_policy");
	return {
		kind: input.kind,
		breakAdjustment: breakAdjustmentDisclosure(breakPolicySnapshot),
		breakPolicySnapshot,
		surchargeSnapshot: input.policy.surchargeSnapshot,
	};
}

/**
 * Builds the submitted facts from the locked, closed work graph. Anything that
 * cannot be verified throws `evidence_incomplete` instead of being guessed; a
 * manual submission has no before state, so none is recorded.
 */
export function buildWorkPeriodSubmittedFacts(
	input: WorkPeriodFactsInput,
): WorkPeriodSubmittedFacts {
	const { period } = input;
	if (
		period.isActive ||
		period.deletedAt !== null ||
		period.endTime === null ||
		period.endTime.getTime() <= period.startTime.getTime()
	) {
		return incomplete("interval");
	}
	if (period.durationMinutes === null || !Number.isSafeInteger(period.durationMinutes)) {
		return incomplete("duration");
	}
	if (!period.canonicalRecordId) return incomplete("canonical_record");
	if (input.requesterEmployeeId !== period.employeeId) return incomplete("roles");
	const clockIn = endpoint(input, "clock_in", input.clockIn, period.clockInId, period.startTime);
	const clockOut = endpoint(input, "clock_out", input.clockOut, period.clockOutId, period.endTime);
	return {
		schemaVersion: WORK_PERIOD_EVIDENCE_SCHEMA_VERSION,
		kind: input.kind,
		organizationId: period.organizationId,
		workPeriodId: period.id,
		canonicalRecordId: period.canonicalRecordId,
		subjectEmployeeId: period.employeeId,
		requesterEmployeeId: input.requesterEmployeeId,
		interval: {
			clockIn,
			clockOut,
			storedDurationMinutes: period.durationMinutes,
			elapsedSeconds: (period.endTime.getTime() - period.startTime.getTime()) / 1000,
		},
		policy: policy(input),
		attribution: {
			projectId: period.projectId,
			workCategoryId: period.workCategoryId,
			workLocationType: period.workLocationType,
		},
	};
}

const MATERIAL_FIELDS = [
	"organizationId",
	"workPeriodId",
	"canonicalRecordId",
	"subjectEmployeeId",
	"requesterEmployeeId",
	"interval",
	"policy",
] as const;

/** Fields a decision can re-verify against the live graph. */
const LIVE_FIELDS = [
	"organizationId",
	"workPeriodId",
	"canonicalRecordId",
	"subjectEmployeeId",
	"interval",
] as const;

export function materialWorkPeriodFacts(facts: WorkPeriodSubmittedFacts): Record<string, unknown> {
	return Object.fromEntries([
		["schemaVersion", facts.schemaVersion],
		["kind", facts.kind],
		...MATERIAL_FIELDS.map((field) => [field, facts[field]]),
	]);
}

/** Versioned identity of the reviewed submission. Attribution does not participate. */
export function fingerprintWorkPeriodMaterialFacts(facts: WorkPeriodSubmittedFacts): string {
	return `work_period:v${WORK_PERIOD_EVIDENCE_SCHEMA_VERSION}:${createHash("sha256")
		.update(canonicalJson(materialWorkPeriodFacts(facts)))
		.digest("hex")}`;
}

export type WorkPeriodRevisionComparison =
	| { kind: "current" }
	| { kind: "material_change"; changedFields: string[] };

/**
 * Compares the live work graph with the submitted revision. Moved or replaced
 * endpoints, changed stored minutes or rows that can no longer be verified hold
 * the decision. Captured policy inputs are enforced by the terminal finalizer.
 */
export function compareLiveWorkPeriodWithRevision(
	submitted: WorkPeriodSubmittedFacts,
	live: WorkPeriodFactsInput,
): WorkPeriodRevisionComparison {
	let liveFacts: WorkPeriodSubmittedFacts;
	try {
		liveFacts = buildWorkPeriodSubmittedFacts({
			...live,
			kind: submitted.kind,
			requesterEmployeeId: submitted.requesterEmployeeId,
			// Policy inputs are compared by the finalizer, not re-derived here.
			policy: {
				breakPolicySnapshot:
					submitted.policy.kind === "policy_clock_out"
						? submitted.policy.breakPolicySnapshot
						: null,
				surchargeSnapshot: submitted.policy.surchargeSnapshot,
			},
		});
	} catch (error) {
		if (!(error instanceof ApprovalEvidenceError)) throw error;
		return {
			kind: "material_change",
			changedFields: [`unverifiable:${error.details.field ?? error.code}`],
		};
	}
	const changedFields = LIVE_FIELDS.filter(
		(field) => canonicalJson(submitted[field]) !== canonicalJson(liveFacts[field]),
	);
	return changedFields.length > 0
		? { kind: "material_change", changedFields: [...changedFields] }
		: { kind: "current" };
}

/** Request-time descriptive labels. Never material. */
export interface WorkPeriodSubmittedLabels {
	subjectName: string | null;
	requesterName: string | null;
	submitterName: string | null;
}
