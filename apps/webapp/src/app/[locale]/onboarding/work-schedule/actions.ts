"use server";

import { Effect } from "effect-v3";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect-v3/result";
import { OnboardingService } from "@/lib/effect-v3/services/onboarding.service";
import type { OnboardingWorkScheduleFormValues } from "@/lib/validations/onboarding";

export async function setWorkScheduleOnboarding(
	data: OnboardingWorkScheduleFormValues,
): Promise<ServerActionResult<{ nextStep: string }>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.setWorkSchedule(data);

			// Determine next step based on admin status
			const isAdmin = yield* onboardingService.isUserAdmin();
			const nextStep = isAdmin ? "/onboarding/vacation-policy" : "/onboarding/wellness";
			return { nextStep };
		}),
	);
}

export async function skipWorkScheduleSetup(): Promise<ServerActionResult<{ nextStep: string }>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.skipWorkScheduleSetup();

			// Determine next step based on admin status
			const isAdmin = yield* onboardingService.isUserAdmin();
			const nextStep = isAdmin ? "/onboarding/vacation-policy" : "/onboarding/wellness";
			return { nextStep };
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
