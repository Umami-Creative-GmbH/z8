/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { configureWellnessOnboardingMock, pushMock } = vi.hoisted(() => ({
	configureWellnessOnboardingMock: vi.fn(),
	pushMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
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
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("preserves enabled reminder values and submits them while loading", async () => {
		let resolveSubmit: (value: { success: true }) => void = () => undefined;
		configureWellnessOnboardingMock.mockReturnValue(
			new Promise((resolve) => {
				resolveSubmit = resolve;
			}),
		);

		render(<WellnessPage />);

		const reminderSwitch = screen.getByRole("switch");
		expect(reminderSwitch.getAttribute("aria-checked")).toBe("true");
		expect(
			screen.getByText("Every 45 minutes - recommended for most people"),
		).toBeTruthy();
		expect(screen.getByText("8 glasses")).toBeTruthy();

		fireEvent.click(reminderSwitch);
		expect(screen.queryByText("Reminder Frequency")).toBeNull();
		fireEvent.click(reminderSwitch);
		expect(
			screen.getByText("Every 45 minutes - recommended for most people"),
		).toBeTruthy();
		expect(screen.getByText("8 glasses")).toBeTruthy();

		const continueButton = screen.getByRole("button", { name: "Continue" });
		fireEvent.click(continueButton);

		await waitFor(() => {
			expect(configureWellnessOnboardingMock).toHaveBeenCalledWith({
				enableWaterReminder: true,
				waterReminderPreset: "moderate",
				waterReminderIntervalMinutes: 45,
				waterReminderDailyGoal: 8,
			});
			expect(continueButton.hasAttribute("disabled")).toBe(true);
			expect(reminderSwitch.hasAttribute("disabled")).toBe(true);
		});

		resolveSubmit({ success: true });
		await waitFor(() => {
			expect(pushMock).toHaveBeenCalledWith("/onboarding/notifications");
		});
	});
});
