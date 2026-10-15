import "server-only";

/**
 * An open canonical work record: one some history gave live work before work
 * records created the record when the work completes (#1222). Live work itself
 * is Clocking's (ADR 0002); its canonical work record is work records' (ADR
 * 0010). An approved correction of the live work moves the record's start and
 * takes the corrected work category, work location and vehicle use (#1230),
 * compare-and-set on what the decision read under its locks. The caller turns
 * an unmatched row into its own conflict.
 */
import { and, eq, isNull } from "drizzle-orm";
import { timeRecord, timeRecordWork } from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import type { WorkVehicleUseColumns } from "../vehicle-use/work-vehicle-use";
import { vehicleColumnsMatch } from "../vehicle-use/work-vehicle-use-sql";
import type { SealedWorkTransactionScope } from "../work-transaction";

type WorkLocation = (typeof timeRecordWork.$inferSelect)["workLocationType"];

export type OpenWorkRecordCorrection = {
	organizationId: string;
	employeeId: string;
	actorUserId: string;
	at: Instant;
	/** The corrected start of the open record, read with its start and approval state. */
	start?: {
		recordId: string;
		expected: {
			startAt: Instant;
			approvalState: (typeof timeRecord.$inferSelect)["approvalState"];
		};
		startAt: Instant;
	};
	/** The corrected detail, read with its category and location (and vehicle use when it changes). */
	detail?: {
		recordId: string;
		expected: { workLocationType: WorkLocation; workCategoryId: string | null };
		workLocationType: WorkLocation;
		workCategoryId: string | null;
		vehicle?: { expected: WorkVehicleUseColumns; applied: WorkVehicleUseColumns };
	};
};

/**
 * Which named parts matched exactly their one row; nothing else is written.
 * Runs on a sealed work-transaction scope only; the Approvals finalizer's
 * handle becomes one through `workRecordScopeForFinalizer`.
 */
export async function correctOpenWorkRecord(
	scope: SealedWorkTransactionScope,
	correction: OpenWorkRecordCorrection,
): Promise<{ start: boolean; detail: boolean }> {
	const { organizationId, employeeId, start, detail } = correction;
	scope.assertEmployee(organizationId, employeeId);
	const tx = scope.db;
	let startMatched = true;
	if (start) {
		const updated = await tx
			.update(timeRecord)
			.set({
				startAt: dateFromInstant(start.startAt),
				updatedAt: dateFromInstant(correction.at),
				updatedBy: correction.actorUserId,
			})
			.where(
				and(
					eq(timeRecord.id, start.recordId),
					eq(timeRecord.organizationId, organizationId),
					eq(timeRecord.employeeId, employeeId),
					eq(timeRecord.recordKind, "work"),
					eq(timeRecord.startAt, dateFromInstant(start.expected.startAt)),
					isNull(timeRecord.endAt),
					eq(timeRecord.approvalState, start.expected.approvalState),
				),
			)
			.returning({ id: timeRecord.id });
		startMatched = updated.length === 1 && updated[0]?.id === start.recordId;
	}
	let detailMatched = true;
	if (detail) {
		const vehicle = detail.vehicle?.applied;
		const updated = await tx
			.update(timeRecordWork)
			.set({
				workLocationType: detail.workLocationType,
				workCategoryId: detail.workCategoryId,
				...(vehicle
					? {
							vehicleKind: vehicle.vehicleKind,
							vehicleId: vehicle.vehicleId,
							odometerStartKm: vehicle.odometerStartKm,
							odometerEndKm: vehicle.odometerEndKm,
							drivenDistanceKm: vehicle.drivenDistanceKm,
						}
					: {}),
			})
			.where(
				and(
					eq(timeRecordWork.recordId, detail.recordId),
					eq(timeRecordWork.organizationId, organizationId),
					eq(timeRecordWork.recordKind, "work"),
					detail.expected.workLocationType === null
						? isNull(timeRecordWork.workLocationType)
						: eq(timeRecordWork.workLocationType, detail.expected.workLocationType),
					detail.expected.workCategoryId === null
						? isNull(timeRecordWork.workCategoryId)
						: eq(timeRecordWork.workCategoryId, detail.expected.workCategoryId),
					...(detail.vehicle ? vehicleColumnsMatch(timeRecordWork, detail.vehicle.expected) : []),
				),
			)
			.returning({ recordId: timeRecordWork.recordId });
		detailMatched = updated.length === 1 && updated[0]?.recordId === detail.recordId;
	}
	return { start: startMatched, detail: detailMatched };
}
