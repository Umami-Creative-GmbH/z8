/**
 * The plan step of attach and repair (ADR 0010, #1226): from the locked work
 * period, whatever canonical work record it has, and a resolution, what both
 * records hold afterwards. Pure, no I/O, no server-only imports.
 *
 * The work period is the base: its endpoints mirror hashed entries, so the
 * repaired interval is always the period's (or, for work whose period never
 * recorded an end, its clock-out entry's instant). The canonical side follows.
 * The planned pair must agree; anything else refuses as `canonical_divergence`
 * found in the `planned_repair`.
 */
import { compareInstants, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import type { WorkRecordRefusal } from "./change";
import { plannedPairsRefusal } from "./pair-agreement";
import { type PlannedHalf, plannedHalf } from "./plan";
import type { AgreementWorkPeriod, RecordAgreementFacet } from "./record-agreement";
import { diagnoseRecordAgreement, type StoredCanonicalRecord } from "./record-agreement-diagnosis";
import {
	type CanonicalAllocationShape,
	UnrepresentableWorkAttributionError,
	WorkAttribution,
	type WorkAttributionPatch,
} from "./work-attribution";

export type PlannableRepair = {
	durationMinutes?: number;
	startAt?: Instant;
	endAt?: Instant;
	attribution?: WorkAttributionPatch;
};

/** The agreement facets a resolution names; only those may disagree in the stored pair. */
function resolvedFacets(resolution: PlannableRepair): Set<RecordAgreementFacet> {
	const facets = new Set<RecordAgreementFacet>();
	if (resolution.durationMinutes !== undefined) facets.add("duration");
	if (resolution.startAt !== undefined || resolution.endAt !== undefined) facets.add("interval");
	const patch = resolution.attribution ?? {};
	if (patch.project !== undefined) {
		for (const facet of ["project", "task", "billable", "allocation_weight"] as const) {
			facets.add(facet);
		}
	}
	// The missing-task marker is part of the task facet (#884).
	if (patch.task !== undefined || patch.missingTask !== undefined) facets.add("task");
	if (patch.billable !== undefined) facets.add("billable");
	if (patch.workCategoryId !== undefined) facets.add("work_category");
	if (patch.workLocationType !== undefined) facets.add("work_location");
	if (patch.vehicleUse !== undefined) facets.add("vehicle_use");
	return facets;
}

export type RepairPlan = {
	/** The repaired work: its interval, minutes, attribution and both representations. */
	result: PlannedHalf;
	/** The facets on which the stored pair disagreed, empty for a missing record. */
	disagreements: RecordAgreementFacet[];
};

type StoredPeriod = AgreementWorkPeriod;

/**
 * Attach: the canonical work record the completed work period describes, with
 * the resolution's minutes and attribution where the period cannot be
 * represented as it stands (no minutes, billable or task work without a
 * project). Both records then hold what the resolution names.
 */
export function planAttachment(
	period: StoredPeriod,
	resolution: PlannableRepair = {},
): RepairPlan | WorkRecordRefusal {
	return planned(period, null, resolution);
}

/**
 * Repair: the pair written to the resolution. A facet the stored pair disagrees
 * on must be named by the resolution; `unchanged` when the stored pair already
 * agrees on it and nothing is missing.
 */
export function planRepair(
	period: StoredPeriod,
	canonical: StoredCanonicalRecord & { linked: boolean },
	resolution: PlannableRepair,
): RepairPlan | WorkRecordRefusal {
	const before = diagnoseRecordAgreement(period, canonical);
	const named = resolvedFacets(resolution);
	const unresolved = [
		...before.disagreements,
		// A canonical side that cannot be represented needs its project resolved.
		...(before.unrepresentable.some(({ side }) => side === "canonical")
			? (["project"] as const)
			: []),
	].filter((facet) => !named.has(facet));
	if (unresolved.length > 0) {
		return {
			kind: "canonical_divergence",
			found: "locked_pair",
			disagreements: [...new Set(unresolved)],
		};
	}
	const plan = planned(period, canonical, resolution);
	if ("kind" in plan) return plan;
	const periodStays =
		period.endTime !== null &&
		instantFromDate(period.endTime).equals(plan.result.endAt) &&
		period.durationMinutes === plan.result.durationMinutes &&
		WorkAttribution.fromWorkPeriod(period).equals(plan.result.attribution);
	if (canonical.linked && canonical.detail !== null && before.agrees && periodStays) {
		return { kind: "unchanged" };
	}
	return { ...plan, disagreements: before.disagreements };
}

function planned(
	period: StoredPeriod,
	canonical: StoredCanonicalRecord | null,
	resolution: PlannableRepair,
): RepairPlan | WorkRecordRefusal {
	const endAt = period.endTime ? instantFromDate(period.endTime) : resolution.endAt;
	if (!endAt) return { kind: "work_running" };
	const startAt = instantFromDate(period.startTime);
	// A repair never moves an endpoint: a named instant must be the period's own.
	if (
		compareInstants(endAt, startAt) <= 0 ||
		(resolution.startAt && compareInstants(resolution.startAt, startAt) !== 0) ||
		(resolution.endAt && compareInstants(resolution.endAt, endAt) !== 0)
	) {
		return { kind: "interval_invalid" };
	}
	const durationMinutes = resolution.durationMinutes ?? period.durationMinutes;
	if (durationMinutes === null) {
		return { kind: "canonical_divergence", found: "planned_repair", disagreements: ["duration"] };
	}
	let attribution: WorkAttribution;
	try {
		const base = WorkAttribution.fromWorkPeriod(period);
		attribution = resolution.attribution ? base.apply(resolution.attribution) : base;
	} catch (error) {
		if (error instanceof UnrepresentableWorkAttributionError) {
			return { kind: "attribution_unrepresentable", reason: error.reason };
		}
		throw error;
	}
	const allocations: readonly CanonicalAllocationShape[] = canonical?.allocations ?? [];
	const result = plannedHalf({ startAt, endAt, durationMinutes }, attribution, allocations, {
		period: period.approvalStatus,
		// An attached record takes the period's approval state; a repair never decides one.
		record: canonical?.record.approvalState ?? period.approvalStatus,
	});
	return plannedPairsRefusal([result], "planned_repair") ?? { result, disagreements: [] };
}
