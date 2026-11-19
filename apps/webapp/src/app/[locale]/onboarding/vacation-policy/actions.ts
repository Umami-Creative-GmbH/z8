"use server";

import { Effect } from "effect";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { OnboardingService } from "@/lib/effect/services/onboarding.service";
import type {
	OnboardingOrganizationExpectation,
	OnboardingVacationPolicyFormValues,
} from "@/lib/validations/onboarding";

export async function createVacationPolicyOnboarding(
	data: OnboardingVacationPolicyFormValues,
	expected?: OnboardingOrganizationExpectation,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.createVacationPolicy(data, expected);
		}),
	);
}

export async function skipVacationPolicySetup(
	expected?: OnboardingOrganizationExpectation,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.skipVacationPolicySetup(expected);
		}),
	);
}

export async function checkIsAdmin(): Promise<ServerActionResult<boolean>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			return yield* onboardingService.isUserAdmin();
		}),
	);
}
