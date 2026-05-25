/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { pushMock, updateProfileOnboardingMock } = vi.hoisted(() => ({
	pushMock: vi.fn(),
	updateProfileOnboardingMock: vi.fn(),
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
	skipProfileSetup: vi.fn(),
	updateProfileOnboarding: updateProfileOnboardingMock,
}));

import ProfilePage from "./page";

describe("ProfilePage", () => {
	it("renders the profile preferences and submits the default values", async () => {
		updateProfileOnboardingMock.mockResolvedValue({
			success: true,
			data: { nextStep: "/onboarding/organization" },
		});

		render(<ProfilePage />);

		expect(screen.getByText("First day of the week")).toBeTruthy();
		expect(
			screen.getByText("This controls how calendars and weekly summaries are displayed."),
		).toBeTruthy();
		expect(screen.getByText("Time format")).toBeTruthy();
		expect(screen.getByText("This controls how clock times are displayed.")).toBeTruthy();

		fireEvent.change(screen.getByPlaceholderText("John"), { target: { value: "Ada" } });
		fireEvent.change(screen.getByPlaceholderText("Doe"), { target: { value: "Lovelace" } });
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		await waitFor(() => {
			expect(updateProfileOnboardingMock).toHaveBeenCalledWith(
				expect.objectContaining({
					firstName: "Ada",
					lastName: "Lovelace",
					weekStartDay: "monday",
					timeFormat: "24h",
				}),
			);
		});
	});
});
