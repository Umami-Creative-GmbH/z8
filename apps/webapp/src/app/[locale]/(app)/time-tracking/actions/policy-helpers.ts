import "server-only";

import { Effect } from "effect-v3";
import {
	ChangePolicyService,
	ChangePolicyServiceLive,
	type EditCapability,
} from "@/lib/effect-v3/services/change-policy.service";
import { DatabaseServiceLive } from "@/lib/effect-v3/services/database.service";

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
