/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmployeeSkillsCard } from "./employee-skills-card";

const employeeSkill = {
	id: "employee-skill-1",
	employeeId: "employee-1",
	skillId: "skill-1",
	assignedBy: "manager-1",
	issuedAt: new Date("2026-01-15T00:00:00Z"),
	expiresAt: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
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
		expiryWarningDays: 60,
		isActive: true,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		createdBy: "user-1",
		updatedBy: null,
	},
};

const availableSkill = {
	id: "skill-2",
	organizationId: "org-1",
	name: "Crane Operator",
	description: null,
	category: "equipment",
	customCategoryName: null,
	requiresExpiry: true,
	expiryWarningDays: 30,
	isActive: true,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
	createdBy: "user-1",
	updatedBy: null,
};

class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock;

vi.mock("@tanstack/react-query", async () => {
	const actual =
		await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
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
	useOrganizationSkills: () => ({ data: [availableSkill], isLoading: false }),
}));

describe("EmployeeSkillsCard", () => {
	it("renders qualification assignment metadata", () => {
		render(<EmployeeSkillsCard employeeId="employee-1" organizationId="org-1" canManageSkills />);

		expect(screen.getByText("Forklift License")).toBeTruthy();
		expect(screen.getByText(/Issued Jan 15, 2026/)).toBeTruthy();
		expect(screen.getByText(/Issuer: Safety Council With A Very Long Issuer Name/)).toBeTruthy();
		expect(screen.getByText(/Certificate: CERT-VERY-LONG-1234567890/)).toBeTruthy();
	});

	it("uses the qualification warning window for expiring-soon status", () => {
		render(<EmployeeSkillsCard employeeId="employee-1" organizationId="org-1" canManageSkills />);

		expect(screen.getByText("Expiring Soon")).toBeTruthy();
	});

	it("resets the assign form after canceling", () => {
		render(<EmployeeSkillsCard employeeId="employee-1" organizationId="org-1" canManageSkills />);

		fireEvent.click(screen.getByRole("button", { name: "Assign Skill" }));
		fireEvent.click(screen.getByLabelText("Skill *"));
		fireEvent.click(screen.getByRole("option", { name: /Crane Operator/ }));
		fireEvent.change(screen.getByLabelText("Expiry Date *"), {
			target: { value: "2027-01-15" },
		});
		fireEvent.change(screen.getByLabelText("Issue Date"), {
			target: { value: "2026-01-15" },
		});
		fireEvent.change(screen.getByLabelText("Issuer"), {
			target: { value: "Safety Council" },
		});
		fireEvent.change(screen.getByLabelText("Certificate Number"), {
			target: { value: "CERT-12345" },
		});
		fireEvent.change(screen.getByLabelText("Notes"), {
			target: { value: "Qualified for crane operations" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		fireEvent.click(screen.getByRole("button", { name: "Assign Skill" }));

		expect(screen.getByText("Select a skill")).toBeTruthy();
		expect((screen.getByLabelText("Expiry Date") as HTMLInputElement).value).toBe("");
		expect((screen.getByLabelText("Issue Date") as HTMLInputElement).value).toBe("");
		expect((screen.getByLabelText("Issuer") as HTMLInputElement).value).toBe("");
		expect((screen.getByLabelText("Certificate Number") as HTMLInputElement).value).toBe("");
		expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("");
	});
});
