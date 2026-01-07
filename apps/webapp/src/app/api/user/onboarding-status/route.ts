import { NextResponse } from "next/server";
import { Effect } from "effect";
import { OnboardingService } from "@/lib/effect/services/onboarding.service";
import { runServerActionSafe } from "@/lib/effect/result";

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
