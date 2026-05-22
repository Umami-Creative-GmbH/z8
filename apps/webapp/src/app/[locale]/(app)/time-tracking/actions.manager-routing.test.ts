import { describe, expect, it, vi } from "vitest";

const { resolveTimeApprovalManagerId } = await import("./actions");

function createManagerLinkDb() {
	return {
		query: {
			employee: {
				findMany: vi.fn(async () => [
					{ id: "employee-1", organizationId: "org-1", isActive: true, role: "employee" },
					{ id: "manager-1", organizationId: "org-1", isActive: true, role: "manager" },
				]),
			},
			employeeManagers: {
				findMany: vi.fn(async () => [
					{ employeeId: "employee-1", managerId: "manager-1", isPrimary: true },
				]),
			},
			teamMembership: {
				findMany: vi.fn(async () => []),
			},
			team: {
				findMany: vi.fn(async () => []),
			},
		},
	};
}

describe("monolithic time approval manager routing", () => {
	it("resolves the clock-out approval manager from employeeManagers when employee.managerId is omitted", async () => {
		const db = createManagerLinkDb();

		await expect(
			resolveTimeApprovalManagerId({
				db,
				requiresApproval: true,
				requesterEmployeeId: "employee-1",
				organizationId: "org-1",
			}),
		).resolves.toBe("manager-1");
	});

	it("resolves the manual-entry approval manager from employeeManagers when employee.managerId is omitted", async () => {
		const db = createManagerLinkDb();

		await expect(
			resolveTimeApprovalManagerId({
				db,
				requiresApproval: true,
				requesterEmployeeId: "employee-1",
				organizationId: "org-1",
			}),
		).resolves.toBe("manager-1");
	});
});
