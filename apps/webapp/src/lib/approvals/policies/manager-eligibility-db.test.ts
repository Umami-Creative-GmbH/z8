import { describe, expect, it, vi } from "vitest";
import { getEligibleApprovalScopesForManager } from "./manager-eligibility-db";

function createPgError(code: string) {
	return Object.assign(new Error(`Postgres error ${code}`), { code });
}

describe("getEligibleApprovalScopesForManager", () => {
	it("falls back to direct approval visibility when team eligibility schema is not migrated", async () => {
		const db = {
			query: {
				employee: {
					findMany: vi.fn(async () => [
						{ id: "requester-1", organizationId: "org-1", isActive: true, role: "employee" },
					]),
				},
				employeeManagers: {
					findMany: vi.fn(async () => []),
				},
				teamMembership: {
					findMany: vi.fn(async () => {
						throw createPgError("42P01");
					}),
				},
				team: {
					findMany: vi.fn(async () => []),
				},
			},
		};

		await expect(
			getEligibleApprovalScopesForManager({
				db,
				managerEmployeeId: "manager-1",
				organizationId: "org-1",
			}),
		).resolves.toEqual([]);
	});
});
