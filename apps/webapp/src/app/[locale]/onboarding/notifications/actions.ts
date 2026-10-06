"use server";

import { Effect } from "effect-v3";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect-v3/result";
import { OnboardingService } from "@/lib/effect-v3/services/onboarding.service";
import type { OnboardingNotificationsFormValues } from "@/lib/validations/onboarding";

export async function configureNotificationsOnboarding(
	data: OnboardingNotificationsFormValues,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.configureNotifications(data);
		}),
	);
}

export async function skipNotificationsSetup(): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.skipNotificationsSetup();
		}),
	);
}
