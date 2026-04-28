/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenewalReviewQueue } from "./renewal-review-queue";

const {
	getPendingQualificationRenewalRequestsMock,
	reviewQualificationRenewalRequestMock,
	toastSuccessMock,
} = vi.hoisted(() => ({
	getPendingQualificationRenewalRequestsMock: vi.fn(),
	reviewQualificationRenewalRequestMock: vi.fn(),
	toastSuccessMock: vi.fn(),
}));

const pendingRequest = {
	id: "renewal-request-1",
	organizationId: "org-1",
	employeeId: "employee-1",
	employeeSkillId: "employee-skill-1",
	requestedIssuedAt: new Date("2026-01-01T00:00:00Z"),
	requestedExpiresAt: new Date("2027-01-15T00:00:00Z"),
	requestedIssuer: "Safety Council",
	requestedCertificateNumber: "CERT-98765",
	notes: "Updated forklift license",
	status: "pending" as const,
	reviewerId: null,
	reviewedAt: null,
	reviewNotes: null,
	createdAt: new Date("2026-01-10T08:30:00Z"),
	updatedAt: new Date("2026-01-10T08:30:00Z"),
};

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) => {
			if (!params) return fallback;
			return Object.entries(params).reduce(
				(text, [key, value]) => text.replace(`{{${key}}}`, value),
				fallback,
			);
		},
	}),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: toastSuccessMock } }));

vi.mock("@/app/[locale]/(app)/settings/skills/actions", () => ({
	getPendingQualificationRenewalRequests: getPendingQualificationRenewalRequestsMock,
	reviewQualificationRenewalRequest: reviewQualificationRenewalRequestMock,
}));

function renderWithQueryClient(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

describe("RenewalReviewQueue", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getPendingQualificationRenewalRequestsMock.mockResolvedValue({
			success: true,
			data: [pendingRequest],
		});
		reviewQualificationRenewalRequestMock.mockResolvedValue({
			success: true,
			data: { ...pendingRequest, status: "approved" },
		});
	});

	it("renders pending renewal details and approves a request", async () => {
		renderWithQueryClient(<RenewalReviewQueue organizationId="org-1" />);

		expect(await screen.findByText("Qualification renewal request")).toBeTruthy();
		expect(screen.getByText("Issuer: Safety Council")).toBeTruthy();
		expect(screen.getByText("Certificate: CERT-98765")).toBeTruthy();
		expect(screen.getByText("Notes: Updated forklift license")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Approve renewal request" }));

		await waitFor(() => {
			expect(reviewQualificationRenewalRequestMock).toHaveBeenCalledWith({
				requestId: "renewal-request-1",
				approved: true,
				reviewNotes: "Approved",
			});
		});
		expect(toastSuccessMock).toHaveBeenCalledWith("Renewal request reviewed");
	});

	it("shows an empty state when there are no pending renewal requests", async () => {
		getPendingQualificationRenewalRequestsMock.mockResolvedValue({ success: true, data: [] });

		renderWithQueryClient(<RenewalReviewQueue organizationId="org-1" />);

		expect(await screen.findByText("No pending renewal requests."));
	});
});
