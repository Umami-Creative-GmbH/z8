import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { workPeriod } from "@/db/schema";
import { compareInstants, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { ConflictError, NotFoundError } from "@/lib/effect/errors";
import {
	AMEND_COMPLETED_WORK_COMMAND_VERSION,
	replayOrAmendCompletedWork,
} from "../amend-completed-work";
import { withCompletedWorkTransaction } from "../completed-work-transaction";
import { clockOutCompletionVehicleUse } from "./clock-out-completion";
import type { ClockVehicleUse } from "./clock-vehicle-use";
import {
	sameWorkVehicleUse,
	vehicleUseFromColumns,
	type WorkVehicleUse,
	workVehicleUseIntentOf,
	workVehicleUseRequestValue,
} from "./work-vehicle-use";
import { workVehicleUseRefusal } from "./work-vehicle-use-eligibility";

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

/**
 * The employee's completion of their own clock-out's vehicle use (#1125): what
 * a client that asks only after the clock command commits (the Teams bot) adds
 * to the work the clock-out closed, within `CLOCK_OUT_COMPLETION_HOURS`. It only
 * fills what the work is missing (`clockOutCompletionVehicleUse`), so it is an
 * attribution change of the owner: the completed-work amendment runs, admission
 * hidden (eligibility under its locks, a receipt where work records appended),
 * and work records changes the work period and its canonical work record with
 * the effects (#1225). Vehicle use must be asked or expected, a newly picked
 * vehicle must be pickable, a closed month and work under review refuse, and a
 * submitted period it touches goes back (ADR 0009).
 *
 * Refuses with `NotFoundError` when the work is not the employee's work closed
 * by `clockOutId`,
 * `ConflictError` `vehicle_use_completion_closed` after the window and
 * `vehicle_use_unchanged` when nothing is missing; vehicle use refusals as
 * `workVehicleUseRefusal`.
 */
export async function completeClockOutVehicleUse(input: {
	organizationId: string;
	employeeId: string;
	actorUserId: string;
	workPeriodId: string;
	/**
	 * The clock-out entry the asking client's clock-out created (#807 decision 7):
	 * only the work that clock-out closed is completed, never work closed
	 * automatically, at departure or on someone's behalf.
	 */
	clockOutId: string;
	supplied: ClockVehicleUse;
	now: Instant;
}): Promise<WorkVehicleUse> {
	const { organizationId, employeeId, workPeriodId } = input;
	return withCompletedWorkTransaction(
		{ organizationId, employeeId, actorUserId: input.actorUserId },
		async (scope) => {
			const [period] = await scope.db
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
			if (
				!period ||
				period.endTime === null ||
				period.clockOutId === null ||
				period.clockOutId !== input.clockOutId
			) {
				throw notClosed(workPeriodId);
			}
			const deadline = instantFromDate(period.endTime).add({ hours: CLOCK_OUT_COMPLETION_HOURS });
			if (compareInstants(input.now, deadline) > 0) throw completionClosed();
			const current = vehicleUseFromColumns(period);
			const result = clockOutCompletionVehicleUse(current, input.supplied);
			if (!result.ok) throw workVehicleUseRefusal(result.code);
			if (!result.use) throw workVehicleUseRefusal("invalid_vehicle");
			if (sameWorkVehicleUse(current, result.use)) throw unchanged();
			const use = result.use;

			// The amendment re-reads the work under its locks: a change since is stale.
			await replayOrAmendCompletedWork(scope, {
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
					endAt: instantFromDate(period.endTime),
				},
				evaluatedAt: input.now,
				request: { ipAddress: null, deviceInfo: null },
			});
			return use;
		},
	);
}
