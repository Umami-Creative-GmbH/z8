"use server";

import { Effect } from "effect";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { OnboardingService } from "@/lib/effect/services/onboarding.service";
import type { OnboardingWellnessFormValues } from "@/lib/validations/wellness";

export async function configureWellnessOnboarding(
	data: OnboardingWellnessFormValues,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.configureWellness(data);
		}),
	);
}

export async function skipWellnessSetup(): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.skipWellnessSetup();
		}),
	);
}
