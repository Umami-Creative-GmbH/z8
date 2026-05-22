import { describe, expect, it, vi } from "vitest";

const { resolveCorrectionApprovalManager } = await import("./corrections");

function createManagerLinkDb(managerLinks: unknown[]) {
	return {
		query: {
			employee: {
				findMany: vi.fn(async () => [
					{ id: "employee-1", organizationId: "org-1", isActive: true, role: "employee" },
					{ id: "manager-1", organizationId: "org-1", isActive: true, role: "manager" },
				]),
			},
			employeeManagers: {
				findMany: vi.fn(async () => managerLinks),
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

describe("resolveCorrectionApprovalManager", () => {
	it("resolves the approver from primary manager links when the employee fixture omits managerId", async () => {
		const db = createManagerLinkDb([
			{ employeeId: "employee-1", managerId: "manager-1", isPrimary: true },
		]);

		await expect(
			resolveCorrectionApprovalManager({
				db,
				requesterEmployeeId: "employee-1",
				organizationId: "org-1",
			}),
		).resolves.toEqual({ ok: true, managerId: "manager-1" });
	});

	it("returns the existing no-manager correction validation decision", async () => {
		const db = createManagerLinkDb([]);

		await expect(
			resolveCorrectionApprovalManager({
				db,
				requesterEmployeeId: "employee-1",
				organizationId: "org-1",
			}),
		).resolves.toEqual({
			ok: false,
			message: "No manager assigned to approve corrections",
			field: "managerId",
		});
	});
});
