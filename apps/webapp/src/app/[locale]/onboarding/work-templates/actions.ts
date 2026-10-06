"use server";

import { Effect } from "effect-v3";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect-v3/result";
import { OnboardingService } from "@/lib/effect-v3/services/onboarding.service";
import type { OnboardingWorkTemplateFormValues } from "@/lib/validations/onboarding";

export async function createWorkTemplateOnboarding(
	data: OnboardingWorkTemplateFormValues,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.createWorkTemplate(data);
		}),
	);
}

export async function skipWorkTemplateSetup(): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.skipWorkTemplateSetup();
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
