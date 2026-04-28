/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenewalSubmissionDialog } from "./renewal-submission-dialog";

const { submitMyQualificationRenewalMock } = vi.hoisted(() => ({
	submitMyQualificationRenewalMock: vi.fn(),
}));

const qualification = {
	id: "employee-skill-1",
	employeeId: "employee-1",
	skillId: "skill-1",
	assignedBy: "manager-1",
	issuedAt: null,
	expiresAt: new Date("2027-01-15T00:00:00Z"),
	issuer: null,
	certificateNumber: null,
	notes: null,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
	skill: {
		id: "skill-1",
		organizationId: "org-1",
		name: "Forklift License",
		description: null,
		category: "certification",
		customCategoryName: null,
		requiresExpiry: true,
		expiryWarningDays: 30,
		isActive: true,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		createdBy: "user-1",
		updatedBy: null,
	},
};

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/app/[locale]/(app)/my-qualifications/actions", () => ({
	submitMyQualificationRenewal: submitMyQualificationRenewalMock,
}));

function renderWithQueryClient(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

describe("RenewalSubmissionDialog", () => {
	beforeEach(() => {
		submitMyQualificationRenewalMock.mockResolvedValue({
			success: true,
			data: { id: "request-1" },
		});
	});

	it("submits comma-separated evidence IDs with renewal details", async () => {
		const onOpenChange = vi.fn();

		renderWithQueryClient(
			<RenewalSubmissionDialog qualification={qualification} open onOpenChange={onOpenChange} />,
		);

		fireEvent.change(screen.getByLabelText("Evidence IDs"), {
			target: { value: "evidence-1, evidence-2" },
		});
		fireEvent.change(screen.getByLabelText("New expiry date"), {
			target: { value: "2027-01-15" },
		});
		fireEvent.change(screen.getByLabelText("Issue date"), {
			target: { value: "2026-12-15" },
		});
		fireEvent.change(screen.getByLabelText("Issuer"), {
			target: { value: "Safety Council" },
		});
		fireEvent.change(screen.getByLabelText("Certificate number"), {
			target: { value: "CERT-98765" },
		});
		fireEvent.change(screen.getByLabelText("Notes"), {
			target: { value: "Renewed certificate" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Submit renewal" }));

		await waitFor(() => {
			expect(submitMyQualificationRenewalMock).toHaveBeenCalledWith({
				employeeSkillId: "employee-skill-1",
				evidenceIds: ["evidence-1", "evidence-2"],
				requestedExpiresAt: new Date("2027-01-15T00:00:00.000Z"),
				requestedIssuedAt: new Date("2026-12-15T00:00:00.000Z"),
				requestedIssuer: "Safety Council",
				requestedCertificateNumber: "CERT-98765",
				notes: "Renewed certificate",
			});
		});

		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
