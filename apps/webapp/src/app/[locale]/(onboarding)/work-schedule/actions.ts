"use server";

import { Effect } from "effect";
import { OnboardingService } from "@/lib/effect/services/onboarding.service";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import type { OnboardingWorkScheduleFormValues } from "@/lib/validations/onboarding";

export async function setWorkScheduleOnboarding(
	data: OnboardingWorkScheduleFormValues,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.setWorkSchedule(data);
		}),
	);
}

export async function skipWorkScheduleSetup(): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.skipWorkScheduleSetup();
		}),
	);
}
