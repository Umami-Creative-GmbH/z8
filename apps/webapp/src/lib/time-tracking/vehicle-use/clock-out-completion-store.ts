import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { timeRecordWork, workPeriod } from "@/db/schema";
import { compareInstants, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
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
import type { WorkTransactionClient } from "../work-transaction";
import { clockOutCompletionVehicleUse } from "./clock-out-completion";
import type { ClockVehicleUse } from "./clock-vehicle-use";
import {
	sameWorkVehicleUse,
	vehicleUseColumns,
	vehicleUseFromColumns,
	type WorkVehicleUse,
	workVehicleUseIntentOf,
	workVehicleUseRequestValue,
} from "./work-vehicle-use";
import {
	assertWorkVehicleUseChangeAllowed,
	workVehicleUseRefusal,
} from "./work-vehicle-use-eligibility";

/**
 * How long after its clock-out closed work can still be completed (#1125).
 * Later, vehicle use is added as a correction under the change policy.
 */
export const CLOCK_OUT_COMPLETION_HOURS = 12;

function notClosed(workPeriodId: string) {
	return new NotFoundError({
		message: "No closed work to complete",
		entityType: "workPeriod",
		entityId: workPeriodId,
	});
}

function unchanged() {
	return new ConflictError({
		message: "The vehicle use is unchanged",
		conflictType: "vehicle_use_unchanged",
	});
}

function completionClosed() {
	return new ConflictError({
		message: "The clock-out can no longer be completed",
		conflictType: "vehicle_use_completion_closed",
	});
}

/** Legacy: the period and its canonical work detail take the vehicle use together. */
async function writeLegacyVehicleUse(
	db: WorkTransactionClient,
	input: {
		organizationId: string;
		employeeId: string;
		period: { id: string; canonicalRecordId: string | null };
		use: WorkVehicleUse;
	},
) {
	const columns = vehicleUseColumns(input.use);
	await db
		.update(workPeriod)
		.set({
			vehicleKind: columns.vehicleKind,
			vehicleId: columns.vehicleId,
			odometerStartKm: columns.odometerStartKm,
			odometerEndKm: columns.odometerEndKm,
			drivenDistanceKm: columns.drivenDistanceKm,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(workPeriod.id, input.period.id),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
			),
		);
	if (!input.period.canonicalRecordId) return;
	await db
		.update(timeRecordWork)
		.set({
			vehicleKind: columns.vehicleKind,
			vehicleId: columns.vehicleId,
			odometerStartKm: columns.odometerStartKm,
			odometerEndKm: columns.odometerEndKm,
			drivenDistanceKm: columns.drivenDistanceKm,
		})
		.where(
			and(
				eq(timeRecordWork.recordId, input.period.canonicalRecordId),
				eq(timeRecordWork.organizationId, input.organizationId),
			),
		);
}

/**
 * The employee's completion of their own clock-out's vehicle use (#1125): what
 * a client that asks only after the clock command commits (the Teams bot) adds
 * to the work the clock-out closed, within `CLOCK_OUT_COMPLETION_HOURS`. It only
 * fills what the work is missing (`clockOutCompletionVehicleUse`), so it is an
 * attribution change of the owner, like a live vehicle use change: adopted
 * organizations run the completed-work operation (receipt, revision, eligibility
 * under its locks); legacy organizations update the period and its canonical
 * record inside the same coordinated transaction. Vehicle use must be asked or
 * expected, a newly picked vehicle must be pickable, a closed month and work
 * under review refuse, and a submitted period it touches goes back.
 *
 * Refuses with `NotFoundError` when the work is not the employee's closed work,
 * `ConflictError` `vehicle_use_completion_closed` after the window and
 * `vehicle_use_unchanged` when nothing is missing; vehicle use refusals as
 * `workVehicleUseRefusal`.
 */
export async function completeClockOutVehicleUse(input: {
	organizationId: string;
	employeeId: string;
	actorUserId: string;
	workPeriodId: string;
	supplied: ClockVehicleUse;
	now: Instant;
}): Promise<WorkVehicleUse> {
	const { organizationId, employeeId, workPeriodId } = input;
	let completed: WorkVehicleUse | null = null;
	await withCompletedWorkTransaction(
		{ organizationId, employeeId, actorUserId: input.actorUserId },
		async (scope) => {
			const tx = scope.db;
			const selectPeriod = () =>
				tx
					.select()
					.from(workPeriod)
					.where(
						and(
							eq(workPeriod.id, workPeriodId),
							eq(workPeriod.organizationId, organizationId),
							eq(workPeriod.employeeId, employeeId),
							isNull(workPeriod.deletedAt),
						),
					);
			const plan = (period: typeof workPeriod.$inferSelect | undefined) => {
				if (!period || period.endTime === null || period.clockOutId === null) {
					throw notClosed(workPeriodId);
				}
				const deadline = instantFromDate(period.endTime).add({
					hours: CLOCK_OUT_COMPLETION_HOURS,
				});
				if (compareInstants(input.now, deadline) > 0) throw completionClosed();
				const current = vehicleUseFromColumns(period);
				const result = clockOutCompletionVehicleUse(current, input.supplied);
				if (!result.ok) throw workVehicleUseRefusal(result.code);
				if (!result.use) throw workVehicleUseRefusal("invalid_vehicle");
				if (sameWorkVehicleUse(current, result.use)) throw unchanged();
				return { period, current, use: result.use };
			};

			if (scope.admission === "append") {
				const [read] = await selectPeriod().limit(1);
				const { period, use } = plan(read);
				await amendCompletedWork(scope, {
					organizationId,
					employeeId,
					actorUserId: input.actorUserId,
					authority: "owner",
					writer: "work_period_attribution_edit",
					command: {
						version: AMEND_COMPLETED_WORK_COMMAND_VERSION,
						operationId: randomUUID(),
						request: { workPeriodId, vehicleUse: workVehicleUseRequestValue(use) },
					},
					intent: {
						workPeriodId,
						clockIn: { kind: "preserve" },
						clockOut: { kind: "preserve" },
						project: { kind: "preserve" },
						workCategory: { kind: "preserve" },
						workLocation: { kind: "preserve" },
						...workVehicleUseIntentOf(use),
						notes: null,
					},
					expectedSource: {
						clockInId: period.clockInId,
						clockOutId: period.clockOutId,
						startAt: instantFromDate(period.startTime),
						endAt: period.endTime ? instantFromDate(period.endTime) : null,
					},
					evaluatedAt: input.now,
					request: { ipAddress: null, deviceInfo: null },
				});
				completed = use;
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
			const [locked] = await selectPeriod().for("update");
			const { period, current, use } = plan(locked);
			await assertNoUnresolvedWorkPeriodReview(tx, organizationId, period);
			const interval = workInterval(period.startTime, period.endTime);
			await assertWorkOpen(tx, { organizationId, employeeId, intervals: [interval] });
			await assertWorkVehicleUseChangeAllowed(tx, {
				organizationId,
				employeeId,
				previous: current,
				resulting: use,
			});
			await writeLegacyVehicleUse(tx, { organizationId, employeeId, period, use });
			await sendBackChangedPeriodSubmissions(tx, {
				organizationId,
				employeeId,
				causedByUserId: input.actorUserId,
				work: [interval],
			});
			completed = use;
		},
	);
	if (!completed) throw notClosed(workPeriodId);
	return completed;
}
