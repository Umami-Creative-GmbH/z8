import { Effect } from "effect";
import { tryPromiseWithRunner } from "@/lib/effect/promise-callback";
import { runtime } from "@/lib/effect/runtime";
import {
	BreakEnforcementService,
	BreakEnforcementServiceLive,
} from "@/lib/effect/services/break-enforcement.service";
import { SurchargeService, SurchargeServiceLive } from "@/lib/effect/services/surcharge.service";
import { processAutomaticBreakIntents } from "@/lib/time-tracking/automatic-break-adjustment";

/**
 * Run break enforcement check for all unprocessed work periods.
 * This is a standalone function that can be called from workers/cron jobs.
 *
 * @param options - Optional configuration
 * @param options.date - Target date (defaults to today)
 * @param options.organizationId - Filter to specific organization
 */
export async function runBreakEnforcementCheck(options?: {
	date?: Date;
	organizationId?: string;
}): Promise<{
	processedCount: number;
	adjustedCount: number;
	/** Intents still held by unresolved review or another blocker. */
	deferredCount: number;
	errors: Array<{ workPeriodId: string; error: string }>;
}> {
	const check = Effect.gen(function* () {
		const surchargeService = yield* SurchargeService;
		const breakService = yield* BreakEnforcementService;

		// Committed intents first, whatever the work's date: deferred adjustments recover
		// here once their review resolves, and lost immediate runs are retried.
		const recovered = yield* tryPromiseWithRunner({
			try: (run) =>
				processAutomaticBreakIntents({
					organizationId: options?.organizationId,
					afterAdjusted: async (outcome, target) => {
						if (!outcome.surchargeSnapshot) return;
						await run(
							surchargeService.reconcileWorkPeriods({
								organizationId: target.organizationId,
								employeeId: target.employeeId,
								surchargePeriodIds: [outcome.workPeriodId, outcome.generatedWorkPeriodId],
								staleSurchargePeriodIds: [],
								surchargeSnapshot: outcome.surchargeSnapshot,
							}),
						);
					},
				}),
			// The recovery's own failure fails the check unchanged.
			catch: (cause) => cause,
		});

		const daily = yield* breakService.processUnprocessedPeriods({
			date: options?.date,
			organizationId: options?.organizationId,
		});
		return {
			processedCount: recovered.processed + daily.processedCount,
			adjustedCount: recovered.adjusted + daily.adjustedCount,
			deferredCount: recovered.deferred,
			errors: [...recovered.errors, ...daily.errors],
		};
	});

	return runtime.runPromise(
		check.pipe(Effect.provide([BreakEnforcementServiceLive, SurchargeServiceLive])),
	);
}
