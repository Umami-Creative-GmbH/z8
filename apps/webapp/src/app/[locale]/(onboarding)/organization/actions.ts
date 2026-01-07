"use server";

import { Effect } from "effect";
import { OnboardingService } from "@/lib/effect/services/onboarding.service";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
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
