import "server-only";

// Post-clock-out maintenance for callers that have already authorized the
// employee (#443): not server actions, so a client cannot run it for any ID.

import { and, eq, gte, lte } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { workPeriod } from "@/db/schema";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import type { Instant } from "@/lib/datetime/temporal-core";
import {
	type BreakEnforcementResult,
	BreakEnforcementService,
	BreakEnforcementServiceLive,
} from "@/lib/effect/services/break-enforcement.service";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	calculateSurchargeForWorkPeriod,
	SurchargeService,
	SurchargeServiceLive,
} from "@/lib/effect/services/surcharge.service";
import {
	type ComplianceWarning,
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";
import type { PolicyClockOutSurchargeSnapshot } from "@/lib/time-tracking/policy-clock-out-surcharge-snapshot";
import { readComplianceTotals } from "@/lib/time-tracking/compliance-totals";
import { getTodayRangeInTimezone } from "@/lib/time-tracking/timezone-utils";
import { logger } from "./shared";

export async function calculateBreaksTakenToday(
	employeeId: string,
	timezone: string = "UTC",
): Promise<number> {
	const { start: todayStartDateTime, end: todayEndDateTime } =
		getTodayRangeInTimezone(timezone);
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
			const gapMinutes = Math.floor(
				(nextStart.getTime() - currentEnd.getTime()) / 60_000,
			);
			if (gapMinutes > 1) {
				totalBreakMinutes += gapMinutes;
			}
		}
	}

	return totalBreakMinutes;
}

/**
 * Checks one closed period against the employee's working-time rules and logs
 * its violations. Totals come from `readComplianceTotals`, never from the
 * request session, and cover the work's own local day and week in `timezone`,
 * so on-behalf, bot, API and worker closures are judged like self clock-outs.
 */
export async function checkComplianceAfterClockOut(input: {
	employeeId: string;
	organizationId: string;
	workPeriodId: string;
	durationMinutes: number;
	/** Where the closed work started. */
	workStart: Instant;
	timezone: string;
}): Promise<ComplianceWarning[]> {
	const { employeeId, organizationId, workPeriodId } = input;
	try {
		const totals = await readComplianceTotals({
			organizationId,
			employeeId,
			workStart: input.workStart,
			timezone: input.timezone,
		});

		const complianceEffect = Effect.gen(function* (_) {
			const workPolicyService = yield* _(WorkPolicyService);
			const result = yield* _(
				workPolicyService.checkCompliance({
					employeeId,
					organizationId,
					currentSessionMinutes: input.durationMinutes,
					totalDailyMinutes: totals.dailyMinutes,
					totalWeeklyMinutes: totals.weeklyMinutes,
					breaksTakenMinutes: totals.breakMinutes,
				}),
			);

			if (result.warnings.length > 0) {
				const effectivePolicy = yield* _(
					workPolicyService.getEffectivePolicy(employeeId, organizationId),
				);
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
		}).pipe(
			Effect.provide(WorkPolicyServiceLive),
			Effect.provide(DatabaseServiceLive),
		);

		return await Effect.runPromise(complianceEffect);
	} catch (error) {
		logger.error({ error }, "Failed to check compliance after clock-out");
		return [];
	}
}

export async function calculateAndPersistSurcharges(
	workPeriodId: string,
	organizationId: string,
	immutableEvidence?: {
		employeeId: string;
		snapshot: PolicyClockOutSurchargeSnapshot;
	},
): Promise<void> {
	try {
		const surchargeEffect = Effect.gen(function* (_) {
			const surchargeService = yield* _(SurchargeService);
			yield* _(
				calculateSurchargeForWorkPeriod(surchargeService, {
					workPeriodId,
					organizationId,
					immutableEvidence,
				}),
			);
		}).pipe(
			Effect.provide(SurchargeServiceLive),
			Effect.provide(DatabaseServiceLive),
		);

		await Effect.runPromise(surchargeEffect);
	} catch (error) {
		logger.error(
			{ error, workPeriodId },
			"Failed to calculate surcharges after clock-out",
		);
	}
}

export async function reconcileImmediateSurcharges(input: {
	organizationId: string;
	employeeId: string;
	affectedWorkPeriodIds: string[];
	snapshot: PolicyClockOutSurchargeSnapshot;
}): Promise<void> {
	const surchargeEffect = Effect.gen(function* (_) {
		const surchargeService = yield* _(SurchargeService);
		yield* _(
			surchargeService.reconcileWorkPeriods({
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				surchargePeriodIds: input.affectedWorkPeriodIds,
				staleSurchargePeriodIds: [],
				surchargeSnapshot: input.snapshot,
			}),
		);
	}).pipe(
		Effect.provide(SurchargeServiceLive),
		Effect.provide(DatabaseServiceLive),
	);

	await Effect.runPromise(surchargeEffect);
}

export async function enforceBreaksAfterClockOut(input: {
	employeeId: string;
	organizationId: string;
	workPeriodId: string;
	sessionDurationMinutes: number;
	timezone: string;
	createdBy: string;
}): Promise<BreakEnforcementResult> {
	// Failures propagate: the after-commit follow-ups run this best-effort, and a
	// departure's durable follow-up task retries it (#485).
	const enforcementEffect = Effect.gen(function* (_) {
		const breakService = yield* _(BreakEnforcementService);
		return yield* _(breakService.enforceBreaksAfterClockOut(input));
	}).pipe(
		Effect.provide(BreakEnforcementServiceLive),
		Effect.provide(WorkPolicyServiceLive),
		Effect.provide(DatabaseServiceLive),
	);

	return Effect.runPromise(enforcementEffect);
}
