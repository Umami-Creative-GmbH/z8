/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenewalSubmissionDialog } from "./renewal-submission-dialog";

const { submitMyQualificationRenewalMock } = vi.hoisted(() => ({
	submitMyQualificationRenewalMock: vi.fn(),
}));

const qualification = {
	id: "employee-skill-1",
	employeeId: "employee-1",
	skillId: "skill-1",
	status: "active" as const,
	assignedBy: "manager-1",
	assignedAt: new Date("2026-01-01T00:00:00Z"),
	issuedAt: null,
	expiresAt: new Date("2027-01-15T00:00:00Z"),
	renewedAt: null,
	renewedBy: null,
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
		category: "certification" as const,
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

function RenewalDialogHarness() {
	const [open, setOpen] = useState(false);
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
			}),
	);

	return (
		<QueryClientProvider client={queryClient}>
			<button type="button" onClick={() => setOpen(true)}>
				Open renewal
			</button>
			<RenewalSubmissionDialog qualification={qualification} open={open} onOpenChange={setOpen} />
		</QueryClientProvider>
	);
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

	it("shows pending feedback while submitting renewal evidence", async () => {
		submitMyQualificationRenewalMock.mockReturnValue(new Promise(() => {}));

		renderWithQueryClient(
			<RenewalSubmissionDialog qualification={qualification} open onOpenChange={vi.fn()} />,
		);

		fireEvent.click(screen.getByRole("button", { name: "Submit renewal" }));

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Submitting renewal…" })).toBeTruthy();
		});
	});

	it("resets renewal fields after canceling", () => {
		render(<RenewalDialogHarness />);

		fireEvent.click(screen.getByRole("button", { name: "Open renewal" }));
		fireEvent.change(screen.getByLabelText("Evidence IDs"), {
			target: { value: "evidence-1" },
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
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		fireEvent.click(screen.getByRole("button", { name: "Open renewal" }));

		expect((screen.getByLabelText("Evidence IDs") as HTMLInputElement).value).toBe("");
		expect((screen.getByLabelText("New expiry date") as HTMLInputElement).value).toBe("");
		expect((screen.getByLabelText("Issue date") as HTMLInputElement).value).toBe("");
		expect((screen.getByLabelText("Issuer") as HTMLInputElement).value).toBe("");
		expect((screen.getByLabelText("Certificate number") as HTMLInputElement).value).toBe("");
		expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("");
	});
});
