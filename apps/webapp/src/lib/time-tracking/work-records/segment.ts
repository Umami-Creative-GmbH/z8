/**
 * The shared receipt shape of one completed work segment (ADR 0010): committed
 * evidence by value, not a pointer to current rows. Every work records
 * operation reports the segments it read and wrote in this shape, and callers
 * build their receipts from it. Its JSON is the shape receipts committed since
 * #304 carry (split, automatic break and policy clock-out break segments), so
 * earlier receipts keep reading the same. No I/O, no server-only imports.
 */
import { type Instant, instantToCanonicalString } from "@/lib/datetime/temporal-core";
import type { AllocationEvidence } from "../allocation-evidence";
import { recordedTaskId } from "../task-attribution";
import type { WorkVehicleUse } from "../vehicle-use/work-vehicle-use";
import type { CanonicalAllocationShape, WorkAttribution } from "./work-attribution";

export type WorkSegment = {
	workPeriodId: string;
	canonicalRecordId: string;
	clockInEntryId: string;
	clockOutEntryId: string;
	startAt: string;
	endAt: string;
	durationMinutes: number;
	startUtcOffsetMinutes: number | null;
	endUtcOffsetMinutes: number | null;
	attribution: {
		projectId: string | null;
		/** Present only when the work is booked to a task (#873). */
		taskId?: string;
		/** Absent on receipts committed before billability (#900), which were non-billable. */
		isBillable?: boolean;
		workCategoryId: string | null;
		workLocationType: string | null;
		allocations: AllocationEvidence[];
		/** The segment's own vehicle use (#1126); present only when it has one. */
		vehicleUse?: WorkVehicleUse;
	};
};

type SegmentEntry = { id: string; utcOffsetMinutes: number | null };

export function workSegment(values: {
	workPeriodId: string;
	canonicalRecordId: string;
	clockIn: SegmentEntry;
	clockOut: SegmentEntry;
	startAt: Instant;
	endAt: Instant;
	durationMinutes: number;
	attribution: WorkAttribution;
	allocations: readonly CanonicalAllocationShape[];
}): WorkSegment {
	const columns = values.attribution.workPeriodColumns();
	const attribution: WorkSegment["attribution"] = {
		projectId: columns.projectId,
		...recordedTaskId(columns.taskId),
		isBillable: columns.isBillable,
		workCategoryId: columns.workCategoryId,
		workLocationType: columns.workLocationType,
		allocations: values.allocations.map((allocation) => ({
			allocationKind: allocation.allocationKind,
			projectId: allocation.projectId,
			...recordedTaskId(allocation.taskId),
			costCenterId: allocation.costCenterId,
			weightPercent: allocation.weightPercent,
			isBillable: allocation.isBillable,
		})),
	};
	const vehicleUse = values.attribution.vehicleUse;
	return {
		workPeriodId: values.workPeriodId,
		canonicalRecordId: values.canonicalRecordId,
		clockInEntryId: values.clockIn.id,
		clockOutEntryId: values.clockOut.id,
		startAt: instantToCanonicalString(values.startAt),
		endAt: instantToCanonicalString(values.endAt),
		durationMinutes: values.durationMinutes,
		startUtcOffsetMinutes: values.clockIn.utcOffsetMinutes ?? null,
		endUtcOffsetMinutes: values.clockOut.utcOffsetMinutes ?? null,
		// Vehicle use only when there is one, keeping earlier receipts' shape (#1126).
		attribution: vehicleUse ? { ...attribution, vehicleUse } : attribution,
	};
}
