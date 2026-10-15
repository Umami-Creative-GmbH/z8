/**
 * The plan step of an amendment (ADR 0010, #1225): from the locked pair, the
 * new times and the resolved attribution patch, what the amended work period
 * and its canonical work record hold. Pure, no I/O, no server-only imports.
 *
 * Record agreement is checked on the locked pair before planning and on the
 * planned pair; either disagreement is a `canonical_divergence` refusal.
 */
import { compareInstants, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import type { AmendmentChanges, ToleratedDrift, WorkApprovalDecision } from "./amend-change";
import type { WorkRecordRefusal } from "./change";
import {
	type PlannedHalf,
	plannedHalf,
	type WorkDurationArithmetic,
	type WorkRecordPair,
	workDurationMinutes,
} from "./plan";
import { recordAgreement } from "./record-agreement";
import {
	UnrepresentableWorkAttributionError,
	WorkAttribution,
	type WorkAttributionPatch,
} from "./work-attribution";

/** A named endpoint: its instant, and whether a recorded correction is adopted for it. */
type PlannableEndpoint = { at: Instant; adopted?: boolean };

/** The policy part of an amendment, with the project's billable default already read. */
export type PlannableAmendment = {
	kind: "amend";
	times?: { clockIn?: PlannableEndpoint; clockOut?: PlannableEndpoint };
	attribution?: WorkAttributionPatch;
	approval?: WorkApprovalDecision;
	toleratedDrift?: readonly ToleratedDrift[];
};

export type AmendmentPlan = {
	kind: "amend";
	changes: AmendmentChanges;
	/** The amended pair: its interval, minutes, attribution and both representations. */
	result: PlannedHalf;
};

export function planAmendment(
	pair: WorkRecordPair,
	change: PlannableAmendment,
	arithmetic: WorkDurationArithmetic,
): AmendmentPlan | WorkRecordRefusal {
	const { period, canonical } = pair;
	if (period.endTime === null) return { kind: "work_running" };
	if (!canonical) return { kind: "canonical_record_missing" };
	if (period.durationMinutes === null) {
		return { kind: "canonical_divergence", found: "locked_pair", disagreements: ["duration"] };
	}
	const before = lockedPairDivergence(pair, change.toleratedDrift);
	if (before) return before;

	const sourceStart = instantFromDate(period.startTime);
	const sourceEnd = instantFromDate(period.endTime);
	const startAt = change.times?.clockIn?.at ?? sourceStart;
	const endAt = change.times?.clockOut?.at ?? sourceEnd;
	// An adopted recorded correction replaces its endpoint even at the same instant.
	const clockIn =
		change.times?.clockIn?.adopted === true || compareInstants(startAt, sourceStart) !== 0;
	const clockOut =
		change.times?.clockOut?.adopted === true || compareInstants(endAt, sourceEnd) !== 0;
	const decided = change.approval;
	const approval = decided !== undefined && decided !== period.approvalStatus;

	const source = WorkAttribution.fromWorkPeriod(period);
	let attribution: WorkAttribution;
	try {
		attribution = change.attribution ? source.apply(change.attribution) : source;
	} catch (error) {
		if (error instanceof UnrepresentableWorkAttributionError) {
			return { kind: "attribution_unrepresentable", reason: error.reason };
		}
		throw error;
	}
	const parts = attribution.differences(source);
	if (!clockIn && !clockOut && parts.length === 0 && !approval) return { kind: "unchanged" };
	if (compareInstants(endAt, startAt) <= 0) return { kind: "interval_invalid" };

	// New times round their exact elapsed time; attribution or approval alone
	// keeps the stored, possibly historical, minutes.
	const durationMinutes =
		clockIn || clockOut ? workDurationMinutes(arithmetic, startAt, endAt) : period.durationMinutes;
	const result = plannedHalf(
		{ startAt, endAt, durationMinutes },
		attribution,
		canonical.allocations,
		decided === undefined
			? { period: period.approvalStatus, record: canonical.record.approvalState }
			: { period: decided, record: decided },
	);
	const after = recordAgreement(result.period, result.canonical);
	if (!after.agrees) {
		return {
			kind: "canonical_divergence",
			found: "planned_amendment",
			disagreements: after.disagreements,
		};
	}
	return { kind: "amend", changes: { clockIn, clockOut, attribution: parts, approval }, result };
}

/**
 * The locked pair's disagreement as a refusal, or null when it agrees apart
 * from the drift the change tolerates (which it rewrites from the work period).
 */
export function lockedPairDivergence(
	pair: WorkRecordPair,
	toleratedDrift: readonly ToleratedDrift[] = [],
): WorkRecordRefusal | null {
	if (!pair.canonical) return { kind: "canonical_record_missing" };
	const before = recordAgreement(pair.period, pair.canonical);
	const disagreements = before.disagreements.filter(
		(facet) => !(toleratedDrift as readonly string[]).includes(facet),
	);
	return disagreements.length === 0
		? null
		: { kind: "canonical_divergence", found: "locked_pair", disagreements };
}
