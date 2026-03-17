"use server";

import { Effect } from "effect";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { OnboardingService } from "@/lib/effect/services/onboarding.service";
import type { OnboardingProfileFormValues } from "@/lib/validations/onboarding";

export async function updateProfileOnboarding(
	data: OnboardingProfileFormValues,
): Promise<ServerActionResult<{ nextStep: string }>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			return yield* onboardingService.updateProfile(data);
		}),
	);
}

export async function skipProfileSetup(): Promise<ServerActionResult<{ nextStep: string }>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			return yield* onboardingService.skipProfileSetup();
		}),
	);
}
