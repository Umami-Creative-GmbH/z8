"use server";

import { and, eq, gte, lte } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { workPeriod } from "@/db/schema";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import {
	type BreakEnforcementResult,
	BreakEnforcementService,
	BreakEnforcementServiceLive,
} from "@/lib/effect/services/break-enforcement.service";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { SurchargeService, SurchargeServiceLive } from "@/lib/effect/services/surcharge.service";
import {
	type ComplianceWarning,
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";
import { getTodayRangeInTimezone } from "@/lib/time-tracking/timezone-utils";
import { getTimeSummary } from "./queries";
import { logger } from "./shared";

export async function calculateBreaksTakenToday(
	employeeId: string,
	timezone: string = "UTC",
): Promise<number> {
	const { start: todayStartDateTime, end: todayEndDateTime } = getTodayRangeInTimezone(timezone);
	const todayStart = dateToDB(todayStartDateTime)!;
	const todayEnd = dateToDB(todayEndDateTime)!;

	const workPeriods = await db.query.workPeriod.findMany({
		where: and(
			eq(workPeriod.employeeId, employeeId),
			gte(workPeriod.startTime, todayStart),
			lte(workPeriod.startTime, todayEnd),
		),
		orderBy: [workPeriod.startTime],
	});

	let totalBreakMinutes = 0;

	for (let index = 0; index < workPeriods.length - 1; index += 1) {
		const currentEnd = workPeriods[index].endTime;
		const nextStart = workPeriods[index + 1].startTime;

		if (currentEnd && nextStart) {
			const gapMinutes = Math.floor((nextStart.getTime() - currentEnd.getTime()) / 60_000);
			if (gapMinutes > 1) {
				totalBreakMinutes += gapMinutes;
			}
		}
	}

	return totalBreakMinutes;
}

export async function checkComplianceAfterClockOut(
	employeeId: string,
	organizationId: string,
	workPeriodId: string,
	currentSessionMinutes: number,
	timezone: string = "UTC",
): Promise<ComplianceWarning[]> {
	try {
		const [timeSummary, breaksTaken] = await Promise.all([
			getTimeSummary(employeeId, timezone),
			calculateBreaksTakenToday(employeeId, timezone),
		]);

		const complianceEffect = Effect.gen(function* (_) {
			const workPolicyService = yield* _(WorkPolicyService);
			const result = yield* _(
				workPolicyService.checkCompliance({
					employeeId,
					currentSessionMinutes,
					totalDailyMinutes: timeSummary.todayMinutes,
					totalWeeklyMinutes: timeSummary.weekMinutes,
					breaksTakenMinutes: breaksTaken,
				}),
			);

			if (result.warnings.length > 0) {
				const effectivePolicy = yield* _(workPolicyService.getEffectivePolicy(employeeId));
				if (effectivePolicy?.regulation) {
					for (const warning of result.warnings) {
						if (warning.severity === "violation") {
							yield* _(
								workPolicyService.logViolation({
									employeeId,
									organizationId,
									policyId: effectivePolicy.policyId,
									workPeriodId,
									violationType: warning.type,
									details: {
										actualMinutes: warning.actualValue,
										limitMinutes: warning.limitValue,
										warningShownAt: new Date().toISOString(),
										userContinued: true,
									},
								}),
							);
						}
					}
				}
			}

			return result.warnings;
		}).pipe(Effect.provide(WorkPolicyServiceLive), Effect.provide(DatabaseServiceLive));

		return await Effect.runPromise(complianceEffect);
	} catch (error) {
		logger.error({ error }, "Failed to check compliance after clock-out");
		return [];
	}
}

export async function calculateAndPersistSurcharges(
	workPeriodId: string,
	organizationId: string,
): Promise<void> {
	try {
		const surchargeEffect = Effect.gen(function* (_) {
			const surchargeService = yield* _(SurchargeService);
			const isEnabled = yield* _(surchargeService.isSurchargesEnabled(organizationId));

			if (!isEnabled) {
				return;
			}

			yield* _(surchargeService.persistSurchargeCalculation(workPeriodId));
		}).pipe(Effect.provide(SurchargeServiceLive), Effect.provide(DatabaseServiceLive));

		await Effect.runPromise(surchargeEffect);
	} catch (error) {
		logger.error({ error, workPeriodId }, "Failed to calculate surcharges after clock-out");
	}
}

export async function enforceBreaksAfterClockOut(input: {
	employeeId: string;
	organizationId: string;
	workPeriodId: string;
	sessionDurationMinutes: number;
	timezone: string;
	createdBy: string;
}): Promise<BreakEnforcementResult> {
	try {
		const enforcementEffect = Effect.gen(function* (_) {
			const breakService = yield* _(BreakEnforcementService);
			return yield* _(breakService.enforceBreaksAfterClockOut(input));
		}).pipe(
			Effect.provide(BreakEnforcementServiceLive),
			Effect.provide(WorkPolicyServiceLive),
			Effect.provide(DatabaseServiceLive),
		);

		return await Effect.runPromise(enforcementEffect);
	} catch (error) {
		logger.error(
			{ error, workPeriodId: input.workPeriodId },
			"Failed to enforce breaks after clock-out",
		);
		return { wasAdjusted: false };
	}
}
