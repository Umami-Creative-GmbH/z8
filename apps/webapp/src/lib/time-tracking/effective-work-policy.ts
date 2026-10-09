import { Effect } from "effect";
import type { Instant } from "@/lib/datetime/temporal-core";
import { runtime } from "@/lib/effect/runtime";
import {
	type EffectiveWorkPolicy,
	WorkPolicyService,
} from "@/lib/effect/services/work-policy.service";

/**
 * The work policy in force for an employee at `at` (employee, team, then organization
 * assignment), resolved on the shared runtime. `null` when no policy applies.
 */
export function readEffectiveWorkPolicyAt(input: {
	organizationId: string;
	employeeId: string;
	at: Instant;
}): Promise<EffectiveWorkPolicy | null> {
	return runtime.runPromise(
		Effect.gen(function* () {
			const service = yield* WorkPolicyService;
			return yield* service.getEffectivePolicyAt(input);
		}),
	);
}
