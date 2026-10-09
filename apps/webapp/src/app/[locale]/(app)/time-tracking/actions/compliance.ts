import "server-only";

// Web-side surcharge helpers for callers that have already authorized
// the employee (#443): not server actions, so a client cannot run them for any ID.
// The clock-out follow-up effects live in `@/lib/time-tracking/clock-out-effects`.

import { Effect } from "effect";
import { runtime } from "@/lib/effect/runtime";
import {
	calculateSurchargeForWorkPeriod,
	SurchargeService,
	SurchargeServiceLive,
} from "@/lib/effect/services/surcharge.service";
import type { PolicyClockOutSurchargeSnapshot } from "@/lib/time-tracking/policy-clock-out-surcharge-snapshot";
import { logger } from "./shared";

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
