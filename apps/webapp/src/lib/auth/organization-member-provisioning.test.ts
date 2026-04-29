import { describe, expect, it, vi } from "vitest";
import {
	ensureEmployeeForOrganizationMember,
	ensureEmployeeProfilesForOrganizationMembers,
} from "./organization-member-provisioning";

type ProvisioningDb = Parameters<typeof ensureEmployeeForOrganizationMember>[0];

describe("ensureEmployeeForOrganizationMember", () => {
	function createDbMock(existingEmployee: unknown = null) {
		const returning = vi.fn().mockResolvedValue([{ id: "employee-1" }]);
		const values = vi.fn(() => ({ returning }));
		const insert = vi.fn(() => ({ values }));
		const findFirst = vi.fn().mockResolvedValue(existingEmployee);
		const memberFindMany = vi.fn().mockResolvedValue([]);
		const employeeFindMany = vi.fn().mockResolvedValue([]);

		const db = {
			query: {
				member: { findMany: memberFindMany },
				employee: { findFirst, findMany: employeeFindMany },
			},
			insert,
		} as unknown as ProvisioningDb;

		return {
			db,
			findFirst,
			insert,
			values,
			returning,
			memberFindMany,
			employeeFindMany,
		};
	}

	it("creates an active employee profile for an accepted invited member", async () => {
		const { db, values } = createDbMock();

		await ensureEmployeeForOrganizationMember(db, {
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
		});

		expect(values).toHaveBeenCalledWith({
			userId: "user-1",
			organizationId: "org-1",
			role: "employee",
			isActive: true,
		});
	});

	it("does not create a duplicate employee profile", async () => {
		const { db, insert } = createDbMock({ id: "employee-existing" });

		await ensureEmployeeForOrganizationMember(db, {
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
		});

		expect(insert).not.toHaveBeenCalled();
	});

	it("creates missing employee profiles for approved organization members", async () => {
		const { db, memberFindMany, employeeFindMany, values } = createDbMock();
		memberFindMany.mockResolvedValue([
			{ userId: "user-1", organizationId: "org-1", role: "member" },
			{ userId: "user-2", organizationId: "org-1", role: "admin" },
		]);
		employeeFindMany.mockResolvedValue([{ userId: "user-1" }]);

		await ensureEmployeeProfilesForOrganizationMembers(db, "org-1");

		expect(values).toHaveBeenCalledWith({
			userId: "user-2",
			organizationId: "org-1",
			role: "admin",
			isActive: true,
		});
	});
});
