import { describe, expect, it } from "vitest";
import { buildVisibleManagedEmployees, canUseTeamPage } from "./team-members-data";

const user = {
	id: "user-1",
	firstName: "Ada",
	lastName: "Lovelace",
	name: "Ada Lovelace",
	email: "ada@example.com",
	image: null,
};

describe("team action helpers", () => {
	it("allows only managers and admins to use team actions", () => {
		expect(canUseTeamPage("employee")).toBe(false);
		expect(canUseTeamPage("manager")).toBe(true);
		expect(canUseTeamPage("admin")).toBe(true);
	});

	it("includes the current employee and marks them as current user", () => {
		const employees = buildVisibleManagedEmployees({
			currentEmployee: {
				id: "manager-1",
				userId: "user-1",
				organizationId: "org-1",
				teamId: null,
				firstName: "Ada",
				lastName: "Lovelace",
				pronouns: null,
				position: "Manager",
				role: "manager",
				isActive: true,
				team: null,
				user,
			},
			managedRecords: [],
			balances: new Map(),
		});

		expect(employees).toHaveLength(1);
		expect(employees[0]).toMatchObject({ id: "manager-1", isCurrentUser: true });
	});

	it("filters managed records to the current organization and deduplicates self", () => {
		const balances = new Map([
			[
				"employee-1",
				{
					year: 2026,
					actualMinutes: 600,
					expectedMinutes: 480,
					absenceAdjustedMinutes: 0,
					balanceMinutes: 120,
					calculatedAt: new Date("2026-05-18T00:00:00.000Z"),
				},
			],
		]);
		const employees = buildVisibleManagedEmployees({
			currentEmployee: {
				id: "manager-1",
				userId: "user-1",
				organizationId: "org-1",
				teamId: null,
				firstName: "Ada",
				lastName: "Lovelace",
				pronouns: null,
				position: "Manager",
				role: "manager",
				isActive: true,
				team: null,
				user,
			},
			managedRecords: [
				{
					isPrimary: false,
					employee: {
						id: "manager-1",
						userId: "user-1",
						organizationId: "org-1",
						teamId: null,
						firstName: "Ada",
						lastName: "Lovelace",
						pronouns: null,
						position: "Manager",
						role: "manager",
						isActive: true,
						user,
						team: null,
					},
				},
				{
					isPrimary: true,
					employee: {
						id: "employee-1",
						userId: "user-2",
						organizationId: "org-1",
						teamId: "team-1",
						firstName: "Grace",
						lastName: "Hopper",
						pronouns: null,
						position: "Engineer",
						role: "employee",
						isActive: true,
						user: {
							...user,
							id: "user-2",
							email: "grace@example.com",
							name: "Grace Hopper",
						},
						team: { id: "team-1", name: "Engineering" },
					},
				},
				{
					isPrimary: true,
					employee: {
						id: "employee-2",
						userId: "user-3",
						organizationId: "org-2",
						teamId: null,
						firstName: "Other",
						lastName: "Org",
						pronouns: null,
						position: null,
						role: "employee",
						isActive: true,
						user: {
							...user,
							id: "user-3",
							email: "other@example.com",
							name: "Other Org",
						},
						team: null,
					},
				},
			],
			balances,
		});

		expect(employees.map((employee) => employee.id)).toEqual(["manager-1", "employee-1"]);
		expect(employees[1]?.timeBalance?.balanceMinutes).toBe(120);
	});
});
