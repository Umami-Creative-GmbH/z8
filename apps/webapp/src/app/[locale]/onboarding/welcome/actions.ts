"use server";

import { Effect } from "effect";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import {
	OnboardingService,
	type OnboardingSummary,
} from "@/lib/effect/services/onboarding.service";

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

export async function getOnboardingSummary(): Promise<ServerActionResult<OnboardingSummary>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			return yield* onboardingService.getOnboardingSummary();
		}),
	);
}
