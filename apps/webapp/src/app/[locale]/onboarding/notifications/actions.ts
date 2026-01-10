"use server";

import { Effect } from "effect";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { OnboardingService } from "@/lib/effect/services/onboarding.service";
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
