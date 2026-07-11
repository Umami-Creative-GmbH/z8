import { describe, expect, it } from "vitest";
import { createClockingService } from "./clocking-service";

describe("clocking service", () => {
	it("derives the employee and organization from an approved active membership", async () => {
		const service = createClockingService({
			findActiveEmployee: async (userId, organizationId) =>
				userId === "user-1" && organizationId === "org-1"
					? { id: "employee-1", organizationId: "org-1" }
					: null,
			findApprovedMembership: async (userId, organizationId) =>
				userId === "user-1" && organizationId === "org-1",
		});

		await expect(service.requireActor({ userId: "user-1", activeOrganizationId: "org-1" })).resolves.toEqual({
			employee: { id: "employee-1", organizationId: "org-1" },
			organizationId: "org-1",
			userId: "user-1",
		});
	});

	it("rejects a session without an approved membership before resolving an employee", async () => {
		const findActiveEmployee = async () => ({ id: "employee-1", organizationId: "org-1" });
		const service = createClockingService({
			findActiveEmployee,
			findApprovedMembership: async () => false,
		});

		await expect(service.requireActor({ userId: "user-1", activeOrganizationId: "org-1" })).rejects.toMatchObject({
			code: "active_membership_required",
		});
	});

	it("does not accept a membership or employee from a different organization", async () => {
		const service = createClockingService({
			findActiveEmployee: async () => ({ id: "employee-org-2", organizationId: "org-2" }),
			findApprovedMembership: async () => true,
		});

		await expect(service.requireActor({ userId: "user-1", activeOrganizationId: "org-1" })).rejects.toMatchObject({
			code: "employee_required",
		});
	});
});
