"use server";

import { Effect } from "effect-v3";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect-v3/result";
import { OnboardingService } from "@/lib/effect-v3/services/onboarding.service";
import {
	type OnboardingProfileFormInput,
	onboardingProfileSchema,
} from "@/lib/validations/onboarding";

export async function updateProfileOnboarding(
	data: OnboardingProfileFormInput,
): Promise<ServerActionResult<{ nextStep: string }>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const parsedData = onboardingProfileSchema.parse(data);
			const onboardingService = yield* OnboardingService;
			return yield* onboardingService.updateProfile(parsedData);
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
