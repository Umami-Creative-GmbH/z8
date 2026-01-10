"use server";

import { Effect } from "effect";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { OnboardingService } from "@/lib/effect/services/onboarding.service";

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
