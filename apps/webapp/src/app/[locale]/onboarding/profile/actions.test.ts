import { Cause, Effect, Exit, Option, Result } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingService } from "@/lib/effect/services/onboarding.service";
import type { OnboardingProfileFormValues } from "@/lib/validations/onboarding";

const { updateProfileMock } = vi.hoisted(() => ({
	updateProfileMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
	headers: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@/lib/effect/result", () => ({
	runServerActionSafe: async (effect: Effect.Effect<unknown, unknown, OnboardingService>) => {
		const exit = await Effect.runPromiseExit(
			effect.pipe(
				Effect.provideService(
					OnboardingService,
					OnboardingService.of({
						updateProfile: updateProfileMock,
						skipProfileSetup: vi.fn(),
					} as never),
				),
			),
		);

		return Exit.match(exit, {
			onFailure: (cause) => {
				const defect =
					Result.getOrNull(Cause.findDefect(cause)) ??
					Option.getOrNull(Cause.findErrorOption(cause));
				return {
					success: false,
					error: defect instanceof Error ? defect.message : "An unexpected error occurred",
				};
			},
			onSuccess: (data) => ({ success: true, data }),
		});
	},
}));

import { updateProfileOnboarding } from "./actions";

describe("updateProfileOnboarding", () => {
	beforeEach(() => {
		updateProfileMock.mockReset();
	});

	it("applies preference defaults before updating the profile", async () => {
		updateProfileMock.mockReturnValue(Effect.succeed({ nextStep: "/onboarding/wellness" }));

		await updateProfileOnboarding({
			firstName: "Ada",
			lastName: "Lovelace",
		} as OnboardingProfileFormValues);

		expect(updateProfileMock).toHaveBeenCalledWith(
			expect.objectContaining({ weekStartDay: "sunday", timeFormat: "24h" }),
		);
	});

	it("rejects invalid week start values before updating the profile", async () => {
		const result = await updateProfileOnboarding({
			firstName: "Ada",
			lastName: "Lovelace",
			weekStartDay: "friday",
		} as unknown as OnboardingProfileFormValues);

		expect(result.success).toBe(false);
		expect(updateProfileMock).not.toHaveBeenCalled();
	});

	it("rejects invalid time format values before updating the profile", async () => {
		const result = await updateProfileOnboarding({
			firstName: "Ada",
			lastName: "Lovelace",
			timeFormat: "locale",
		} as unknown as OnboardingProfileFormValues);

		expect(result.success).toBe(false);
		expect(updateProfileMock).not.toHaveBeenCalled();
	});

	it.each(["1899-12-31", "2999-01-01", "2025-02-29", "2025-01-01T00:00:00Z"])(
		"refuses an out-of-range or non-calendar birthday %s",
		async (birthday) => {
			const result = await updateProfileOnboarding({
				firstName: "Ada",
				lastName: "Lovelace",
				birthday,
			});
			expect(result.success).toBe(false);
			expect(updateProfileMock).not.toHaveBeenCalled();
		},
	);
});
