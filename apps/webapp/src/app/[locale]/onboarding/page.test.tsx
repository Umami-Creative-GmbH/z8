import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, DatabaseError } from "@/lib/effect/errors";
import { OnboardingService } from "@/lib/effect/services/onboarding.service";

const mocks = vi.hoisted(() => ({
	connection: vi.fn(async () => undefined),
	getOnboardingStatus: vi.fn(),
	redirectWithLocale: vi.fn((href: string) => {
		throw new Error(`REDIRECT:${href}`);
	}),
}));

vi.mock("next/server", () => ({
	connection: mocks.connection,
}));

vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: mocks.redirectWithLocale,
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { Layer } = await import("effect");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	return runtimeModuleOver(
		Layer.succeed(
			OnboardingService,
			OnboardingService.of({
				getOnboardingStatus: mocks.getOnboardingStatus,
			} as never),
		),
	);
});

import OnboardingIndexPage from "./page";

describe("OnboardingIndexPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getOnboardingStatus.mockReset();
	});

	it("redirects unauthenticated visitors to sign-in with /onboarding as callbackUrl", async () => {
		mocks.getOnboardingStatus.mockReturnValue(
			Effect.fail(new AuthenticationError({ message: "Not authenticated" })),
		);

		await expect(OnboardingIndexPage()).rejects.toThrow(
			"REDIRECT:/sign-in?callbackUrl=%2Fonboarding",
		);
		expect(mocks.connection).toHaveBeenCalledOnce();
		expect(mocks.redirectWithLocale).toHaveBeenCalledWith("/sign-in?callbackUrl=%2Fonboarding");
	});

	it("redirects users with completed onboarding to /init", async () => {
		mocks.getOnboardingStatus.mockReturnValue(
			Effect.succeed({ onboardingComplete: true, onboardingStep: null }),
		);

		await expect(OnboardingIndexPage()).rejects.toThrow("REDIRECT:/init");
		expect(mocks.redirectWithLocale).toHaveBeenCalledWith("/init");
	});

	it.each([
		[null, "/onboarding/welcome"],
		["profile", "/onboarding/profile"],
		["vacation_policy", "/onboarding/vacation-policy"],
		["wellness", "/onboarding/wellness"],
		["holiday_setup", "/onboarding/work-templates"],
	] as const)(
		"redirects incomplete onboarding step %s to %s",
		async (onboardingStep, expectedPath) => {
			mocks.getOnboardingStatus.mockReturnValue(
				Effect.succeed({ onboardingComplete: false, onboardingStep }),
			);

			await expect(OnboardingIndexPage()).rejects.toThrow(`REDIRECT:${expectedPath}`);
			expect(mocks.redirectWithLocale).toHaveBeenCalledWith(expectedPath);
		},
	);

	it("propagates non-authentication failures instead of redirecting to sign-in", async () => {
		mocks.getOnboardingStatus.mockReturnValue(
			Effect.fail(
				new DatabaseError({ message: "db unavailable", operation: "getOnboardingStatus" }),
			),
		);

		await expect(OnboardingIndexPage()).rejects.toThrow("db unavailable");
		expect(mocks.redirectWithLocale).not.toHaveBeenCalled();
	});
});
