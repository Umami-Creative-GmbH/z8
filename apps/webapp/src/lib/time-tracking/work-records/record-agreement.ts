/**
 * Record agreement (Time Tracking glossary; ADR 0010): a completed work period
 * and its canonical work record match on interval, duration, approval state and
 * the full work attribution, including the project allocation's project, task,
 * weight and billable flag. This is the one rule every writer and work
 * diagnostics use. An internal seam of work records: pure, no I/O.
 *
 * Rows come straight from the database; their `Date` instants are converted to
 * Temporal here, at that boundary.
 */
import { instantFromDate } from "@/lib/datetime/temporal-core";
import {
	type CanonicalAllocationShape,
	type CanonicalWorkDetailColumns,
	WHOLE_ALLOCATION_WEIGHT,
	WorkAttribution,
	type WorkAttributionPart,
	type WorkPeriodAttributionColumns,
} from "./work-attribution";

/** The work period columns the rule compares. */
export type AgreementWorkPeriod = WorkPeriodAttributionColumns & {
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
	approvalStatus: "pending" | "approved" | "rejected";
};

/** The canonical work record columns the rule compares: base record, detail and allocations. */
export type AgreementCanonicalRecord = {
	record: {
		startAt: Date;
		endAt: Date | null;
		durationMinutes: number | null;
		approvalState: "draft" | "pending" | "approved" | "rejected";
	};
	detail: CanonicalWorkDetailColumns;
	allocations: readonly CanonicalAllocationShape[];
};

/**
 * One way the pair can disagree. `allocation_weight` means the canonical record
 * does not book its project as exactly one whole (weight 100) project allocation.
 */
export type RecordAgreementFacet =
	| "interval"
	| "duration"
	| "approval_state"
	| WorkAttributionPart
	| "allocation_weight";

/** Every facet, in the order `recordAgreement` reports them. */
export const RECORD_AGREEMENT_FACETS = [
	"interval",
	"duration",
	"approval_state",
	"project",
	"task",
	"billable",
	"allocation_weight",
	"work_category",
	"work_location",
	"vehicle_use",
] as const satisfies readonly RecordAgreementFacet[];

export type RecordAgreement =
	| { agrees: true; disagreements: [] }
	| { agrees: false; disagreements: RecordAgreementFacet[] };

/** Whether a work period and its canonical work record agree, and on which facets they do not. */
export function recordAgreement(
	period: AgreementWorkPeriod,
	canonical: AgreementCanonicalRecord,
): RecordAgreement {
	const found = new Set<RecordAgreementFacet>();
	const { record } = canonical;
	if (
		!sameInstant(period.startTime, record.startAt) ||
		!sameInstant(period.endTime, record.endAt)
	) {
		found.add("interval");
	}
	if (period.durationMinutes !== record.durationMinutes) found.add("duration");
	if (period.approvalStatus !== record.approvalState) found.add("approval_state");
	const projectAllocations = canonical.allocations.filter(
		({ allocationKind }) => allocationKind === "project",
	);
	if (
		projectAllocations.length > 1 ||
		projectAllocations.some(({ weightPercent }) => weightPercent !== WHOLE_ALLOCATION_WEIGHT)
	) {
		found.add("allocation_weight");
	}
	const parts = WorkAttribution.fromWorkPeriod(period).differences(
		WorkAttribution.fromCanonical(canonical.detail, canonical.allocations),
	);
	for (const part of parts) found.add(part);

	const disagreements = RECORD_AGREEMENT_FACETS.filter((facet) => found.has(facet));
	return disagreements.length === 0
		? { agrees: true, disagreements: [] }
		: { agrees: false, disagreements };
}

function sameInstant(left: Date | null, right: Date | null): boolean {
	if (left === null || right === null) return left === right;
	return instantFromDate(left).equals(instantFromDate(right));
}
