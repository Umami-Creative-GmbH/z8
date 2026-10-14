/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EmployeeSkillWithDetails } from "@/lib/effect/services/skill.service";
import { EmployeeSkillsCard } from "./employee-skills-card";

const skills = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match)),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
vi.mock("@/app/[locale]/(app)/settings/skills/actions", () => ({
	assignSkillToEmployee: vi.fn(),
	removeSkillFromEmployee: vi.fn(),
}));
vi.mock("@/lib/query/use-skills", () => ({
	useEmployeeSkills: () => ({ data: skills.rows, isLoading: false }),
	useOrganizationSkills: () => ({ data: [], isLoading: false }),
	useSkillExpiryWindow: () => ({ data: { today: "2026-10-13", expiringSoonDays: 30 } }),
	useUpdateEmployeeSkillExpiry: () => ({ mutateAsync: vi.fn() }),
}));

function employeeSkill(
	name: string,
	overrides: Partial<EmployeeSkillWithDetails> = {},
): EmployeeSkillWithDetails {
	return {
		id: `es-${name}`,
		employeeId: "employee-1",
		skillId: `skill-${name}`,
		expiresAt: "2028-03-31",
		notes: null,
		assignedBy: "user-1",
		assignedAt: new Date("2026-01-01T00:00:00Z"),
		certificateOnFile: false,
		expiryDateFromCertificate: false,
		skill: {
			id: `skill-${name}`,
			organizationId: "org-1",
			name,
			description: null,
			category: "certification",
			customCategoryName: null,
			requiresExpiry: true,
			isActive: true,
			createdAt: new Date("2026-01-01T00:00:00Z"),
			createdBy: "user-1",
			updatedAt: new Date("2026-01-01T00:00:00Z"),
			updatedBy: null,
		},
		...overrides,
	} as EmployeeSkillWithDetails;
}

function renderCard(rows: EmployeeSkillWithDetails[]) {
	skills.rows = rows;
	render(
		<QueryClientProvider client={new QueryClient()}>
			<EmployeeSkillsCard employeeId="employee-1" organizationId="org-1" canManageSkills />
		</QueryClientProvider>,
	);
}

describe("EmployeeSkillsCard while skill certificates set the date (#1145)", () => {
	it("shows that a certificate sets the date and offers no date edit", () => {
		renderCard([
			employeeSkill("Forklift licence", {
				certificateOnFile: true,
				expiryDateFromCertificate: true,
			}),
			employeeSkill("First aid"),
		]);

		expect(
			screen.getByText("A skill certificate in the personnel file sets this date."),
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Edit expiry date of Forklift licence" }),
		).toBeNull();
		expect(screen.getByRole("button", { name: "Edit expiry date of First aid" })).toBeTruthy();
	});
});
