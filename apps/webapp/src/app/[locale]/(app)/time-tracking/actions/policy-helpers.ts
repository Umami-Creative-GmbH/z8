"use server";

import { Effect } from "effect";
import {
	ChangePolicyService,
	ChangePolicyServiceLive,
	type EditCapability,
} from "@/lib/effect/services/change-policy.service";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";

export async function getEditCapabilityForPeriod(params: {
	employeeId: string;
	workPeriodEndTime: Date;
	timezone: string;
}): Promise<EditCapability> {
	const effect = Effect.gen(function* (_) {
		const policyService = yield* _(ChangePolicyService);

		return yield* _(policyService.getEditCapability(params));
	}).pipe(Effect.provide(ChangePolicyServiceLive), Effect.provide(DatabaseServiceLive));

	return Effect.runPromise(effect);
}

export async function checkClockOutNeedsApproval(employeeId: string): Promise<boolean> {
	const effect = Effect.gen(function* (_) {
		const policyService = yield* _(ChangePolicyService);

		return yield* _(policyService.checkClockOutNeedsApproval(employeeId));
	}).pipe(Effect.provide(ChangePolicyServiceLive), Effect.provide(DatabaseServiceLive));

	return Effect.runPromise(effect);
}
