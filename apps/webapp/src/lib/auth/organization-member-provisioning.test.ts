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
		const updateReturning = vi.fn().mockResolvedValue([{ id: "employee-existing", isActive: true }]);
		const where = vi.fn(() => ({ returning: updateReturning }));
		const set = vi.fn(() => ({ where }));
		const insert = vi.fn(() => ({ values }));
		const update = vi.fn(() => ({ set }));
		const findFirst = vi.fn().mockResolvedValue(existingEmployee);
		const memberFindMany = vi.fn().mockResolvedValue([]);
		const employeeFindMany = vi.fn().mockResolvedValue([]);

		const db = {
			query: {
				member: { findMany: memberFindMany },
				employee: { findFirst, findMany: employeeFindMany },
			},
			insert,
			update,
		} as unknown as ProvisioningDb;

		return {
			db,
			findFirst,
			insert,
			values,
			returning,
			update,
			set,
			updateReturning,
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
			teamId: null,
		});
	});

	it("sets targetTeamId when creating a new employee", async () => {
		const { db, values } = createDbMock();

		await ensureEmployeeForOrganizationMember(db, {
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			targetTeamId: "team-1",
		});

		expect(values).toHaveBeenCalledWith({
			userId: "user-1",
			organizationId: "org-1",
			role: "employee",
			isActive: true,
			teamId: "team-1",
		});
	});

	it("does not move an existing active employee to a new invite target team", async () => {
		const existingEmployee = {
			id: "employee-existing",
			userId: "user-1",
			organizationId: "org-1",
			teamId: "team-existing",
			isActive: true,
		};
		const { db, update } = createDbMock(existingEmployee);

		const result = await ensureEmployeeForOrganizationMember(db, {
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			targetTeamId: "team-new",
		});

		expect(result).toBe(existingEmployee);
		expect(update).not.toHaveBeenCalled();
	});

	it("reactivates an inactive employee without a team using targetTeamId", async () => {
		const { db, set, updateReturning } = createDbMock({
			id: "employee-existing",
			userId: "user-1",
			organizationId: "org-1",
			teamId: null,
			isActive: false,
		});
		updateReturning.mockResolvedValue([
			{ id: "employee-existing", isActive: true, teamId: "team-1" },
		]);

		await ensureEmployeeForOrganizationMember(db, {
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			targetTeamId: "team-1",
		});

		expect(set).toHaveBeenCalledWith({
			isActive: true,
			teamId: "team-1",
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
			teamId: null,
		});
	});
});
