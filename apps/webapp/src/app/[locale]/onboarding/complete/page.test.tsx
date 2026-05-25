/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { completeOnboardingMock, getOnboardingSummaryMock, pushMock } = vi.hoisted(() => ({
	completeOnboardingMock: vi.fn(),
	getOnboardingSummaryMock: vi.fn(),
	pushMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("sonner", () => ({
	toast: {
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
	completeOnboarding: completeOnboardingMock,
	getOnboardingSummary: getOnboardingSummaryMock,
}));

import CompletePage from "./page";

describe("CompletePage", () => {
	it("omits the setup summary card after onboarding completes", async () => {
		completeOnboardingMock.mockResolvedValue({ success: true });
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: {
				hasOrganization: true,
				organizationName: "Acme",
				profileCompleted: true,
				workPolicySet: false,
				isAdmin: true,
				vacationPolicyCreated: false,
				holidayPresetCreated: false,
				workTemplateCreated: false,
				notificationsConfigured: false,
			},
		});

		render(<CompletePage />);

		await waitFor(() => {
			expect(screen.getByText("You're all set!")).toBeTruthy();
		});

		expect(screen.queryByText("What You've Set Up")).toBeNull();
		expect(screen.queryByText("Vacation policy skipped")).toBeNull();
		expect(screen.queryByText("Holidays skipped")).toBeNull();
		expect(screen.queryByText("Work template skipped")).toBeNull();
		expect(screen.getByText("Next Steps")).toBeTruthy();
	});
});
