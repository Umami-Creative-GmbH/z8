/**
 * The plan step of work records (ADR 0010): from the locked pair and the
 * caller's policy, what each resulting work period and canonical work record
 * carries. An internal seam: pure, no I/O, no server-only imports. The writer
 * persists a plan as it is; it never decides what a half carries.
 *
 * Record agreement is checked twice here, with the one rule: on the locked pair
 * before planning, and on every planned half. Either disagreement is a
 * `canonical_divergence` refusal, so nothing is written.
 */
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
} from "@/lib/datetime/temporal-core";
import { splitWorkVehicleUse } from "../vehicle-use/split-vehicle-use";
import { deriveWorkDurationMinutes, WorkIntervalError } from "../work-duration";
import { type AmendmentPlan, type PlannableAmendment, planAmendment } from "./amend-plan";
import type { DivideWorkRecord, DivisionHalf, WorkRecordRefusal } from "./change";
import { agreeingPair, plannedPairsRefusal } from "./pair-agreement";
import type { AgreementCanonicalRecord, AgreementWorkPeriod } from "./record-agreement";
import {
	type CanonicalAllocationShape,
	UnrepresentableWorkAttributionError,
	WorkAttribution,
	type WorkAttributionPatch,
} from "./work-attribution";

/** A completed work period and its canonical work record, as the rule compares them. */
export type WorkRecordPair = {
	period: AgreementWorkPeriod;
	canonical: AgreementCanonicalRecord | null;
};

/** What one resulting work period and its canonical work record will hold. */
export type PlannedHalf = {
	startAt: Instant;
	endAt: Instant;
	durationMinutes: number;
	attribution: WorkAttribution;
	period: AgreementWorkPeriod & { endTime: Date; durationMinutes: number };
	canonical: AgreementCanonicalRecord & { allocations: CanonicalAllocationShape[] };
};

export type DivisionPlan = {
	kind: "divide";
	at: Instant;
	retained: PlannedHalf;
	generated: PlannedHalf;
};

export type WorkRecordPlan = DivisionPlan | AmendmentPlan;

/**
 * The policy part of a division: everything the plan needs besides the locked
 * pair, with an override's project billable default already read.
 */
export type PlannableDivision = Pick<DivideWorkRecord, "kind" | "at" | "odometerKm"> & {
	attribution?: { half: DivisionHalf; patch: WorkAttributionPatch };
};

/** The policy part of a change: everything the plan needs besides the locked pair. */
export type PlannableChange = PlannableDivision | PlannableAmendment;

/**
 * How the admission's writer rounds the minutes of written work: append
 * admission rounds each interval's exact elapsed time half up (#252 §2); legacy
 * admission floors it, as the legacy writers always have. Retiring legacy
 * admission removes `floor`.
 */
export type WorkDurationArithmetic = "half_up" | "floor";

export function workDurationMinutes(
	arithmetic: WorkDurationArithmetic,
	startAt: Instant,
	endAt: Instant,
): number {
	if (arithmetic === "half_up") return deriveWorkDurationMinutes(startAt, endAt);
	if (compareInstants(endAt, startAt) <= 0) throw new WorkIntervalError();
	return Math.floor((endAt.epochMilliseconds - startAt.epochMilliseconds) / 60_000);
}

export function planChange(
	pair: WorkRecordPair,
	change: PlannableDivision,
	arithmetic: WorkDurationArithmetic,
): DivisionPlan | WorkRecordRefusal;
export function planChange(
	pair: WorkRecordPair,
	change: PlannableAmendment,
	arithmetic: WorkDurationArithmetic,
): AmendmentPlan | WorkRecordRefusal;
export function planChange(
	pair: WorkRecordPair,
	change: PlannableChange,
	arithmetic: WorkDurationArithmetic,
): WorkRecordPlan | WorkRecordRefusal {
	switch (change.kind) {
		case "divide":
			return planDivision(pair, change, arithmetic);
		case "amend":
			return planAmendment(pair, change, arithmetic);
	}
}

function planDivision(
	pair: WorkRecordPair,
	change: PlannableDivision,
	arithmetic: WorkDurationArithmetic,
): DivisionPlan | WorkRecordRefusal {
	const locked = agreeingPair(pair);
	if ("kind" in locked) return locked;
	const { period, canonical } = locked;
	const startAt = instantFromDate(period.startTime);
	const endAt = instantFromDate(period.endTime);
	if (compareInstants(change.at, startAt) <= 0 || compareInstants(change.at, endAt) >= 0) {
		return { kind: "instant_outside_work" };
	}
	// Each half rounds its own exact elapsed time.
	const segments = {
		first: {
			startAt,
			endAt: change.at,
			durationMinutes: workDurationMinutes(arithmetic, startAt, change.at),
		},
		second: {
			startAt: change.at,
			endAt,
			durationMinutes: workDurationMinutes(arithmetic, change.at, endAt),
		},
	};

	// The vehicle carries over to both halves; the value at the instant divides the km (#1126).
	const source = WorkAttribution.fromWorkPeriod(period);
	const vehicle = splitWorkVehicleUse(source.vehicleUse, change.odometerKm);
	if (!vehicle.ok) return { kind: "vehicle_use_refused", code: vehicle.code };
	let retained = source.apply({ vehicleUse: vehicle.retained });
	let generated = source.apply({ vehicleUse: vehicle.generated });
	if (change.attribution) {
		const { half, patch } = change.attribution;
		try {
			if (half === "retained") retained = retained.apply(patch);
			else generated = generated.apply(patch);
		} catch (error) {
			if (error instanceof UnrepresentableWorkAttributionError) {
				return { kind: "attribution_unrepresentable", reason: error.reason };
			}
			throw error;
		}
	}

	const approval = { period: period.approvalStatus, record: canonical.record.approvalState };
	const plan: DivisionPlan = {
		kind: "divide",
		at: change.at,
		retained: plannedHalf(segments.first, retained, canonical.allocations, approval),
		generated: plannedHalf(segments.second, generated, canonical.allocations, approval),
	};
	return plannedPairsRefusal([plan.retained, plan.generated], "planned_half") ?? plan;
}

/**
 * One half: its own interval and rounded minutes, the source's approval state
 * (a division never decides approval), and the attribution in both
 * representations. Cost-centre allocations carry over unchanged.
 */
export function plannedHalf(
	segment: { startAt: Instant; endAt: Instant; durationMinutes: number },
	attribution: WorkAttribution,
	sourceAllocations: readonly CanonicalAllocationShape[],
	approval: {
		period: AgreementWorkPeriod["approvalStatus"];
		record: AgreementCanonicalRecord["record"]["approvalState"];
	},
): PlannedHalf {
	const startTime = dateFromInstant(segment.startAt);
	const endTime = dateFromInstant(segment.endAt);
	return {
		...segment,
		attribution,
		period: {
			startTime,
			endTime,
			durationMinutes: segment.durationMinutes,
			approvalStatus: approval.period,
			...attribution.workPeriodColumns(),
		},
		canonical: {
			record: {
				startAt: startTime,
				endAt: endTime,
				durationMinutes: segment.durationMinutes,
				approvalState: approval.record,
			},
			detail: attribution.canonicalDetail(),
			allocations: attribution.canonicalAllocations(sourceAllocations.map(allocationShape)),
		},
	};
}

function allocationShape(allocation: CanonicalAllocationShape): CanonicalAllocationShape {
	return {
		allocationKind: allocation.allocationKind,
		projectId: allocation.projectId,
		taskId: allocation.taskId,
		costCenterId: allocation.costCenterId,
		weightPercent: allocation.weightPercent,
		isBillable: allocation.isBillable,
		missingTask: allocation.missingTask,
	};
}
