import { Effect, Layer, ManagedRuntime } from "effect";
import { DatabaseServiceLive } from "./services/database.service";
import {
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "./services/work-policy.service";

export function getEmployeePolicyEffect(
	employeeId: string,
	organizationId: string,
) {
	return Effect.gen(function* () {
		const workPolicyService = yield* WorkPolicyService;
		return yield* workPolicyService.getEffectivePolicy(
			employeeId,
			organizationId,
		);
	});
}

const WorkPolicyRuntimeLayer = WorkPolicyServiceLive.pipe(
	Layer.provide(DatabaseServiceLive),
);

const workPolicyRuntime = ManagedRuntime.make(WorkPolicyRuntimeLayer);

export function runEmployeePolicyLookup(
	employeeId: string,
	organizationId: string,
) {
	return workPolicyRuntime.runPromise(
		getEmployeePolicyEffect(employeeId, organizationId),
	);
}
