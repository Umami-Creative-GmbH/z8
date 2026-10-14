/**
 * The plan step of a deletion (ADR 0010, #1227): from the locked pair and the
 * instants of the deletion's markers, the zero-length sentinel both records
 * keep. Pure, no I/O, no server-only imports.
 */
import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";
import type { ToleratedDrift } from "./amend-change";
import { lockedPairDivergence } from "./amend-plan";
import type { WorkRecordRefusal } from "./change";
import { type PlannedHalf, plannedHalf, type WorkRecordPair } from "./plan";
import { recordAgreement } from "./record-agreement";
import { WorkAttribution } from "./work-attribution";

export type DeletionPlan = {
	kind: "delete";
	/** What both records keep: zero minutes at the markers' instant, the attribution and approval as they were. */
	sentinel: PlannedHalf;
};

export function planDeletion(
	pair: WorkRecordPair,
	markers: { clockInAt: Instant; clockOutAt: Instant; toleratedDrift?: readonly ToleratedDrift[] },
): DeletionPlan | WorkRecordRefusal {
	const { period, canonical } = pair;
	if (period.endTime === null) return { kind: "work_running" };
	if (!canonical) return { kind: "canonical_record_missing" };
	if (period.durationMinutes === null) {
		return { kind: "canonical_divergence", found: "locked_pair", disagreements: ["duration"] };
	}
	const before = lockedPairDivergence(pair, markers.toleratedDrift);
	if (before) return before;
	if (compareInstants(markers.clockInAt, markers.clockOutAt) !== 0) {
		return { kind: "interval_invalid" };
	}
	const sentinel = plannedHalf(
		{ startAt: markers.clockInAt, endAt: markers.clockOutAt, durationMinutes: 0 },
		WorkAttribution.fromWorkPeriod(period),
		canonical.allocations,
		{ period: period.approvalStatus, record: canonical.record.approvalState },
	);
	const after = recordAgreement(sentinel.period, sentinel.canonical);
	if (!after.agrees) {
		return {
			kind: "canonical_divergence",
			found: "planned_amendment",
			disagreements: after.disagreements,
		};
	}
	return { kind: "delete", sentinel };
}
