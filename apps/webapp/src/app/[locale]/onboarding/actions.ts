"use server";

import { Effect } from "effect";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { OnboardingService } from "@/lib/effect/services/onboarding.service";

export async function getOnboardingIsAdmin(): Promise<ServerActionResult<boolean>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			return yield* onboardingService.isUserAdmin();
		}),
	);
}
