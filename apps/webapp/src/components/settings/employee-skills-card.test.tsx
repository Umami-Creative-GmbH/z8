/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeSkillWithDetails } from "@/lib/effect/services/skill.service";
import { EmployeeSkillsCard } from "./employee-skills-card";

const { assignSkillToEmployeeMock, removeSkillFromEmployeeMock } = vi.hoisted(() => ({
	assignSkillToEmployeeMock: vi.fn(),
	removeSkillFromEmployeeMock: vi.fn(),
}));

const employeeSkill = {
	id: "employee-skill-1",
	employeeId: "employee-1",
	skillId: "skill-1",
	status: "active",
	assignedBy: "manager-1",
	assignedAt: new Date("2026-01-01T00:00:00Z"),
	issuedAt: new Date("2026-01-15T00:00:00Z"),
	expiresAt: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
	renewedAt: null,
	renewedBy: null,
	issuer: "Safety Council With A Very Long Issuer Name",
	certificateNumber: "CERT-VERY-LONG-1234567890",
	notes: null,
	createdAt: new Date("2026-01-01T00:00:00Z"),
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
} satisfies EmployeeSkillWithDetails;

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
		useMutation: (options: {
			mutationFn: (input: unknown) => Promise<unknown>;
			onSuccess?: () => void;
		}) => ({
			mutate: async (input: unknown) => {
				await options.mutationFn(input);
				options.onSuccess?.();
			},
			isPending: false,
		}),
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
	assignSkillToEmployee: assignSkillToEmployeeMock,
	removeSkillFromEmployee: removeSkillFromEmployeeMock,
}));

vi.mock("@/lib/query/use-skills", () => ({
	useEmployeeSkills: () => ({ data: [employeeSkill], isLoading: false }),
	useOrganizationSkills: () => ({ data: [availableSkill], isLoading: false }),
}));

describe("EmployeeSkillsCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		assignSkillToEmployeeMock.mockResolvedValue({
			success: true,
			data: { id: "employee-skill-2" },
		});
		removeSkillFromEmployeeMock.mockResolvedValue({ success: true });
	});

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

	it("submits assignment dates as UTC date-only values", async () => {
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
		fireEvent.click(screen.getByRole("button", { name: "Assign" }));

		await waitFor(() => {
			expect(assignSkillToEmployeeMock).toHaveBeenCalledWith(
				expect.objectContaining({
					issuedAt: new Date("2026-01-15T00:00:00.000Z"),
					expiresAt: new Date("2027-01-15T00:00:00.000Z"),
				}),
			);
		});
	});

	it("requires an expiry date for skills that require expiry", async () => {
		render(<EmployeeSkillsCard employeeId="employee-1" organizationId="org-1" canManageSkills />);

		fireEvent.click(screen.getByRole("button", { name: "Assign Skill" }));
		fireEvent.click(screen.getByLabelText("Skill *"));
		fireEvent.click(screen.getByRole("option", { name: /Crane Operator/ }));
		fireEvent.click(screen.getByRole("button", { name: "Assign" }));

		expect(await screen.findByText("Expiry date is required for this skill")).toBeTruthy();
		expect(assignSkillToEmployeeMock).not.toHaveBeenCalled();
	});

	it("trims optional qualification metadata before assigning a skill", async () => {
		render(<EmployeeSkillsCard employeeId="employee-1" organizationId="org-1" canManageSkills />);

		fireEvent.click(screen.getByRole("button", { name: "Assign Skill" }));
		fireEvent.click(screen.getByLabelText("Skill *"));
		fireEvent.click(screen.getByRole("option", { name: /Crane Operator/ }));
		fireEvent.change(screen.getByLabelText("Expiry Date *"), {
			target: { value: "2027-01-15" },
		});
		fireEvent.change(screen.getByLabelText("Issuer"), { target: { value: "  Safety Council  " } });
		fireEvent.change(screen.getByLabelText("Certificate Number"), {
			target: { value: "  CERT-12345  " },
		});
		fireEvent.change(screen.getByLabelText("Notes"), {
			target: { value: "  Crane operations  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Assign" }));

		await waitFor(() => {
			expect(assignSkillToEmployeeMock).toHaveBeenCalledWith(
				expect.objectContaining({
					issuer: "Safety Council",
					certificateNumber: "CERT-12345",
					notes: "Crane operations",
				}),
			);
		});
	});
});
