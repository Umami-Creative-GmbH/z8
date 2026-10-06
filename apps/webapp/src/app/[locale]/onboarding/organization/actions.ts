"use server";

import { Effect } from "effect-v3";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect-v3/result";
import {
	OnboardingService,
	type OnboardingSummary,
} from "@/lib/effect-v3/services/onboarding.service";
import type { OrganizationFormValues } from "@/lib/validations/organization";

export async function createOrganizationOnboarding(
	data: OrganizationFormValues,
): Promise<ServerActionResult<{ organizationId: string }>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			return yield* onboardingService.createOrganization(data);
		}),
	);
}

export async function skipOrganizationSetup(): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			yield* onboardingService.skipOrganizationSetup();
		}),
	);
}

export async function getOnboardingSummary(): Promise<ServerActionResult<OnboardingSummary>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			return yield* onboardingService.getOnboardingSummary();
		}),
	);
}
