/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { EmployeeSkillWithDetails } from "@/lib/effect/services/skill.service";
import { MyQualificationsClient } from "./my-qualifications-client";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("./actions", () => ({
	submitMyQualificationRenewal: vi.fn(),
}));

const qualification = {
	id: "employee-skill-1",
	employeeId: "employee-1",
	skillId: "skill-1",
	status: "active",
	assignedBy: "user-1",
	assignedAt: new Date("2026-01-01T00:00:00Z"),
	issuedAt: null,
	expiresAt: null,
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
		category: "certification",
		customCategoryName: null,
		requiresExpiry: false,
		expiryWarningDays: 30,
		isActive: true,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		createdBy: "user-1",
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		updatedBy: null,
	},
} satisfies EmployeeSkillWithDetails;

function renderWithQueryClient(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

describe("MyQualificationsClient", () => {
	it("renders employee qualifications", () => {
		renderWithQueryClient(<MyQualificationsClient qualifications={[qualification]} />);

		expect(screen.getByText("My Qualifications")).toBeTruthy();
		expect(screen.getByText("Forklift License")).toBeTruthy();
	});
});
