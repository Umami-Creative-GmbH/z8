/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { getOnboardingSummaryMock, pushMock, replaceMock, skipOrganizationSetupMock } = vi.hoisted(() => ({
	getOnboardingSummaryMock: vi.fn(),
	pushMock: vi.fn(),
	replaceMock: vi.fn(),
	skipOrganizationSetupMock: vi.fn(),
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

vi.mock("@/app/[locale]/(app)/organization-actions", () => ({
	checkSlugAvailability: vi.fn(),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

vi.mock("@/components/onboarding/progress-indicator", () => ({
	ProgressIndicator: () => null,
}));

vi.mock("./actions", () => ({
	createOrganizationOnboarding: vi.fn(),
	getOnboardingSummary: getOnboardingSummaryMock,
	skipOrganizationSetup: skipOrganizationSetupMock,
}));

import OrganizationPageClient from "./organization-page-client";

describe("OrganizationPageClient", () => {
	it("hides the creation form when organization creation is disabled", async () => {
		getOnboardingSummaryMock.mockResolvedValue({ success: true, data: { hasOrganization: false } });

		render(<OrganizationPageClient canCreateOrganizations={false} />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy();
		});

		expect(screen.queryByText("Create Organization")).toBeNull();
		expect(screen.queryByPlaceholderText("Acme Inc.")).toBeNull();
		expect(screen.queryByRole("button", { name: "Create Organization" })).toBeNull();
	});

	it("explains creation is disabled when the creation form is unavailable", async () => {
		getOnboardingSummaryMock.mockResolvedValue({ success: true, data: { hasOrganization: false } });

		render(<OrganizationPageClient canCreateOrganizations={false} />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy();
		});

		expect(screen.getByText("Organization creation is disabled for this deployment.")).toBeTruthy();
		expect(
			screen.getByText(
				"You can continue by skipping this step while you wait for an invitation to an existing organization.",
			),
		).toBeTruthy();
		expect(
			screen.queryByText(
				"Create your organization to unlock all features, or skip if you're waiting for an invitation.",
			),
		).toBeNull();
	});
});
