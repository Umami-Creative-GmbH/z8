import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { employee, employeeInvitationDraft } from "@/db/schema";
import {
	ensureEmployeeForOrganizationMember,
	ensureEmployeeProfilesForOrganizationMembers,
} from "./organization-member-provisioning";

const loggerWarn = vi.hoisted(() => vi.fn());

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ warn: loggerWarn }),
}));

type ProvisioningDb = Parameters<typeof ensureEmployeeForOrganizationMember>[0];

describe("ensureEmployeeForOrganizationMember", () => {
	function createDbMock(existingEmployee: unknown = null) {
		const events: string[] = [];
		const returning = vi.fn().mockResolvedValue([{ id: "employee-1" }]);
		const values = vi.fn(() => ({ returning }));
		const updateReturning = vi
			.fn()
			.mockResolvedValue([{ id: "employee-existing", isActive: true }]);
		const where = vi.fn(() => ({ returning: updateReturning }));
		const set = vi.fn(() => ({ where }));
		const insert = vi.fn((table) => {
			if (table === employee) events.push("employee-write");
			return { values };
		});
		const update = vi.fn(() => ({ set }));
		const findFirst = vi.fn(async () => {
			events.push("employee-read");
			return existingEmployee;
		});
		const draftFindFirst = vi.fn(async () => {
			events.push("draft-read");
			return null;
		});
		const userFindFirst = vi
			.fn()
			.mockResolvedValue({ email: " Invitee@Example.COM " });
		const execute = vi.fn(async () => {
			events.push("identity-lock");
		});
		const teamPermissionsFindFirst = vi.fn().mockResolvedValue(null);
		const memberFindMany = vi.fn().mockResolvedValue([]);
		const employeeFindMany = vi.fn().mockResolvedValue([]);

		const db = {
			query: {
				member: { findMany: memberFindMany },
				employee: { findFirst, findMany: employeeFindMany },
				employeeInvitationDraft: { findFirst: draftFindFirst },
				teamPermissions: { findFirst: teamPermissionsFindFirst },
				user: { findFirst: userFindFirst },
			},
			execute,
			insert,
			update,
		} as unknown as ProvisioningDb & { transaction: ReturnType<typeof vi.fn> };
		db.transaction = vi.fn(async (run) => run(db));

		return {
			db,
			findFirst,
			draftFindFirst,
			userFindFirst,
			execute,
			events,
			transaction: db.transaction,
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
			mode: "membershipAccepted",
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
			mode: "membershipAccepted",
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
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			targetTeamId: "team-new",
		});

		expect(result).toBe(existingEmployee);
		expect(update).not.toHaveBeenCalled();
	});

	it("reactivates an inactive employee without a draft without assigning a target team", async () => {
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
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			targetTeamId: "team-1",
		});

		expect(set).toHaveBeenCalledWith({ isActive: true });
	});

	it("reactivates an inactive admin employee without a team and grants org-wide team permissions", async () => {
		const { db, set, updateReturning, teamPermissionsFindFirst, values } =
			createDbMock({
				id: "employee-existing",
				userId: "user-1",
				organizationId: "org-1",
				teamId: null,
				isActive: false,
			});
		updateReturning.mockResolvedValue([
			{
				id: "employee-existing",
				isActive: true,
				teamId: "team-1",
				role: "admin",
			},
		]);

		await ensureEmployeeForOrganizationMember(db, {
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "admin",
			targetTeamId: "team-1",
		});

		expect(set).toHaveBeenCalledWith({
			isActive: true,
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

	it.each([
		"owner,admin",
		"member, admin",
	])("treats compound organization role %s as admin provisioning", async (memberRole) => {
		const { db, values } = createDbMock();

		await ensureEmployeeForOrganizationMember(db, {
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole,
		});

		expect(values).toHaveBeenCalledWith({
			userId: "user-1",
			organizationId: "org-1",
			role: "admin",
			isActive: true,
			teamId: null,
		});
		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "employee-1",
				organizationId: "org-1",
				canManageTeamMembers: true,
			}),
		);
	});

	it("does not create a duplicate employee profile", async () => {
		const { db, insert } = createDbMock({ id: "employee-existing" });

		await ensureEmployeeForOrganizationMember(db, {
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
		});

		expect(insert).not.toHaveBeenCalled();
	});

	it("locks normalized organization identity before draft and employee reads or writes", async () => {
		const { db, draftFindFirst, events, execute, transaction, userFindFirst } =
			createDbMock();

		await ensureEmployeeForOrganizationMember(db, {
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-1",
		});

		expect(transaction).toHaveBeenCalledOnce();
		expect(userFindFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				columns: { email: true },
				where: expect.anything(),
			}),
		);
		expect(events).toEqual([
			"identity-lock",
			"draft-read",
			"draft-read",
			"employee-read",
			"employee-write",
		]);
		expect(draftFindFirst).toHaveBeenCalledTimes(2);
		const lockQuery = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0]);
		expect(lockQuery.params).toEqual(["org-1", "invitee@example.com"]);
	});

	it("observes a concurrent direct employee after waiting for the shared identity lock", async () => {
		const concurrentEmployee = {
			id: "employee-concurrent",
			userId: "user-1",
			organizationId: "org-1",
			teamId: null,
			isActive: true,
		};
		const { db, events, execute, findFirst, insert } = createDbMock();
		execute.mockImplementation(async () => {
			events.push("identity-lock");
			findFirst.mockImplementation(async () => {
				events.push("employee-read");
				return concurrentEmployee;
			});
		});

		const result = await ensureEmployeeForOrganizationMember(db, {
			mode: "reconcile",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
		});

		expect(result).toBe(concurrentEmployee);
		expect(insert).not.toHaveBeenCalledWith(employee);
		expect(events.indexOf("identity-lock")).toBeLessThan(
			events.indexOf("employee-read"),
		);
	});

	it("returns an inactive employee unchanged during reconciliation without permission side effects", async () => {
		const existingEmployee = {
			id: "employee-existing",
			userId: "user-1",
			organizationId: "org-1",
			teamId: null,
			isActive: false,
		};
		const { db, insert, teamPermissionsFindFirst, update } =
			createDbMock(existingEmployee);

		const result = await ensureEmployeeForOrganizationMember(db, {
			mode: "reconcile",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "admin",
		});

		expect(result).toBe(existingEmployee);
		expect(update).not.toHaveBeenCalled();
		expect(teamPermissionsFindFirst).not.toHaveBeenCalled();
		expect(insert).not.toHaveBeenCalled();
	});

	it("preserves established employee data when reactivating without a draft", async () => {
		const { db, set } = createDbMock({
			id: "employee-existing",
			userId: "user-1",
			organizationId: "org-1",
			teamId: "team-old",
			role: "manager",
			firstName: "Historical",
			lastName: "Person",
			position: "Principal",
			employeeNumber: "E-OLD",
			contractType: "hourly",
			currentHourlyRate: "75.00",
			isActive: false,
		});

		await ensureEmployeeForOrganizationMember(db, {
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			targetTeamId: "team-new",
		});

		expect(set).toHaveBeenCalledWith({ isActive: true });
	});

	it("does not duplicate an employee when acceptance is followed by reconciliation", async () => {
		const { db, findFirst, insert } = createDbMock();
		findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
			id: "employee-created",
			userId: "user-1",
			organizationId: "org-1",
			teamId: null,
			isActive: true,
		});

		await ensureEmployeeForOrganizationMember(db, {
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
		});
		await ensureEmployeeForOrganizationMember(db, {
			mode: "reconcile",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
		});

		expect(insert).toHaveBeenCalledOnce();
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
	const events: string[] = [];
	const execute = vi.fn().mockResolvedValue(undefined);
	const returning = vi.fn(async () => {
		events.push("employee-provisioned");
		return [
			{ id: "employee-created", organizationId: "org-1", isActive: true },
		];
	});
	const values = vi.fn(() => ({ returning }));
	const insert = vi.fn(() => ({ values }));
	const updateReturning = vi.fn(async () => {
		events.push("employee-provisioned");
		return [
			{ id: "employee-existing", organizationId: "org-1", isActive: true },
		];
	});
	const updateWhere = vi.fn(() => ({ returning: updateReturning }));
	const set = vi.fn(() => ({ where: updateWhere }));
	const update = vi.fn(() => ({ set }));
	const deleteWhere = vi.fn(async () => {
		events.push(`cleanup-committed:${transactionState.committed}`);
		events.push("draft-deleted");
	});
	const deleteDraft = vi.fn(() => ({ where: deleteWhere }));
	const transactionState = { committed: false };
	const resolvedDraft = draft ? { id: "draft-1", ...draft } : null;
	const employeeFindFirst = vi.fn(async () => {
		events.push("employee-read");
		return existingEmployee;
	});

	const db = {
		execute,
		insert,
		update,
		delete: deleteDraft,
		values,
		returning,
		set,
		deleteWhere,
		events,
		transactionState,
		query: {
			employee: { findFirst: employeeFindFirst },
			employeeInvitationDraft: {
				findFirst: vi.fn().mockResolvedValue(resolvedDraft),
			},
			team: {
				findFirst: vi
					.fn()
					.mockResolvedValue(validTeam ? { id: "team-1" } : null),
			},
			teamPermissions: { findFirst: vi.fn().mockResolvedValue(null) },
			user: {
				findFirst: vi.fn().mockResolvedValue({ email: "invitee@example.com" }),
			},
		},
	};
	return Object.assign(db, {
		transaction: vi.fn(async (run) => {
			const result = await run(db);
			transactionState.committed = true;
			events.push("transaction-committed");
			return result;
		}),
	});
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

function compileDraftDelete(predicate: unknown) {
	return new PgDialect().sqlToQuery(
		sql`delete from ${employeeInvitationDraft} where ${predicate as any}`,
	);
}

function createReconciliationCleanupDbMock({
	deleteError,
}: {
	deleteError?: Error;
} = {}) {
	const deleteWhere = deleteError
		? vi.fn().mockRejectedValue(deleteError)
		: vi.fn().mockResolvedValue(undefined);
	const db = {
		query: {
			member: { findMany: vi.fn().mockResolvedValue([]) },
			employee: { findMany: vi.fn().mockResolvedValue([]) },
		},
		select: vi.fn(),
		delete: vi.fn(() => ({ where: deleteWhere })),
		deleteWhere,
	};
	return { db };
}

describe("ensureEmployeeForOrganizationMember invitation drafts", () => {
	it("deletes the accepted draft by draft and organization ID after creating an employee", async () => {
		const db = createInvitationDraftDbMock({
			draft: {
				id: "draft-accepted",
				invitationId: "invite-1",
				organizationId: "org-1",
				role: "employee",
			},
		});

		await ensureEmployeeForOrganizationMember(db as any, {
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-1",
		});

		expect(db.delete).toHaveBeenCalledWith(employeeInvitationDraft);
		const deleteQuery = compileDraftDelete(db.deleteWhere.mock.calls[0]?.[0]);
		expect(deleteQuery.sql).toContain(
			'delete from "employee_invitation_draft"',
		);
		expect(deleteQuery.sql).toContain(
			'"employee_invitation_draft"."organization_id"',
		);
		expect(deleteQuery.sql).toContain('"employee_invitation_draft"."id"');
		expect(deleteQuery.sql).toContain(
			'"invitation"."id" = "employee_invitation_draft"."invitation_id"',
		);
		expect(deleteQuery.sql).toContain('"invitation"."organization_id"');
		expect(deleteQuery.sql).toContain('"invitation"."status"');
		expect(deleteQuery.sql).toContain(
			'lower(btrim("user"."email")) = "employee_invitation_draft"."normalized_email"',
		);
		expect(deleteQuery.sql).toContain('"employee"."organization_id"');
		expect(deleteQuery.params).toEqual([
			"org-1",
			"draft-accepted",
			"org-1",
			"accepted",
			"org-1",
		]);
		expect(db.transactionState.committed).toBe(true);
		expect(db.events).toEqual([
			"employee-read",
			"employee-provisioned",
			"transaction-committed",
			"cleanup-committed:true",
			"draft-deleted",
		]);
	});

	it("deletes the accepted draft after explicitly reactivating an employee", async () => {
		const db = createInvitationDraftDbMock({
			existingEmployee: {
				id: "employee-existing",
				organizationId: "org-1",
				isActive: false,
			},
			draft: {
				id: "draft-accepted",
				invitationId: "invite-1",
				organizationId: "org-1",
				role: "employee",
			},
		});

		await ensureEmployeeForOrganizationMember(db as any, {
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-1",
		});

		expect(db.update).toHaveBeenCalledWith(employee);
		expect(db.delete).toHaveBeenCalledWith(employeeInvitationDraft);
		expect(db.events).toEqual([
			"employee-read",
			"employee-provisioned",
			"transaction-committed",
			"cleanup-committed:true",
			"draft-deleted",
		]);
	});

	it("retries draft deletion for an already-active employee without duplicate writes", async () => {
		const existingEmployee = {
			id: "employee-existing",
			organizationId: "org-1",
			isActive: true,
		};
		const db = createInvitationDraftDbMock({
			existingEmployee,
			draft: {
				id: "draft-accepted",
				invitationId: "invite-1",
				organizationId: "org-1",
				role: "employee",
			},
		});

		const result = await ensureEmployeeForOrganizationMember(db as any, {
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-1",
		});

		expect(result).toBe(existingEmployee);
		expect(db.insert).not.toHaveBeenCalled();
		expect(db.update).not.toHaveBeenCalled();
		expect(db.delete).toHaveBeenCalledWith(employeeInvitationDraft);
		expect(db.events).toEqual([
			"employee-read",
			"transaction-committed",
			"cleanup-committed:true",
			"draft-deleted",
		]);
	});

	it("never deletes invitation drafts during reconciliation", async () => {
		const db = createInvitationDraftDbMock({
			draft: {
				id: "draft-pending",
				invitationId: "invite-1",
				organizationId: "org-1",
				role: "employee",
			},
		});

		await ensureEmployeeForOrganizationMember(db as any, {
			mode: "reconcile",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-1",
		});

		expect(db.delete).not.toHaveBeenCalled();
	});

	it("keeps a newly provisioned employee and retries its draft after cleanup failure", async () => {
		loggerWarn.mockClear();
		const db = createInvitationDraftDbMock({
			draft: {
				id: "draft-accepted",
				invitationId: "invite-1",
				organizationId: "org-1",
				role: "employee",
			},
		});
		db.deleteWhere.mockRejectedValueOnce(new Error("draft delete failed"));

		const provisionedEmployee = await ensureEmployeeForOrganizationMember(
			db as any,
			{
				mode: "membershipAccepted",
				userId: "user-1",
				organizationId: "org-1",
				memberRole: "member",
				invitationId: "invite-1",
			},
		);

		expect(db.transaction).toHaveBeenCalledOnce();
		expect(db.transactionState.committed).toBe(true);
		expect(db.delete).toHaveBeenCalledWith(employeeInvitationDraft);
		expect(provisionedEmployee).toEqual({
			id: "employee-created",
			organizationId: "org-1",
			isActive: true,
		});
		expect(db.insert).toHaveBeenCalledOnce();
		expect(db.update).not.toHaveBeenCalled();
		expect(loggerWarn).toHaveBeenCalledWith(
			{
				operation: "consumeEmployeeInvitationDraft",
				organizationId: "org-1",
				draftId: "draft-accepted",
			},
			"Employee invitation draft cleanup failed",
		);

		db.query.employee.findFirst.mockResolvedValue(provisionedEmployee);
		const retryResult = await ensureEmployeeForOrganizationMember(db as any, {
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-1",
		});

		expect(retryResult).toBe(provisionedEmployee);
		expect(db.deleteWhere).toHaveBeenCalledTimes(2);
		expect(db.insert).toHaveBeenCalledOnce();
		expect(db.update).not.toHaveBeenCalled();
	});

	it("keeps a reactivated employee when accepted draft cleanup fails", async () => {
		loggerWarn.mockClear();
		const db = createInvitationDraftDbMock({
			existingEmployee: {
				id: "employee-existing",
				organizationId: "org-1",
				isActive: false,
			},
			draft: {
				id: "draft-accepted",
				invitationId: "invite-1",
				organizationId: "org-1",
				role: "employee",
			},
		});
		db.deleteWhere.mockRejectedValueOnce(
			new Error("contains invitee@example.com"),
		);

		const result = await ensureEmployeeForOrganizationMember(db as any, {
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-1",
		});

		expect(result).toEqual({
			id: "employee-existing",
			organizationId: "org-1",
			isActive: true,
		});
		expect(db.update).toHaveBeenCalledOnce();
		expect(db.transactionState.committed).toBe(true);
		expect(loggerWarn.mock.calls.flat()).not.toContainEqual(
			expect.objectContaining({
				message: expect.stringContaining("invitee@example.com"),
			}),
		);
		expect(loggerWarn).toHaveBeenCalledWith(
			{
				operation: "consumeEmployeeInvitationDraft",
				organizationId: "org-1",
				draftId: "draft-accepted",
			},
			"Employee invitation draft cleanup failed",
		);
	});

	it("does not delete a draft reattached to a pending invitation before cleanup", async () => {
		const model = {
			draft: {
				id: "draft-accepted",
				organizationId: "org-1",
				invitationId: "invite-accepted",
			},
			invitations: new Map([
				["invite-accepted", { organizationId: "org-1", status: "accepted" }],
				["invite-pending", { organizationId: "org-1", status: "pending" }],
			]),
			deleted: false,
		};
		const db = createInvitationDraftDbMock({
			existingEmployee: {
				id: "employee-existing",
				organizationId: "org-1",
				isActive: true,
			},
			draft: {
				id: model.draft.id,
				invitationId: model.draft.invitationId,
				organizationId: model.draft.organizationId,
				role: "employee",
			},
		});
		db.deleteWhere.mockImplementationOnce(async (predicate) => {
			model.draft.invitationId = "invite-pending";
			const query = compileDraftDelete(predicate);
			const linkedInvitation = model.invitations.get(model.draft.invitationId);
			const requiresAcceptedInvitation =
				query.sql.includes('"invitation"."status"') &&
				query.params.includes("accepted");
			if (
				!requiresAcceptedInvitation ||
				linkedInvitation?.status === "accepted"
			) {
				model.deleted = true;
			}
		});

		await ensureEmployeeForOrganizationMember(db as any, {
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-accepted",
		});

		expect(model.deleted).toBe(false);
	});

	it("reconciliation performs one conditional bulk delete without select or N-delete fanout", async () => {
		const { db } = createReconciliationCleanupDbMock();

		await ensureEmployeeProfilesForOrganizationMembers(db as any, "org-1");

		expect(db.select).not.toHaveBeenCalled();
		expect(db.delete).toHaveBeenCalledOnce();
		expect(db.deleteWhere).toHaveBeenCalledOnce();
		const deleteQuery = compileDraftDelete(db.deleteWhere.mock.calls[0]?.[0]);
		expect(deleteQuery.sql).toContain('"invitation"."status"');
		expect(deleteQuery.sql).toContain(
			'"employee_invitation_draft"."normalized_email"',
		);
		expect(deleteQuery.params).toEqual(["org-1", "org-1", "accepted", "org-1"]);
	});

	it("does not fail reconciliation when accepted draft cleanup fails", async () => {
		loggerWarn.mockClear();
		const { db } = createReconciliationCleanupDbMock({
			deleteError: new Error("private database details"),
		});

		await expect(
			ensureEmployeeProfilesForOrganizationMembers(db as any, "org-1"),
		).resolves.toBeUndefined();

		expect(loggerWarn).toHaveBeenCalledWith(
			{
				operation: "consumeEmployeeInvitationDraft",
				organizationId: "org-1",
				draftId: null,
			},
			"Employee invitation draft cleanup failed",
		);
		expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain(
			"private database details",
		);
	});

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
			mode: "membershipAccepted",
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

	it.each([
		["different invitation team", "team-1", "team-invitation", "team-1"],
		["cleared draft team", null, "team-invitation", null],
	] as const)("uses the draft team as authoritative with %s", async (_case, draftTeamId, invitationTeamId, expectedTeamId) => {
		const db = createInvitationDraftDbMock({
			draft: {
				invitationId: "invite-1",
				organizationId: "org-1",
				teamId: draftTeamId,
				role: "employee",
				contractType: "fixed",
			},
		});

		await ensureEmployeeForOrganizationMember(db as any, {
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-1",
			targetTeamId: invitationTeamId,
		});

		expect(db.values).toHaveBeenCalledWith(
			expect.objectContaining({ teamId: expectedTeamId }),
		);
	});

	it("falls back to the same organization and accepting email for a replacement invitation", async () => {
		const db = createInvitationDraftDbMock({
			draft: {
				id: "draft-stable",
				invitationId: "invite-old",
				organizationId: "org-1",
				teamId: "team-1",
				role: "manager",
				position: "Prepared Lead",
				contractType: "hourly",
				currentHourlyRate: "42.50",
			},
		});
		const stableDraft = await db.query.employeeInvitationDraft.findFirst();
		db.query.employeeInvitationDraft.findFirst.mockReset();
		db.query.employeeInvitationDraft.findFirst.mockImplementation(
			async (options) =>
				objectContainsValue(options.where, "invite-replacement")
					? null
					: stableDraft,
		);

		await ensureEmployeeForOrganizationMember(db as any, {
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-replacement",
		});

		expect(db.query.employeeInvitationDraft.findFirst).toHaveBeenCalledTimes(2);
		const exactQuery = new PgDialect().sqlToQuery(
			db.query.employeeInvitationDraft.findFirst.mock.calls[0]?.[0].where,
		);
		expect(exactQuery.params).toEqual(["org-1", "invite-replacement"]);
		const fallbackQuery = new PgDialect().sqlToQuery(
			db.query.employeeInvitationDraft.findFirst.mock.calls[1]?.[0].where,
		);
		expect(fallbackQuery.params).toEqual(["org-1", "invitee@example.com"]);
		expect(db.values).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				role: "manager",
				position: "Prepared Lead",
				contractType: "hourly",
				currentHourlyRate: "42.50",
			}),
		);
		expect(db.delete).toHaveBeenCalledWith(employeeInvitationDraft);
		const cleanupQuery = compileDraftDelete(db.deleteWhere.mock.calls[0]?.[0]);
		expect(cleanupQuery.sql).toContain('"employee_invitation_draft"."id"');
		expect(cleanupQuery.sql).toContain(
			'"employee_invitation_draft"."organization_id"',
		);
		expect(cleanupQuery.sql).toContain('"invitation"."status"');
		expect(cleanupQuery.sql).toContain('"invitation"."expires_at" <=');
		expect(cleanupQuery.params).toContain("draft-stable");
		expect(cleanupQuery.params).toContain("accepted");
		expect(cleanupQuery.params).toContain("canceled");
		expect(cleanupQuery.params).toContain("pending");
		expect(cleanupQuery.params).not.toContain("invite-replacement");
	});

	it("does not fall back to a draft from another organization or email", async () => {
		const db = createInvitationDraftDbMock();
		db.query.employeeInvitationDraft.findFirst.mockResolvedValue(null);

		await ensureEmployeeForOrganizationMember(db as any, {
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-replacement",
		});

		expect(db.query.employeeInvitationDraft.findFirst).toHaveBeenCalledTimes(2);
		const fallbackQuery = new PgDialect().sqlToQuery(
			db.query.employeeInvitationDraft.findFirst.mock.calls[1]?.[0].where,
		);
		expect(fallbackQuery.params).toEqual(["org-1", "invitee@example.com"]);
		expect(db.values).toHaveBeenCalledWith(
			expect.objectContaining({ role: "employee", teamId: null }),
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
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-1",
		});

		expect(db.values).toHaveBeenCalledWith(
			expect.objectContaining({ teamId: null }),
		);
	});

	it("keeps current behavior when no draft exists", async () => {
		const db = createInvitationDraftDbMock();

		await ensureEmployeeForOrganizationMember(db as any, {
			mode: "reconcile",
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
				teamId: "team-old",
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
			mode: "membershipAccepted",
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

	it("applies only non-null sparse draft values when reactivating an established employee", async () => {
		const db = createInvitationDraftDbMock({
			existingEmployee: {
				id: "employee-existing",
				isActive: false,
				teamId: "team-old",
				role: "manager",
				firstName: "Historical",
				lastName: "Person",
				position: "Principal",
				employeeNumber: "E-OLD",
				contractType: "hourly",
				currentHourlyRate: "75.00",
			},
			draft: {
				invitationId: "invite-1",
				organizationId: "org-1",
				teamId: null,
				role: "employee",
				firstName: null,
				lastName: undefined,
				position: "Lead",
				employeeNumber: null,
				gender: null,
				pronouns: undefined,
				birthday: null,
				startDate: undefined,
				endDate: null,
				contractType: "fixed",
				currentHourlyRate: null,
			},
		});

		await ensureEmployeeForOrganizationMember(db as any, {
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-1",
		});

		expect(db.set).toHaveBeenCalledWith({
			isActive: true,
			role: "employee",
			position: "Lead",
			contractType: "fixed",
		});
	});

	it("applies all populated draft values when reactivating", async () => {
		const birthday = new Date("1990-01-01T00:00:00.000Z");
		const startDate = new Date("2026-01-01T00:00:00.000Z");
		const endDate = new Date("2027-01-01T00:00:00.000Z");
		const db = createInvitationDraftDbMock({
			existingEmployee: {
				id: "employee-existing",
				isActive: false,
				teamId: "team-old",
			},
			draft: {
				invitationId: "invite-1",
				organizationId: "org-1",
				teamId: "team-1",
				role: "manager",
				firstName: "Ada",
				lastName: "Lovelace",
				gender: "other",
				pronouns: "they/them",
				birthday,
				position: "Lead",
				employeeNumber: "E-100",
				startDate,
				endDate,
				contractType: "hourly",
				currentHourlyRate: "42.50",
			},
		});

		await ensureEmployeeForOrganizationMember(db as any, {
			mode: "membershipAccepted",
			userId: "user-1",
			organizationId: "org-1",
			memberRole: "member",
			invitationId: "invite-1",
		});

		expect(db.set).toHaveBeenCalledWith({
			isActive: true,
			teamId: "team-1",
			role: "manager",
			firstName: "Ada",
			lastName: "Lovelace",
			gender: "other",
			pronouns: "they/them",
			birthday,
			position: "Lead",
			employeeNumber: "E-100",
			startDate,
			endDate,
			contractType: "hourly",
			currentHourlyRate: "42.50",
		});
	});

	it("ignores the accepted invitation target when a stable draft exists", async () => {
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
			objectContainsValue(options.where, "team-from-draft")
				? { id: "team-1" }
				: null,
		);

		await ensureEmployeeForOrganizationMember(db as any, {
			mode: "membershipAccepted",
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
		expect(
			objectContainsValue(
				db.query.team.findFirst.mock.calls[0]?.[0].where,
				"team-from-invitation",
			),
		).toBe(false);
		expect(db.values).toHaveBeenCalledWith(
			expect.objectContaining({
				teamId: "team-1",
			}),
		);
	});
});
