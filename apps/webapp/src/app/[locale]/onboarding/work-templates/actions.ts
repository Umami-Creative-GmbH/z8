"use server";

import { Effect } from "effect";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { OnboardingService } from "@/lib/effect/services/onboarding.service";
import type {
	OnboardingOrganizationExpectation,
	OnboardingWorkTemplateFormValues,
} from "@/lib/validations/onboarding";

export async function createWorkTemplateOnboarding(
	data: OnboardingWorkTemplateFormValues,
	expected?: OnboardingOrganizationExpectation,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.createWorkTemplate(data, expected);
		}),
	);
}

export async function skipWorkTemplateSetup(
	expected?: OnboardingOrganizationExpectation,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.skipWorkTemplateSetup(expected);
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
