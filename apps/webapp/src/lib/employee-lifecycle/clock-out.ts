import { and, eq, isNull } from "drizzle-orm";
import { organization } from "@/db/auth-schema";
import { employee, userSettings, workPeriod } from "@/db/schema";
import { employeeDepartureTask } from "@/db/schema/employee-lifecycle";
import {
	compareInstants,
	dateFromInstant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { createClocking } from "@/lib/time-tracking/clocking/clocking";
import { type ClosedLiveWork, durableFollowUps } from "@/lib/time-tracking/clocking/follow-ups";
import { enlistedTransactions } from "@/lib/time-tracking/clocking/transactions";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import type { DepartureClockOutPort } from "./types";

const logger = createLogger("EmployeeDepartureClockOut");

type CloseInput = Parameters<DepartureClockOutPort["close"]>[0];

/**
 * The durable `clock_postprocess` task, staged in the departure's transaction so
 * it commits with the closure (#476 decision 14). Its handler runs the shared
 * clock-out follow-up effects (`clock-postprocess.ts`).
 */
async function stageClockPostprocess(input: CloseInput, closure: ClosedLiveWork) {
	await input.scope.db
		.insert(employeeDepartureTask)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			employmentPeriodId: input.employmentPeriodId,
			departureId: input.departureId,
			kind: "clock_postprocess",
			dedupeKey: `clock-postprocess:${input.clockOutActionId}`,
			payload: {
				workPeriodId: closure.workPeriodId,
				durationMinutes: closure.durationMinutes,
				periodStartedAt: dateFromInstant(closure.start).toISOString(),
				timezone: closure.timezone,
				createdBy: closure.actorUserId,
				surchargeSnapshot: closure.surchargeSnapshot,
				projectId: closure.projectId,
				balanceRefreshCommitted: closure.balanceRefreshCommitted,
			},
		})
		.onConflictDoNothing();
}

/**
 * Closes the target's running work period at the departure cutoff through the
 * Clocking module (#485), enlisted in the departure's work transaction: the
 * admission's writer (the append writer in adopted organizations), the canonical
 * work record, and the departure's stable action ID as a derived identity, so a
 * retry replays instead of writing a second entry. The capture uses the target's
 * own effective timezone, never the admin's or the worker's. A period that began
 * after the cutoff is left untouched and reported for repair rather than closed
 * with a negative duration. The follow-ups are staged as durable work.
 */
export function createDepartureClockOut(): DepartureClockOutPort {
	return {
		async close(input) {
			const { scope } = input;
			const tx = scope.db;
			const [period] = await tx
				.select({ id: workPeriod.id, startTime: workPeriod.startTime })
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.organizationId, input.organizationId),
						eq(workPeriod.employeeId, input.employeeId),
						eq(workPeriod.isActive, true),
						isNull(workPeriod.endTime),
						isNull(workPeriod.deletedAt),
					),
				)
				.limit(1);
			if (!period) return { kind: "not_running" };
			if (compareInstants(instantFromDate(period.startTime), input.cutoff) > 0) {
				return {
					kind: "repair_required",
					workPeriodId: period.id,
					reason: "period_starts_after_cutoff",
				};
			}

			const [zones] = await tx
				.select({
					userTimezone: userSettings.timezone,
					organizationTimezone: organization.timezone,
				})
				.from(employee)
				.innerJoin(organization, eq(organization.id, employee.organizationId))
				.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
				.where(
					and(eq(employee.organizationId, input.organizationId), eq(employee.id, input.employeeId)),
				)
				.limit(1);

			const clocking = createClocking({
				clock: systemClock,
				transactions: enlistedTransactions(scope, {
					organizationId: input.organizationId,
					employeeId: input.employeeId,
					departureId: input.departureId,
				}),
				followUps: durableFollowUps((closure) => stageClockPostprocess(input, closure)),
			});
			const outcome = await clocking.run({
				organizationId: input.organizationId,
				principal: { kind: "departure", departureId: input.departureId, userId: input.actorUserId },
				subject: { employeeId: input.employeeId },
				identity: { origin: "derived", id: input.clockOutActionId },
				channel: "employee-offboarding",
				at: { kind: "occurred", instant: input.cutoff },
				zone: {
					device: null,
					fallback: resolveEffectiveTimezone(zones?.userTimezone, zones?.organizationTimezone),
				},
				body: {
					kind: "clock_out",
					target: { kind: "period", workPeriodId: period.id },
					project: { kind: "preserve" },
					workCategory: { kind: "preserve" },
				},
			});
			if (outcome.outcome !== "refused") {
				return { kind: "closed", workPeriodId: period.id, clockOutEntryId: outcome.result.id };
			}
			const { failure } = outcome;
			// The closure may be written into this transaction: the caller's savepoint
			// rolls it back and records the repair.
			if (failure.code === "unconfirmed") {
				throw failure.cause ?? new Error("Departure clock-out unconfirmed");
			}
			// Every other refusal wrote nothing.
			logger.warn(
				{ departureId: input.departureId, organizationId: input.organizationId, failure },
				"Departure clock-out refused",
			);
			return { kind: "repair_required", workPeriodId: period.id, reason: "clock_out_failed" };
		},
	};
}
