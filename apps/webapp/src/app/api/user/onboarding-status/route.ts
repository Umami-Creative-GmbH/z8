import { Effect } from "effect-v3";
import { NextResponse } from "next/server";
import { runServerActionSafe } from "@/lib/effect-v3/result";
import { OnboardingService } from "@/lib/effect-v3/services/onboarding.service";

export async function GET() {
	const result = await runServerActionSafe(
		Effect.gen(function* () {
			const onboardingService = yield* OnboardingService;
			return yield* onboardingService.getOnboardingStatus();
		}),
	);

	if (!result.success) {
		return NextResponse.json({ error: result.error }, { status: 401 });
	}

	return NextResponse.json(result.data);
}
