/* @vitest-environment jsdom */

import type { ColumnDef } from "@tanstack/react-table";
import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import type { EmployeeWithRelations } from "./actions";
import { columns } from "./columns";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: ({ name }: { name?: string | null }) => <span data-avatar-name={name ?? ""} />,
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

function renderEmployeeCell(employee: EmployeeWithRelations) {
	const employeeColumn = columns[0] as ColumnDef<EmployeeWithRelations>;
	const cell = employeeColumn.cell;

	if (typeof cell !== "function") throw new Error("Employee cell is not renderable");

	render(cell({ row: { original: employee } } as Parameters<typeof cell>[0]) as React.ReactElement);
}

function createEmployee(overrides: Partial<EmployeeWithRelations> = {}): EmployeeWithRelations {
	return {
		id: "emp_1",
		userId: "user_1",
		organizationId: "org_1",
		firstName: "Structured",
		lastName: "Name",
		pronouns: null,
		position: null,
		role: "employee",
		isActive: true,
		teamId: null,
		contractType: "fixed",
		gender: null,
		employeeNumber: null,
		phone: null,
		emergencyContact: null,
		startDate: null,
		endDate: null,
		createdAt: new Date("2024-01-01T00:00:00Z"),
		updatedAt: new Date("2024-01-01T00:00:00Z"),
		user: {
			id: "user_1",
			name: "Directory Name",
			email: "directory@example.com",
			image: null,
		} as EmployeeWithRelations["user"],
		team: null,
		...overrides,
	} as EmployeeWithRelations;
}

describe("employee directory columns", () => {
	it("preserves the user name when pronouns are absent", () => {
		renderEmployeeCell(createEmployee());

		expect(screen.getByText("Directory Name")).toBeTruthy();
		expect(screen.queryByText("Structured Name")).toBeNull();
		expect(screen.getByText("", { selector: '[data-avatar-name="Directory Name"]' })).toBeTruthy();
	});

	it("appends pronouns to the user name when present", () => {
		renderEmployeeCell(createEmployee({ pronouns: "they/them" }));

		expect(screen.getByText("Directory Name (they/them)")).toBeTruthy();
		expect(
			screen.getByText("", { selector: '[data-avatar-name="Directory Name (they/them)"]' }),
		).toBeTruthy();
	});
});
