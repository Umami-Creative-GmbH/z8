/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmployeeQualificationList } from "./employee-qualification-list";

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

const qualification = {
	id: "employee-skill-1",
	employeeId: "employee-1",
	skillId: "skill-1",
	status: "active" as const,
	assignedBy: "manager-1",
	assignedAt: new Date("2026-01-01T00:00:00Z"),
	issuedAt: new Date("2026-01-15T00:00:00Z"),
	expiresAt: new Date("2027-01-15T00:00:00Z"),
	renewedAt: null,
	renewedBy: null,
	issuer: "Safety Council",
	certificateNumber: "CERT-12345",
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

describe("EmployeeQualificationList", () => {
	it("renders qualification metadata and renewal action", () => {
		const onRenew = vi.fn();

		render(<EmployeeQualificationList qualifications={[qualification]} onRenew={onRenew} />);

		expect(screen.getByText("Forklift License")).toBeTruthy();
		expect(screen.getByText(/Issued Jan 15, 2026/)).toBeTruthy();
		expect(screen.getByText(/Issuer: Safety Council/)).toBeTruthy();
		expect(screen.getByText(/Certificate: CERT-12345/)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Submit renewal evidence" }));
		expect(onRenew).toHaveBeenCalledWith(qualification);
	});
});
