import "server-only";

import { Effect } from "effect";
import { runtime } from "@/lib/effect/runtime";
import {
	ChangePolicyService,
	type EditCapability,
} from "@/lib/effect/services/change-policy.service";

export async function getEditCapabilityForPeriod(params: {
	employeeId: string;
	workPeriodEndTime: Date;
	timezone: string;
}): Promise<EditCapability> {
	const effect = Effect.gen(function* () {
		const policyService = yield* ChangePolicyService;

		return yield* policyService.getEditCapability(params);
	});

	return runtime.runPromise(effect);
}
