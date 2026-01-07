"use server";

import { Effect } from "effect";
import { OnboardingService } from "@/lib/effect/services/onboarding.service";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";

export async function startOnboarding(): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.startOnboarding();
		}),
	);
}

export async function updateOnboardingStep(step: string): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.updateOnboardingStep(step as any);
		}),
	);
}
