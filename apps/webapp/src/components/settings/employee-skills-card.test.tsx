/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmployeeSkillsCard } from "./employee-skills-card";

const employeeSkill = {
	id: "employee-skill-1",
	employeeId: "employee-1",
	skillId: "skill-1",
	assignedBy: "manager-1",
	issuedAt: new Date("2026-01-15T00:00:00Z"),
	expiresAt: new Date("2027-01-15T00:00:00Z"),
	issuer: "Safety Council With A Very Long Issuer Name",
	certificateNumber: "CERT-VERY-LONG-1234567890",
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

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
	return {
		...actual,
		useQueryClient: () => ({ invalidateQueries: vi.fn() }),
		useMutation: () => ({ mutate: vi.fn(), isPending: false }),
	};
});

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

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/app/[locale]/(app)/settings/skills/actions", () => ({
	assignSkillToEmployee: vi.fn(),
	removeSkillFromEmployee: vi.fn(),
}));

vi.mock("@/lib/query/use-skills", () => ({
	useEmployeeSkills: () => ({ data: [employeeSkill], isLoading: false }),
	useOrganizationSkills: () => ({ data: [], isLoading: false }),
}));

describe("EmployeeSkillsCard", () => {
	it("renders qualification assignment metadata", () => {
		render(<EmployeeSkillsCard employeeId="employee-1" organizationId="org-1" canManageSkills />);

		expect(screen.getByText("Forklift License")).toBeTruthy();
		expect(screen.getByText(/Issued Jan 15, 2026/)).toBeTruthy();
		expect(screen.getByText(/Issuer: Safety Council With A Very Long Issuer Name/)).toBeTruthy();
		expect(screen.getByText(/Certificate: CERT-VERY-LONG-1234567890/)).toBeTruthy();
	});
});
