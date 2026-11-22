import { Effect } from "effect";
import { connection } from "next/server";
import { withCallbackUrl } from "@/lib/auth/callback-url";
import { runServerActionSafe } from "@/lib/effect/result";
import { OnboardingService } from "@/lib/effect/services/onboarding.service";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { getOnboardingStepPath } from "@/lib/validations/onboarding-steps";

export const instant = false;

export default async function OnboardingIndexPage() {
	await connection();
	const result = await runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			return yield* onboardingService.getOnboardingStatus();
		}),
	);

	if (!result.success) {
		if (result.code === "AuthenticationError") {
			return redirectWithLocale(withCallbackUrl("/sign-in", "/onboarding") as `/${string}`);
		}
		throw new Error(result.error);
	}

	if (result.data.onboardingComplete) {
		return redirectWithLocale("/init");
	}

	return redirectWithLocale(getOnboardingStepPath(result.data.onboardingStep));
}
