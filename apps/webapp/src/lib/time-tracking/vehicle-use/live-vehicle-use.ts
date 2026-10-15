import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { workPeriod } from "@/db/schema";
import { instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { ConflictError, NotFoundError } from "@/lib/effect/errors";
import {
	AMEND_COMPLETED_WORK_COMMAND_VERSION,
	amendCompletedWork,
	lockAuthority,
} from "../amend-completed-work";
import { assertWorkOpen, workInterval } from "../closed-months/store";
import { withCompletedWorkTransaction } from "../completed-work-transaction";
import { sendBackChangedPeriodSubmissions } from "../period-submissions/submission-send-back";
import { assertNoUnresolvedWorkPeriodReview } from "../work-period-review";
import type { SealedWorkTransactionScope } from "../work-transaction";
import {
	sameWorkVehicleUse,
	vehicleUseColumns,
	vehicleUseFromColumns,
	type WorkVehicleUse,
	workVehicleUseIntentOf,
	workVehicleUseRequestValue,
} from "./work-vehicle-use";
import { assertWorkVehicleUseChangeAllowed } from "./work-vehicle-use-eligibility";

function notLive(workPeriodId: string) {
	return new NotFoundError({
		message: "No live work to change",
		entityType: "workPeriod",
		entityId: workPeriodId,
	});
}

/**
 * The employee's own change of their live work's vehicle use while clocked in
 * (#1122, ADR 0009): typically the vehicle or the start reading. It is a live
 * attribution amendment: adopted organizations run the completed-work operation
 * on the active period (receipt, revision, eligibility under its locks); legacy
 * organizations update the active period inside the same coordinated
 * transaction. Either way vehicle use must be asked or expected for the
 * employee, a newly picked vehicle must be pickable, a closed month and work
 * under review refuse, and a submitted period it touches goes back.
 */
export async function changeLiveWorkVehicleUse(input: {
	organizationId: string;
	employeeId: string;
	actorUserId: string;
	workPeriodId: string;
	/** The resulting vehicle use; null removes it. */
	vehicleUse: WorkVehicleUse | null;
}): Promise<void> {
	const { organizationId, employeeId, workPeriodId } = input;
	await withCompletedWorkTransaction(
		{ organizationId, employeeId, actorUserId: input.actorUserId },
		// Typed, so the approval write-boundary scanner sees this live-work write (#1230).
		async (scope: SealedWorkTransactionScope) => {
			const tx = scope.db;
			const [period] = await tx
				.select()
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.id, workPeriodId),
						eq(workPeriod.organizationId, organizationId),
						eq(workPeriod.employeeId, employeeId),
						isNull(workPeriod.deletedAt),
					),
				)
				.limit(1);
			if (!period?.isActive || period.endTime !== null || period.clockOutId !== null) {
				throw notLive(workPeriodId);
			}
			if (scope.admission === "append") {
				await amendCompletedWork(scope, {
					organizationId,
					employeeId,
					actorUserId: input.actorUserId,
					authority: "owner",
					writer: "work_period_attribution_edit",
					command: {
						version: AMEND_COMPLETED_WORK_COMMAND_VERSION,
						operationId: randomUUID(),
						request: {
							workPeriodId,
							vehicleUse: workVehicleUseRequestValue(input.vehicleUse),
						},
					},
					intent: {
						workPeriodId,
						clockIn: { kind: "preserve" },
						clockOut: { kind: "preserve" },
						project: { kind: "preserve" },
						workCategory: { kind: "preserve" },
						workLocation: { kind: "preserve" },
						...workVehicleUseIntentOf(input.vehicleUse),
						notes: null,
					},
					expectedSource: {
						clockInId: period.clockInId,
						clockOutId: null,
						startAt: instantFromDate(period.startTime),
						endAt: null,
					},
					evaluatedAt: systemClock.nowInstant(),
					request: { ipAddress: null, deviceInfo: null },
				});
				return;
			}
			// Legacy: the same authority and checks, under the coordinator's locks.
			await lockAuthority(tx, {
				organizationId,
				employeeId,
				actorUserId: input.actorUserId,
				authority: "owner",
				workPeriodId,
			});
			const [locked] = await tx
				.select()
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.id, workPeriodId),
						eq(workPeriod.organizationId, organizationId),
						eq(workPeriod.employeeId, employeeId),
						isNull(workPeriod.deletedAt),
					),
				)
				.for("update");
			// The same live-work check as before the lock: work closed meanwhile is not live.
			if (!locked?.isActive || locked.endTime !== null || locked.clockOutId !== null) {
				throw notLive(workPeriodId);
			}
			await assertNoUnresolvedWorkPeriodReview(tx, organizationId, locked);
			await assertWorkOpen(tx, {
				organizationId,
				employeeId,
				intervals: [workInterval(locked.startTime, null)],
			});
			const previous = vehicleUseFromColumns(locked);
			if (sameWorkVehicleUse(previous, input.vehicleUse)) {
				throw new ConflictError({
					message: "The vehicle use is unchanged",
					conflictType: "vehicle_use_unchanged",
				});
			}
			await assertWorkVehicleUseChangeAllowed(tx, {
				organizationId,
				employeeId,
				previous,
				resulting: input.vehicleUse,
			});
			// Explicit columns: the approval write-boundary scanner reads them.
			const columns = vehicleUseColumns(input.vehicleUse);
			await tx
				.update(workPeriod)
				.set({
					vehicleKind: columns.vehicleKind,
					vehicleId: columns.vehicleId,
					odometerStartKm: columns.odometerStartKm,
					odometerEndKm: columns.odometerEndKm,
					drivenDistanceKm: columns.drivenDistanceKm,
					updatedAt: new Date(),
				})
				// Live work only (Time Tracking ADR 0010): ended work is work records'.
				.where(
					and(
						eq(workPeriod.id, workPeriodId),
						eq(workPeriod.organizationId, organizationId),
						eq(workPeriod.employeeId, employeeId),
						eq(workPeriod.isActive, true),
						isNull(workPeriod.endTime),
					),
				);
			await sendBackChangedPeriodSubmissions(tx, {
				organizationId,
				employeeId,
				causedByUserId: input.actorUserId,
				work: [workInterval(locked.startTime, null)],
			});
		},
	);
}
