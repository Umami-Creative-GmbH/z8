"use server";

import { Effect } from "effect";
import { OnboardingService } from "@/lib/effect/services/onboarding.service";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import type { OnboardingProfileFormValues } from "@/lib/validations/onboarding";

export async function updateProfileOnboarding(
	data: OnboardingProfileFormValues,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.updateProfile(data);
		}),
	);
}

export async function skipProfileSetup(): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.skipProfileSetup();
		}),
	);
}
