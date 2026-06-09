import { readFileSync } from "node:fs";
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
		const updateReturning = vi
			.fn()
			.mockResolvedValue([{ id: "employee-existing", isActive: true }]);
		const where = vi.fn(() => ({ returning: updateReturning }));
		const set = vi.fn(() => ({ where }));
		const insert = vi.fn(() => ({ values }));
		const update = vi.fn(() => ({ set }));
		const findFirst = vi.fn().mockResolvedValue(existingEmployee);
		const teamPermissionsFindFirst = vi.fn().mockResolvedValue(null);
		const memberFindMany = vi.fn().mockResolvedValue([]);
		const employeeFindMany = vi.fn().mockResolvedValue([]);

		const db = {
			query: {
				member: { findMany: memberFindMany },
				employee: { findFirst, findMany: employeeFindMany },
				teamPermissions: { findFirst: teamPermissionsFindFirst },
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
			where,
			updateReturning,
			teamPermissionsFindFirst,
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

	it("reactivates an inactive admin employee without a team and grants org-wide team permissions", async () => {
		const { db, set, updateReturning, teamPermissionsFindFirst, values } = createDbMock({
			id: "employee-existing",
			userId: "user-1",
			organizationId: "org-1",
			teamId: null,
			isActive: false,
		});
		updateReturning.mockResolvedValue([
			{ id: "employee-existing", isActive: true, teamId: "team-1", role: "admin" },
		]);

		await ensureEmployeeForOrganizationMember(db, {
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "admin",
			targetTeamId: "team-1",
		});

		expect(set).toHaveBeenCalledWith({
			isActive: true,
			teamId: "team-1",
			role: "admin",
		});
		expect(teamPermissionsFindFirst).toHaveBeenCalledOnce();
		expect(values).toHaveBeenCalledWith({
			employeeId: "employee-existing",
			organizationId: "org-1",
			teamId: null,
			canCreateTeams: true,
			canManageTeamMembers: true,
			canManageTeamSettings: true,
			canApproveTeamRequests: true,
			grantedBy: "employee-existing",
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

function createInvitationDraftDbMock({
	existingEmployee = null,
	draft = null,
	validTeam = true,
} = {}) {
	const returning = vi
		.fn()
		.mockResolvedValue([{ id: "employee-created", organizationId: "org-1" }]);
	const values = vi.fn(() => ({ returning }));
	const insert = vi.fn(() => ({ values }));
	const updateReturning = vi
		.fn()
		.mockResolvedValue([{ id: "employee-existing", organizationId: "org-1" }]);
	const updateWhere = vi.fn(() => ({ returning: updateReturning }));
	const set = vi.fn(() => ({ where: updateWhere }));
	const update = vi.fn(() => ({ set }));

	return {
		insert,
		update,
		values,
		set,
		query: {
			employee: { findFirst: vi.fn().mockResolvedValue(existingEmployee) },
			employeeInvitationDraft: { findFirst: vi.fn().mockResolvedValue(draft) },
			team: { findFirst: vi.fn().mockResolvedValue(validTeam ? { id: "team-1" } : null) },
			teamPermissions: { findFirst: vi.fn().mockResolvedValue(null) },
		},
	};
}

function objectContainsValue(
	value: unknown,
	expected: string,
	seen = new WeakSet<object>(),
): boolean {
	if (value === expected) return true;
	if (!value || typeof value !== "object") return false;
	if (seen.has(value)) return false;
	seen.add(value);
	return Object.values(value).some((nestedValue) =>
		objectContainsValue(nestedValue, expected, seen),
	);
}

describe("ensureEmployeeForOrganizationMember invitation drafts", () => {
	it("normalizes missing invitation drafts to null", () => {
		const source = readFileSync(
			new URL("./organization-member-provisioning.ts", import.meta.url),
			"utf8",
		);
		expect(source).toContain("?? null");
	});

	it("applies invitation draft fields when creating an employee", async () => {
		const db = createInvitationDraftDbMock({
			draft: {
				invitationId: "invite-1",
				organizationId: "org-1",
				teamId: "team-1",
				role: "manager",
				firstName: "Ada",
				lastName: "Lovelace",
				gender: "other",
				pronouns: "they/them",
				birthday: new Date("1990-01-01T00:00:00.000Z"),
				position: "Lead",
				employeeNumber: "E-100",
				startDate: new Date("2026-01-01T00:00:00.000Z"),
				endDate: null,
				contractType: "hourly",
				currentHourlyRate: "42.50",
			},
		});

		await ensureEmployeeForOrganizationMember(db as any, {
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-1",
		});

		expect(db.values).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-1",
				organizationId: "org-1",
				teamId: "team-1",
				role: "manager",
				firstName: "Ada",
				lastName: "Lovelace",
				gender: "other",
				pronouns: "they/them",
				position: "Lead",
				employeeNumber: "E-100",
				contractType: "hourly",
				currentHourlyRate: "42.50",
			}),
		);
	});

	it("ignores a draft team that no longer belongs to the organization", async () => {
		const db = createInvitationDraftDbMock({
			draft: {
				invitationId: "invite-1",
				organizationId: "org-1",
				teamId: "deleted-team",
				role: "employee",
				contractType: "fixed",
			},
			validTeam: false,
		});

		await ensureEmployeeForOrganizationMember(db as any, {
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-1",
		});

		expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ teamId: null }));
	});

	it("keeps current behavior when no draft exists", async () => {
		const db = createInvitationDraftDbMock();

		await ensureEmployeeForOrganizationMember(db as any, {
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "admin",
		});

		expect(db.values).toHaveBeenCalledWith(
			expect.objectContaining({ role: "admin", teamId: null }),
		);
	});

	it("applies draft fields when reactivating an inactive placeholder employee", async () => {
		const db = createInvitationDraftDbMock({
			existingEmployee: {
				id: "employee-existing",
				isActive: false,
				teamId: null,
				role: "employee",
			},
			draft: {
				invitationId: "invite-1",
				organizationId: "org-1",
				teamId: "team-1",
				role: "manager",
				position: "Lead",
				contractType: "hourly",
				currentHourlyRate: "42.50",
			},
		});

		await ensureEmployeeForOrganizationMember(db as any, {
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-1",
		});

		expect(db.set).toHaveBeenCalledWith(
			expect.objectContaining({
				isActive: true,
				teamId: "team-1",
				role: "manager",
				position: "Lead",
				contractType: "hourly",
				currentHourlyRate: "42.50",
			}),
		);
	});

	it("prefers the accepted invitation target team over a stale draft team", async () => {
		const db = createInvitationDraftDbMock({
			draft: {
				invitationId: "invite-1",
				organizationId: "org-1",
				teamId: "team-from-draft",
				role: "employee",
				contractType: "fixed",
			},
		});
		db.query.team.findFirst.mockImplementation(async (options) =>
			objectContainsValue(options.where, "team-from-invitation") ? { id: "team-1" } : null,
		);

		await ensureEmployeeForOrganizationMember(db as any, {
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-1",
			targetTeamId: "team-from-invitation",
		});

		expect(db.query.team.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.anything(),
				columns: { id: true },
			}),
		);
		expect(db.values).toHaveBeenCalledWith(
			expect.objectContaining({
				teamId: "team-1",
			}),
		);
	});
});
