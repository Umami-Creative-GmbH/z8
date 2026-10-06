"use server";

import { Effect } from "effect-v3";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect-v3/result";
import type { OnboardingSummary } from "@/lib/effect-v3/services/onboarding.service";
import { OnboardingService } from "@/lib/effect-v3/services/onboarding.service";

export async function completeOnboarding(): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.completeOnboarding();
		}),
	);
}

export async function getOnboardingSummary(): Promise<ServerActionResult<OnboardingSummary>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			return yield* onboardingService.getOnboardingSummary();
		}),
	);
}
