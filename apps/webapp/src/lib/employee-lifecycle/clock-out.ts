import { and, eq, isNull } from "drizzle-orm";
import { organization } from "@/db/auth-schema";
import { employee, userSettings, workPeriod } from "@/db/schema";
import { compareInstants, dateFromInstant, instantFromDate } from "@/lib/datetime/temporal-core";
import {
	ClockingAppendAdoptedError,
	type ClockingTransaction,
	createClockingService,
	createDatabaseClockingStore,
} from "@/lib/time-tracking/clocking-core";
import { resolvePolicyClockOutSurchargeSnapshotInTransaction } from "@/lib/time-tracking/policy-clock-out-surcharge-snapshot";
import type { PolicyClockOutSurchargeSnapshot } from "@/lib/time-tracking/policy-clock-out-surcharge-snapshot.types";
import { resolveFallbackTimezoneCapture } from "@/lib/time-tracking/timezone-capture";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import type { DepartureClockOutPort } from "./types";

// Only the caller-owned lifecycle transaction is accepted: the departure,
// its clock-out and its follow-up intent commit or roll back together.
const canonicalClocking = createClockingService({
	transaction: () => {
		throw new Error("departure_clock_out_requires_lifecycle_transaction");
	},
	storeForTransaction: (transaction) =>
		createDatabaseClockingStore(transaction as ClockingTransaction),
});

/**
 * Closes the target's running work period at the departure cutoff through the
 * canonical clocking core: guarded close, hash chain and the departure's
 * stable action ID, so a retry replays instead of writing a second entry.
 * The capture uses the target's own effective timezone, never the admin's or
 * the worker's. A period that began after the cutoff is left untouched and
 * reported for repair rather than closed with a negative duration.
 */
export function createDepartureClockOut(): DepartureClockOutPort {
	return {
		async close(input) {
			const tx = input.transaction;
			const [period] = await tx
				.select({
					id: workPeriod.id,
					startTime: workPeriod.startTime,
					projectId: workPeriod.projectId,
					workCategoryId: workPeriod.workCategoryId,
				})
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
			const cutoffDate = dateFromInstant(input.cutoff);
			const capture = resolveFallbackTimezoneCapture({
				timestamp: cutoffDate,
				timezone: resolveEffectiveTimezone(zones?.userTimezone, zones?.organizationTimezone),
				timezoneSource: "manager_target_user_setting",
			});

			let surchargeSnapshot: PolicyClockOutSurchargeSnapshot | null = null;
			let closed: Awaited<ReturnType<typeof canonicalClocking.clockOut>>;
			try {
				closed = await canonicalClocking.clockOut({
					employeeId: input.employeeId,
					organizationId: input.organizationId,
					createdBy: input.actorUserId,
					actionId: input.clockOutActionId,
					workPeriodId: period.id,
					transaction: tx,
					action: { instant: input.cutoff, ...capture },
					source: { ipAddress: null, deviceInfo: "employee-offboarding" },
					notes: `Employee departure ${input.departureId}`,
					projectId: period.projectId,
					workCategoryId: period.workCategoryId,
					beforePeriodClose: async ({ transaction, activePeriod }) => {
						surchargeSnapshot = await resolvePolicyClockOutSurchargeSnapshotInTransaction({
							dbService: { db: transaction as ClockingTransaction },
							organizationId: input.organizationId,
							employeeId: input.employeeId,
							startTime: instantFromDate(activePeriod.startTime),
							endTime: input.cutoff,
						});
						return undefined;
					},
				});
			} catch (error) {
				// Adopted organizations accept only coordinated writers (#327). Nothing
				// was written: the period stays open for the canonical correction flow
				// and the departure records a timer repair with its own reason.
				if (error instanceof ClockingAppendAdoptedError) {
					return { kind: "repair_required", workPeriodId: period.id, reason: "append_adopted" };
				}
				throw error;
			}

			return {
				kind: "closed",
				workPeriodId: period.id,
				clockOutEntryId: closed.entry.id,
				postprocess: {
					durationMinutes: closed.durationMinutes,
					periodStartedAt: closed.activePeriod.startTime.toISOString(),
					timezone: capture.timezone,
					createdBy: input.actorUserId,
					surchargeSnapshot,
				},
			};
		},
	};
}
