import "server-only";

// Web-side break and surcharge helpers for callers that have already authorized
// the employee (#443): not server actions, so a client cannot run them for any ID.
// The clock-out follow-up effects live in `@/lib/time-tracking/clock-out-effects`.

import { and, eq, gte, lte } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { workPeriod } from "@/db/schema";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { runtime } from "@/lib/effect/runtime";
import {
	calculateSurchargeForWorkPeriod,
	SurchargeService,
	SurchargeServiceLive,
} from "@/lib/effect/services/surcharge.service";
import type { PolicyClockOutSurchargeSnapshot } from "@/lib/time-tracking/policy-clock-out-surcharge-snapshot";
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

export async function calculateAndPersistSurcharges(
	workPeriodId: string,
	organizationId: string,
	immutableEvidence?: {
		employeeId: string;
		snapshot: PolicyClockOutSurchargeSnapshot;
	},
): Promise<void> {
	try {
		const surchargeEffect = Effect.gen(function* () {
			const surchargeService = yield* SurchargeService;
			yield* calculateSurchargeForWorkPeriod(surchargeService, {
				workPeriodId,
				organizationId,
				immutableEvidence,
			});
		});

		await runtime.runPromise(surchargeEffect.pipe(Effect.provide(SurchargeServiceLive)));
	} catch (error) {
		logger.error(
			{ error, workPeriodId },
			"Failed to calculate surcharges after clock-out",
		);
	}
}
