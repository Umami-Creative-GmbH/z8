import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { employee } from "@/db/schema";
import { resolveProjectReportAccess } from "./project-report-access-loader";

type EmployeeRow = typeof employee.$inferSelect;

function makeEmployee(role: "admin" | "manager" | "employee"): EmployeeRow {
	return {
		id: "emp-1",
		organizationId: "org-1",
		role,
	} as EmployeeRow;
}

describe("resolveProjectReportAccess (#1954)", () => {
	it("denies access and skips viewer query when projectsEnabled is false", async () => {
		const loadViewer = vi.fn();
		const result = await resolveProjectReportAccess({
			requireAuth: async () =>
				({
					user: { id: "user-1" },
					session: { activeOrganizationId: "org-1" },
					employee: { id: "emp-1" },
				}) as never,
			findOrganizationProjectsEnabled: async () => false,
			loadActiveEmployee: async () => makeEmployee("admin"),
			loadViewer,
		});

		expect(result).toEqual({
			employee: makeEmployee("admin"),
			projectsEnabled: false,
			canViewProjectReports: false,
		});
		expect(loadViewer).not.toHaveBeenCalled();
	});

	it("allows a project manager below the manager tier when projects are enabled", async () => {
		const loadViewer = vi.fn(async () => ({
			employeeRole: "employee" as const,
			isOrganizationAdmin: false,
			managedProjectIds: new Set(["proj-1"]),
		}));

		const result = await resolveProjectReportAccess({
			requireAuth: async () =>
				({
					user: { id: "user-1" },
					session: { activeOrganizationId: "org-1" },
					employee: { id: "emp-1" },
				}) as never,
			findOrganizationProjectsEnabled: async () => true,
			loadActiveEmployee: async () => makeEmployee("employee"),
			loadViewer,
		});

		expect(result?.projectsEnabled).toBe(true);
		expect(result?.canViewProjectReports).toBe(true);
		expect(loadViewer).toHaveBeenCalledTimes(1);
	});

	it("allows an org admin with an employee record when projects are enabled", async () => {
		const loadViewer = vi.fn(async () => ({
			employeeRole: "employee" as const,
			isOrganizationAdmin: true,
			managedProjectIds: new Set<string>(),
		}));

		const result = await resolveProjectReportAccess({
			requireAuth: async () =>
				({
					user: { id: "user-1" },
					session: { activeOrganizationId: "org-1" },
					employee: { id: "emp-1" },
				}) as never,
			findOrganizationProjectsEnabled: async () => true,
			loadActiveEmployee: async () => makeEmployee("employee"),
			loadViewer,
		});

		expect(result?.projectsEnabled).toBe(true);
		expect(result?.canViewProjectReports).toBe(true);
	});

	it("denies a plain employee who manages no projects when projects are enabled", async () => {
		const loadViewer = vi.fn(async () => ({
			employeeRole: "employee" as const,
			isOrganizationAdmin: false,
			managedProjectIds: new Set<string>(),
		}));

		const result = await resolveProjectReportAccess({
			requireAuth: async () =>
				({
					user: { id: "user-1" },
					session: { activeOrganizationId: "org-1" },
					employee: { id: "emp-1" },
				}) as never,
			findOrganizationProjectsEnabled: async () => true,
			loadActiveEmployee: async () => makeEmployee("employee"),
			loadViewer,
		});

		expect(result?.projectsEnabled).toBe(true);
		expect(result?.canViewProjectReports).toBe(false);
	});

	it("returns employee null when viewer has no employee record", async () => {
		const loadViewer = vi.fn();
		const result = await resolveProjectReportAccess({
			requireAuth: async () =>
				({
					user: { id: "user-1" },
					session: { activeOrganizationId: "org-1" },
					employee: null,
				}) as never,
			findOrganizationProjectsEnabled: async () => true,
			loadActiveEmployee: async () => null,
			loadViewer,
		});

		expect(result).toEqual({
			employee: null,
			projectsEnabled: true,
			canViewProjectReports: false,
		});
		expect(loadViewer).not.toHaveBeenCalled();
	});
});
