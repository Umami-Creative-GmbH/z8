/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

const { configureWellnessOnboardingMock, pushMock } = vi.hoisted(() => ({
	configureWellnessOnboardingMock: vi.fn(),
	pushMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/components/onboarding/progress-indicator", () => ({
	ProgressIndicator: () => null,
}));

vi.mock("./actions", () => ({
	configureWellnessOnboarding: configureWellnessOnboardingMock,
	skipWellnessSetup: vi.fn(),
}));

import WellnessPage from "./page";

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

describe("WellnessPage", () => {
	it("enables water reminders by default during onboarding", async () => {
		configureWellnessOnboardingMock.mockResolvedValue({ success: true });

		render(<WellnessPage />);

		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		await waitFor(() => {
			expect(configureWellnessOnboardingMock).toHaveBeenCalledWith(
				expect.objectContaining({ enableWaterReminder: true }),
			);
		});
	});
});
