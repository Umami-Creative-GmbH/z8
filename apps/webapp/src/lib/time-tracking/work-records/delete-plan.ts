/**
 * The plan step of a deletion (ADR 0010, #1227): from the locked pair and the
 * instants of the deletion's markers, the zero-length sentinel both records
 * keep. Pure, no I/O, no server-only imports.
 */
import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";
import type { ToleratedDrift } from "./amend-change";
import type { WorkRecordRefusal } from "./change";
import { agreeingPair, plannedPairsRefusal } from "./pair-agreement";
import { type PlannedHalf, plannedHalf, type WorkRecordPair } from "./plan";
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
	const locked = agreeingPair(pair, markers.toleratedDrift);
	if ("kind" in locked) return locked;
	const { period, canonical } = locked;
	if (compareInstants(markers.clockInAt, markers.clockOutAt) !== 0) {
		return { kind: "interval_invalid" };
	}
	const sentinel = plannedHalf(
		{ startAt: markers.clockInAt, endAt: markers.clockOutAt, durationMinutes: 0 },
		WorkAttribution.fromWorkPeriod(period),
		canonical.allocations,
		{ period: period.approvalStatus, record: canonical.record.approvalState },
	);
	return plannedPairsRefusal([sentinel], "planned_amendment") ?? { kind: "delete", sentinel };
}
