import { readFileSync } from "node:fs";
import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { AuthorizationError, DatabaseError } from "@/lib/effect/errors";
import { toServerActionResult } from "@/lib/effect/result";

const mocks = vi.hoisted(() => ({
	authRemoveMember: vi.fn(),
	completeRemovedMemberCleanup: vi.fn(),
	getEmployeeSettingsActorContext: vi.fn(),
	headers: vi.fn(),
	logAudit: vi.fn(),
	loggerWarn: vi.fn(),
	revalidateEmployeesCache: vi.fn(),
	revokeOrganizationActiveSessions: vi.fn(),
	runTracedEmployeeAction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: { api: { removeMember: mocks.authRemoveMember } },
}));

vi.mock("@/lib/auth/member-removal-cleanup", () => ({
	completeRemovedMemberCleanup: mocks.completeRemovedMemberCleanup,
}));

vi.mock("next/headers", () => ({
	headers: mocks.headers,
}));

vi.mock("@/lib/audit-logger", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/audit-logger")>()),
	logAudit: mocks.logAudit,
}));

vi.mock("@/lib/auth/organization-session-revocation", () => ({
	revokeOrganizationActiveSessions: mocks.revokeOrganizationActiveSessions,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: vi.fn(),
		info: vi.fn(),
		warn: mocks.loggerWarn,
	}),
}));

vi.mock("./employee-action-utils", async (importOriginal) => ({
	...(await importOriginal<typeof import("./employee-action-utils")>()),
	getEmployeeSettingsActorContext: mocks.getEmployeeSettingsActorContext,
	revalidateEmployeesCache: mocks.revalidateEmployeesCache,
	runTracedEmployeeAction: mocks.runTracedEmployeeAction,
}));

import {
	deactivateEmployeeAction,
	reactivateEmployeeAction,
	removeEmployeeAccessAction,
} from "./employee-lifecycle.actions";

const actorUserId = "actor-user";
const actorEmail = "owner@example.com";
const employeeId = "33333333-3333-4333-8333-333333333333";
const targetUserId = "target-user";
const organizationId = "org-1";
const targetMembershipId = "target-membership";

type LifecycleState = {
	accessTier?: "member" | "manager" | "orgAdmin";
	actorRole?: unknown;
	target?: {
		id: string;
		userId: string;
		organizationId: string;
		isActive: boolean;
	} | null;
	targetMembership?: { userId: string; role: string; status: string } | null;
	owners?: Array<{
		userId: string;
		role?: unknown;
		employeeIsActive: boolean | null;
	}>;
	revocationError?: Error;
	transactionError?: unknown;
};

function compilePredicate(table: unknown, predicate: unknown) {
	return new PgDialect().sqlToQuery(
		sql`select * from ${table as never} where ${predicate as SQL}`,
	);
}

function setup(state: LifecycleState = {}) {
	const events: string[] = [];
	const actorRole = state.actorRole ?? "owner";
	const target =
		state.target === undefined
			? { id: employeeId, userId: targetUserId, organizationId, isActive: true }
			: state.target;
	const targetMembership =
		state.targetMembership === undefined
			? { userId: targetUserId, role: "member", status: "approved" }
			: state.targetMembership;
	const findMember = vi
		.fn()
		.mockResolvedValueOnce({
			userId: actorUserId,
			role: actorRole,
			status: "approved",
		})
		.mockResolvedValueOnce(targetMembership);
	const findEmployee = vi.fn().mockResolvedValue(target);
	const lockFor = vi.fn().mockImplementation(async () => {
		events.push("organization-locked");
		return [{ id: organizationId }];
	});
	const lockWhere = vi.fn(() => ({ for: lockFor }));
	const ownerWhere = vi.fn().mockResolvedValue(
		state.owners ?? [
			{ userId: actorUserId, role: "owner", employeeIsActive: true },
			{ userId: targetUserId, role: "member", employeeIsActive: true },
		],
	);
	const leftJoin = vi.fn(() => ({ where: ownerWhere }));
	const from = vi
		.fn()
		.mockImplementationOnce(() => ({ where: lockWhere }))
		.mockImplementationOnce(() => ({ leftJoin }));
	const select = vi.fn(() => ({ from }));
	const returning = vi.fn().mockImplementation(async () => {
		events.push("employee-updated");
		return [{ id: employeeId }];
	});
	const updateWhere = vi.fn(() => ({ returning }));
	const updateSet = vi.fn(() => ({ where: updateWhere }));
	const update = vi.fn(() => ({ set: updateSet }));
	const transaction = vi.fn(async (run) => {
		if (state.transactionError) throw state.transactionError;
		const result = await run({
			query: {
				employee: { findFirst: findEmployee },
				member: { findFirst: findMember },
			},
			select,
			update,
		});
		events.push("transaction-committed");
		return result;
	});
	const dbService = {
		db: { transaction },
		query: vi.fn((_name: string, run: () => Promise<unknown>) =>
			Effect.tryPromise({
				try: run,
				catch: (cause) =>
					new DatabaseError({
						message: "Database operation failed",
						operation: "test",
						cause,
					}),
			}),
		),
	};

	mocks.getEmployeeSettingsActorContext.mockReturnValue(
		Effect.succeed({
			accessTier: state.accessTier ?? "orgAdmin",
			organizationId,
			session: { user: { id: actorUserId, email: actorEmail } },
			currentEmployee: null,
			dbService,
		}),
	);
	mocks.runTracedEmployeeAction.mockImplementation((options) =>
		Effect.runPromiseExit(options.execute({ setAttribute: vi.fn() })).then(
			toServerActionResult,
		),
	);
	mocks.logAudit.mockImplementation(async () => {
		events.push("audit-logged");
	});
	mocks.revalidateEmployeesCache.mockImplementation(() => {
		events.push("cache-revalidated");
	});
	mocks.revokeOrganizationActiveSessions.mockImplementation(async () => {
		events.push("sessions-revoked");
		if (state.revocationError) throw state.revocationError;
	});

	return {
		dbService,
		events,
		findEmployee,
		findMember,
		from,
		leftJoin,
		lockFor,
		ownerWhere,
		returning,
		select,
		transaction,
		update,
		updateSet,
		updateWhere,
	};
}

describe("employee lifecycle actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("requires the authenticated active-organization settings actor context", async () => {
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.fail(
				new AuthorizationError({
					message: "No active organization selected",
					userId: actorUserId,
					resource: "employee_settings",
					action: "access",
				}),
			),
		);
		mocks.runTracedEmployeeAction.mockImplementation((options) =>
			Effect.runPromiseExit(options.execute({ setAttribute: vi.fn() })).then(
				toServerActionResult,
			),
		);

		await expect(deactivateEmployeeAction(employeeId)).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
			error: "No active organization selected",
		});
		expect(mocks.getEmployeeSettingsActorContext).toHaveBeenCalledWith({
			queryName: "setEmployeeLifecycleState:actor",
		});
	});

	it.each([
		"member",
		"manager",
	] as const)("denies %s settings actors", async (accessTier) => {
		const { transaction } = setup({ accessTier });

		const result = await deactivateEmployeeAction(employeeId);

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(transaction).not.toHaveBeenCalled();
	});

	it.each([
		"owner",
		"admin",
	] as const)("allows an approved %s actor", async (actorRole) => {
		setup({ actorRole });

		const result = await deactivateEmployeeAction(employeeId);

		expect(result).toEqual({ success: true, data: undefined });
	});

	it.each([
		"owner,admin",
		" member , admin ",
		["member", "owner"],
	])("allows approved compound actor role %j", async (actorRole) => {
		setup({ actorRole });

		await expect(deactivateEmployeeAction(employeeId)).resolves.toEqual({
			success: true,
			data: undefined,
		});
	});

	it("denies an actor demoted after settings context resolution", async () => {
		const { update } = setup({ actorRole: "member" });

		const result = await deactivateEmployeeAction(employeeId);

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(update).not.toHaveBeenCalled();
	});

	it("looks up the target and performs the final update by employee and organization", async () => {
		const { findEmployee, updateWhere } = setup();

		await deactivateEmployeeAction(employeeId);

		const targetQuery = compilePredicate(
			employee,
			findEmployee.mock.calls[0]?.[0]?.where,
		);
		expect(targetQuery.sql).toContain('"employee"."id"');
		expect(targetQuery.sql).toContain('"employee"."organization_id"');
		expect(targetQuery.params).toEqual([employeeId, organizationId]);
		const updateQuery = compilePredicate(
			employee,
			updateWhere.mock.calls[0]?.[0],
		);
		expect(updateQuery.sql).toContain('"employee"."id"');
		expect(updateQuery.sql).toContain('"employee"."organization_id"');
		expect(updateQuery.params).toEqual([employeeId, organizationId]);
	});

	it("returns not found without mutation for a cross-organization-safe target miss", async () => {
		const { update } = setup({ target: null });

		const result = await deactivateEmployeeAction(employeeId);

		expect(result).toMatchObject({
			success: false,
			code: "NotFoundError",
			error: "Employee not found",
		});
		expect(update).not.toHaveBeenCalled();
		expect(mocks.revokeOrganizationActiveSessions).not.toHaveBeenCalled();
	});

	it("looks up an approved target membership by user and organization", async () => {
		const { findMember } = setup();

		await deactivateEmployeeAction(employeeId);

		const targetMembershipQuery = compilePredicate(
			member,
			findMember.mock.calls[1]?.[0]?.where,
		);
		expect(targetMembershipQuery.sql).toContain('"member"."user_id"');
		expect(targetMembershipQuery.sql).toContain('"member"."organization_id"');
		expect(targetMembershipQuery.sql).toContain('"member"."status"');
		expect(targetMembershipQuery.params).toEqual([
			targetUserId,
			organizationId,
			"approved",
		]);
	});

	it.each([
		deactivateEmployeeAction,
		reactivateEmployeeAction,
	])("prohibits changing the actor's own lifecycle state", async (action) => {
		const { update } = setup({
			target: {
				id: employeeId,
				userId: actorUserId,
				organizationId,
				isActive: true,
			},
			targetMembership: {
				userId: actorUserId,
				role: "owner",
				status: "approved",
			},
		});

		const result = await action(employeeId);

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(update).not.toHaveBeenCalled();
	});

	it("prevents an admin from targeting an owner", async () => {
		const { update } = setup({
			actorRole: "admin",
			targetMembership: {
				userId: targetUserId,
				role: "owner",
				status: "approved",
			},
		});

		const result = await deactivateEmployeeAction(employeeId);

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(update).not.toHaveBeenCalled();
	});

	it.each([
		"owner,admin",
		" member , owner ",
		["member", "owner"],
	])("prevents an admin from targeting compound owner role %j", async (role) => {
		const { update } = setup({
			actorRole: "admin",
			targetMembership: {
				userId: targetUserId,
				role: role as string,
				status: "approved",
			},
		});

		const result = await deactivateEmployeeAction(employeeId);

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(update).not.toHaveBeenCalled();
	});

	it("prevents deactivation of the final approved accessible owner", async () => {
		const { update } = setup({
			targetMembership: {
				userId: targetUserId,
				role: "owner",
				status: "approved",
			},
			owners: [{ userId: targetUserId, role: "owner", employeeIsActive: true }],
		});

		const result = await deactivateEmployeeAction(employeeId);

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(update).not.toHaveBeenCalled();
	});

	it.each([
		{ label: "no employee bootstrap", employeeIsActive: null },
		{ label: "active employee", employeeIsActive: true },
	] as const)("counts an approved alternative owner with $label", async ({
		employeeIsActive,
	}) => {
		const { ownerWhere } = setup({
			targetMembership: {
				userId: targetUserId,
				role: "owner",
				status: "approved",
			},
			owners: [
				{ userId: targetUserId, role: "owner", employeeIsActive: true },
				{ userId: "other-owner", role: "owner,admin", employeeIsActive },
			],
		});

		await expect(deactivateEmployeeAction(employeeId)).resolves.toEqual({
			success: true,
			data: undefined,
		});
		const ownerQuery = compilePredicate(member, ownerWhere.mock.calls[0]?.[0]);
		expect(ownerQuery.params).toEqual([organizationId, "approved"]);
	});

	it("does not count an inactive alternative owner", async () => {
		const { update } = setup({
			targetMembership: {
				userId: targetUserId,
				role: "owner",
				status: "approved",
			},
			owners: [
				{ userId: targetUserId, role: "owner", employeeIsActive: true },
				{ userId: "inactive-owner", role: ["owner"], employeeIsActive: false },
			],
		});

		const result = await deactivateEmployeeAction(employeeId);
		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(update).not.toHaveBeenCalled();
	});

	it("serializes the owner check and state update with an organization lock", async () => {
		const { events, lockFor } = setup({
			targetMembership: {
				userId: targetUserId,
				role: "owner",
				status: "approved",
			},
		});

		await deactivateEmployeeAction(employeeId);

		expect(lockFor).toHaveBeenCalledWith("update");
		expect(events.indexOf("organization-locked")).toBeLessThan(
			events.indexOf("employee-updated"),
		);
		expect(events.indexOf("employee-updated")).toBeLessThan(
			events.indexOf("transaction-committed"),
		);
	});

	it("deactivates only the employee row, revokes organization sessions, and audits a real change", async () => {
		const { events, update, updateSet } = setup();

		const result = await deactivateEmployeeAction(employeeId);

		expect(result).toEqual({ success: true, data: undefined });
		expect(update).toHaveBeenCalledExactlyOnceWith(employee);
		expect(updateSet).toHaveBeenCalledWith({ isActive: false });
		expect(
			mocks.revokeOrganizationActiveSessions,
		).toHaveBeenCalledExactlyOnceWith(targetUserId, organizationId);
		expect(mocks.logAudit).toHaveBeenCalledWith({
			action: AuditAction.EMPLOYEE_DEACTIVATED,
			actorId: actorUserId,
			actorEmail,
			employeeId,
			targetId: employeeId,
			targetType: "employee",
			organizationId,
			changes: { isActive: { from: true, to: false } },
			timestamp: expect.any(Date),
		});
		expect(events).toEqual([
			"organization-locked",
			"employee-updated",
			"transaction-committed",
			"sessions-revoked",
			"audit-logged",
			"cache-revalidated",
		]);
	});

	it("always retries session revocation but does not update or audit an already inactive employee", async () => {
		const { update } = setup({
			target: {
				id: employeeId,
				userId: targetUserId,
				organizationId,
				isActive: false,
			},
		});

		const result = await deactivateEmployeeAction(employeeId);

		expect(result).toEqual({ success: true, data: undefined });
		expect(update).not.toHaveBeenCalled();
		expect(mocks.logAudit).not.toHaveBeenCalled();
		expect(
			mocks.revokeOrganizationActiveSessions,
		).toHaveBeenCalledExactlyOnceWith(targetUserId, organizationId);
	});

	it("returns success and logs safely when session cleanup fails after committed deactivation", async () => {
		const firstAttempt = setup({
			revocationError: new Error("redis://secret-host failed"),
		});

		const firstResult = await deactivateEmployeeAction(employeeId);

		expect(firstAttempt.updateSet).toHaveBeenCalledWith({ isActive: false });
		expect(firstAttempt.events).toEqual([
			"organization-locked",
			"employee-updated",
			"transaction-committed",
			"sessions-revoked",
			"audit-logged",
			"cache-revalidated",
		]);
		expect(firstResult).toEqual({ success: true, data: undefined });
		expect(mocks.loggerWarn).toHaveBeenCalledWith(
			{
				operation: "revokeOrganizationActiveSessions",
				employeeId,
				organizationId,
				targetUserId,
			},
			"Employee deactivated with session cleanup pending",
		);
		expect(JSON.stringify(mocks.loggerWarn.mock.calls)).not.toContain(
			"secret-host",
		);
		expect(mocks.logAudit).toHaveBeenCalledOnce();

		const retry = setup({
			target: {
				id: employeeId,
				userId: targetUserId,
				organizationId,
				isActive: false,
			},
		});
		const retryResult = await deactivateEmployeeAction(employeeId);

		expect(retryResult).toEqual({ success: true, data: undefined });
		expect(retry.update).not.toHaveBeenCalled();
		expect(retry.events).toEqual([
			"organization-locked",
			"transaction-committed",
			"sessions-revoked",
			"cache-revalidated",
		]);
		expect(mocks.revokeOrganizationActiveSessions).toHaveBeenCalledTimes(2);
		expect(mocks.logAudit).toHaveBeenCalledOnce();
	});

	it("translates the database owner guard into fixed friendly guidance", async () => {
		const triggerError = Object.assign(
			new Error("Organization must retain an approved accessible owner"),
			{ code: "23514" },
		);
		setup({ transactionError: triggerError });

		const result = await deactivateEmployeeAction(employeeId);

		expect(result).toEqual({
			success: false,
			code: "ValidationError",
			error:
				"Assign and activate another approved owner before deactivating this employee",
		});
		expect(JSON.stringify(result)).not.toContain("23514");
	});

	it("requires approved membership to reactivate and directs missing members to re-invite", async () => {
		const { update } = setup({ targetMembership: null });

		const result = await reactivateEmployeeAction(employeeId);

		expect(result).toEqual({
			success: false,
			code: "ValidationError",
			error:
				"This employee is no longer an approved organization member. Re-invite them before reactivating.",
		});
		expect(update).not.toHaveBeenCalled();
	});

	it("reactivates the same employee row without session revocation and audits only the real change", async () => {
		const { update, updateSet } = setup({
			target: {
				id: employeeId,
				userId: targetUserId,
				organizationId,
				isActive: false,
			},
		});

		const result = await reactivateEmployeeAction(employeeId);

		expect(result).toEqual({ success: true, data: undefined });
		expect(update).toHaveBeenCalledExactlyOnceWith(employee);
		expect(updateSet).toHaveBeenCalledWith({ isActive: true });
		expect(mocks.revokeOrganizationActiveSessions).not.toHaveBeenCalled();
		expect(mocks.logAudit).toHaveBeenCalledWith({
			action: AuditAction.EMPLOYEE_REACTIVATED,
			actorId: actorUserId,
			actorEmail,
			employeeId,
			targetId: employeeId,
			targetType: "employee",
			organizationId,
			changes: { isActive: { from: false, to: true } },
			timestamp: expect.any(Date),
		});
	});

	it("does not update or audit an already active reactivation retry", async () => {
		const { update } = setup();

		const result = await reactivateEmployeeAction(employeeId);

		expect(result).toEqual({ success: true, data: undefined });
		expect(update).not.toHaveBeenCalled();
		expect(mocks.logAudit).not.toHaveBeenCalled();
		expect(mocks.revokeOrganizationActiveSessions).not.toHaveBeenCalled();
	});

	it("exposes lifecycle wrappers from the employee action aggregator", () => {
		const source = readFileSync(
			new URL("./actions.ts", import.meta.url),
			"utf8",
		);

		expect(source).toContain("export async function deactivateEmployee(");
		expect(source).toContain("return deactivateEmployeeAction(employeeId)");
		expect(source).toContain("export async function reactivateEmployee(");
		expect(source).toContain("return reactivateEmployeeAction(employeeId)");
	});
});

type RemovalState = {
	actorRole?: unknown;
	target?: { id: string; userId: string; organizationId: string } | null;
	targetMembership?: { id: string; userId: string; status: string } | null;
	membershipAfterAuth?: { id: string } | null;
	authError?: unknown;
	cleanupError?: unknown;
	rejectAuthWithUndefined?: boolean;
};

function setupRemoval(state: RemovalState = {}) {
	const actorRole = state.actorRole ?? "owner";
	const target =
		state.target === undefined
			? { id: employeeId, userId: targetUserId, organizationId }
			: state.target;
	const targetMembership =
		state.targetMembership === undefined
			? { id: targetMembershipId, userId: targetUserId, status: "approved" }
			: state.targetMembership;
	const findMember = vi
		.fn()
		.mockResolvedValueOnce({
			id: "actor-membership",
			userId: actorUserId,
			role: actorRole,
			status: "approved",
		})
		.mockResolvedValueOnce(targetMembership)
		.mockResolvedValueOnce(
			state.membershipAfterAuth === undefined
				? targetMembership
				: state.membershipAfterAuth,
		);
	const findEmployee = vi.fn().mockResolvedValue(target);
	const update = vi.fn();
	const deleteRows = vi.fn();
	const dbService = {
		db: {
			query: {
				employee: { findFirst: findEmployee },
				member: { findFirst: findMember },
			},
			update,
			delete: deleteRows,
		},
		query: vi.fn((_name: string, run: () => Promise<unknown>) =>
			Effect.tryPromise({
				try: run,
				catch: (cause) =>
					new DatabaseError({
						message: "Database operation failed",
						operation: "test",
						cause,
					}),
			}),
		),
	};

	mocks.getEmployeeSettingsActorContext.mockReturnValue(
		Effect.succeed({
			accessTier: "orgAdmin",
			organizationId,
			session: { user: { id: actorUserId, email: actorEmail } },
			currentEmployee: { isActive: true },
			dbService,
		}),
	);
	mocks.runTracedEmployeeAction.mockImplementation((options) =>
		Effect.runPromiseExit(options.execute({ setAttribute: vi.fn() })).then(
			toServerActionResult,
		),
	);
	const requestHeaders = new Headers({ cookie: "session=approved-owner" });
	mocks.headers.mockResolvedValue(requestHeaders);
	mocks.authRemoveMember.mockImplementation(async () => {
		if (state.rejectAuthWithUndefined) throw undefined;
		if (state.authError) throw state.authError;
	});
	mocks.completeRemovedMemberCleanup.mockImplementation(async () => {
		if (state.cleanupError) throw state.cleanupError;
	});

	return {
		dbService,
		deleteRows,
		findEmployee,
		findMember,
		requestHeaders,
		update,
	};
}

describe("removeEmployeeAccessAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		"admin",
		"member",
	])("denies an approved %s actor", async (actorRole) => {
		setupRemoval({ actorRole });

		const result = await removeEmployeeAccessAction(employeeId);

		expect(result).toEqual({
			success: false,
			code: "AuthorizationError",
			error: "Only organization owners can remove employee access",
		});
		expect(mocks.authRemoveMember).not.toHaveBeenCalled();
	});

	it.each([
		"owner",
		"owner,admin",
		" member , owner ",
		["admin", "owner"],
	])("accepts approved owner role token %j", async (actorRole) => {
		setupRemoval({ actorRole });

		await expect(removeEmployeeAccessAction(employeeId)).resolves.toEqual({
			success: true,
			data: undefined,
		});
	});

	it("requires the active approved settings actor context", async () => {
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.fail(
				new AuthorizationError({
					message: "Organization access is inactive",
					userId: actorUserId,
					resource: "employee_settings",
					action: "access",
				}),
			),
		);
		mocks.runTracedEmployeeAction.mockImplementation((options) =>
			Effect.runPromiseExit(options.execute({ setAttribute: vi.fn() })).then(
				toServerActionResult,
			),
		);

		const result = await removeEmployeeAccessAction(employeeId);

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
			error: "Organization access is inactive",
		});
		expect(mocks.authRemoveMember).not.toHaveBeenCalled();
	});

	it("rechecks the actor as an approved organization member", async () => {
		const { findMember } = setupRemoval();

		await removeEmployeeAccessAction(employeeId);

		const actorMembershipQuery = compilePredicate(
			member,
			findMember.mock.calls[0]?.[0]?.where,
		);
		expect(actorMembershipQuery.params).toEqual([
			actorUserId,
			organizationId,
			"approved",
		]);
	});

	it("denies removing the actor's own access", async () => {
		const { update, deleteRows } = setupRemoval({
			target: { id: employeeId, userId: actorUserId, organizationId },
			targetMembership: {
				id: "actor-membership",
				userId: actorUserId,
				status: "approved",
			},
		});

		const result = await removeEmployeeAccessAction(employeeId);

		expect(result).toEqual({
			success: false,
			code: "AuthorizationError",
			error: "You cannot remove your own organization access",
		});
		expect(mocks.authRemoveMember).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
		expect(deleteRows).not.toHaveBeenCalled();
	});

	it("looks up the target employee by employee and actor organization", async () => {
		const { findEmployee } = setupRemoval();

		await removeEmployeeAccessAction(employeeId);

		const targetQuery = compilePredicate(
			employee,
			findEmployee.mock.calls[0]?.[0]?.where,
		);
		expect(targetQuery.params).toEqual([employeeId, organizationId]);
	});

	it("rejects a cross-organization target without calling Better Auth", async () => {
		setupRemoval({ target: null });

		const result = await removeEmployeeAccessAction(employeeId);

		expect(result).toEqual({
			success: false,
			code: "NotFoundError",
			error: "Employee not found",
		});
		expect(mocks.authRemoveMember).not.toHaveBeenCalled();
	});

	it("looks up the approved target membership by target user and actor organization", async () => {
		const { findMember } = setupRemoval();

		await removeEmployeeAccessAction(employeeId);

		const targetMembershipQuery = compilePredicate(
			member,
			findMember.mock.calls[1]?.[0]?.where,
		);
		expect(targetMembershipQuery.params).toEqual([
			targetUserId,
			organizationId,
			"approved",
		]);
	});

	it("idempotently retries post-removal cleanup when membership is already gone", async () => {
		setupRemoval({ targetMembership: null });

		const result = await removeEmployeeAccessAction(employeeId);

		expect(result).toEqual({ success: true, data: undefined });
		expect(mocks.completeRemovedMemberCleanup).toHaveBeenCalledExactlyOnceWith({
			organizationId,
			userId: targetUserId,
		});
		expect(mocks.authRemoveMember).not.toHaveBeenCalled();
		expect(mocks.revalidateEmployeesCache).toHaveBeenCalledExactlyOnceWith(
			organizationId,
		);
	});

	it("delegates removal by membership ID with the actor organization and request headers", async () => {
		const { requestHeaders } = setupRemoval();

		const result = await removeEmployeeAccessAction(employeeId);

		expect(result).toEqual({ success: true, data: undefined });
		expect(mocks.authRemoveMember).toHaveBeenCalledExactlyOnceWith({
			body: {
				organizationId,
				memberIdOrEmail: targetMembershipId,
			},
			headers: requestHeaders,
		});
		expect(JSON.stringify(mocks.authRemoveMember.mock.calls)).not.toContain(
			targetUserId,
		);
	});

	it("leaves employee and history mutation to Better Auth hooks", async () => {
		const { update, deleteRows } = setupRemoval();
		const source = readFileSync(
			new URL("./employee-lifecycle.actions.ts", import.meta.url),
			"utf8",
		);

		await removeEmployeeAccessAction(employeeId);

		expect(update).not.toHaveBeenCalled();
		expect(deleteRows).not.toHaveBeenCalled();
		expect(source).not.toContain("employeeEmploymentHistory");
		expect(source).not.toContain(".delete(employee");
		expect(source).not.toContain(".delete(user");
	});

	it.each([
		Object.assign(
			new Error(
				"Organization must retain an approved accessible owner: raw db detail",
			),
			{ code: "23514" },
		),
		new Error("You cannot remove the last owner: raw Better Auth detail"),
	])("translates final accessible owner failures to fixed safe guidance", async (authError) => {
		setupRemoval({ authError });

		const result = await removeEmployeeAccessAction(employeeId);

		expect(result).toEqual({
			success: false,
			code: "ValidationError",
			error:
				"Assign and activate another approved owner before removing this employee's access",
		});
		expect(JSON.stringify(result)).not.toContain("raw");
	});

	it("returns fixed safe guidance for other Better Auth failures without action-layer mutation", async () => {
		const { update, deleteRows } = setupRemoval({
			authError: new Error("postgres://secret-host/member raw failure"),
		});

		const result = await removeEmployeeAccessAction(employeeId);

		expect(result).toEqual({
			success: false,
			code: "ValidationError",
			error: "Employee access could not be removed. Please try again.",
		});
		expect(JSON.stringify(result)).not.toContain("secret-host");
		expect(update).not.toHaveBeenCalled();
		expect(deleteRows).not.toHaveBeenCalled();
		expect(mocks.revalidateEmployeesCache).not.toHaveBeenCalled();
	});

	it("does not revoke access when Better Auth fails before removing membership", async () => {
		const { update, deleteRows } = setupRemoval({
			authError: new Error("member removal rejected before commit"),
			membershipAfterAuth: { id: targetMembershipId },
		});

		const result = await removeEmployeeAccessAction(employeeId);

		expect(result).toEqual({
			success: false,
			code: "ValidationError",
			error: "Employee access could not be removed. Please try again.",
		});
		expect(mocks.completeRemovedMemberCleanup).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
		expect(deleteRows).not.toHaveBeenCalled();
	});

	it("recovers an after-hook failure after membership removal without removing twice", async () => {
		setupRemoval({
			authError: new Error("afterRemoveMember cleanup failed"),
			membershipAfterAuth: null,
		});

		const result = await removeEmployeeAccessAction(employeeId);

		expect(result).toEqual({ success: true, data: undefined });
		expect(mocks.authRemoveMember).toHaveBeenCalledOnce();
		expect(mocks.completeRemovedMemberCleanup).toHaveBeenCalledExactlyOnceWith({
			organizationId,
			userId: targetUserId,
		});
		expect(mocks.revalidateEmployeesCache).toHaveBeenCalledExactlyOnceWith(
			organizationId,
		);
	});

	it("returns fixed retry guidance when committed-removal cleanup keeps failing", async () => {
		setupRemoval({
			authError: new Error("after hook raw failure"),
			membershipAfterAuth: null,
			cleanupError: new Error("redis://secret-host token raw failure"),
		});

		const result = await removeEmployeeAccessAction(employeeId);

		expect(result).toEqual({
			success: false,
			code: "ValidationError",
			error:
				"Employee access was removed, but cleanup is still pending. Retry removing access.",
		});
		expect(JSON.stringify(result)).not.toContain("secret-host");
		expect(mocks.authRemoveMember).toHaveBeenCalledOnce();
		expect(mocks.completeRemovedMemberCleanup).toHaveBeenCalledOnce();
		expect(mocks.revalidateEmployeesCache).toHaveBeenCalledExactlyOnceWith(
			organizationId,
		);
	});

	it("organization-scopes the membership commit check after Better Auth failure", async () => {
		const { findMember } = setupRemoval({
			authError: new Error("unknown removal outcome"),
			membershipAfterAuth: null,
		});

		await removeEmployeeAccessAction(employeeId);

		const commitCheck = compilePredicate(
			member,
			findMember.mock.calls[2]?.[0]?.where,
		);
		expect(commitCheck.params).toEqual([targetMembershipId, organizationId]);
	});

	it("recovers a committed removal even when Better Auth rejects without an error value", async () => {
		setupRemoval({
			rejectAuthWithUndefined: true,
			membershipAfterAuth: null,
		});

		const result = await removeEmployeeAccessAction(employeeId);

		expect(result).toEqual({ success: true, data: undefined });
		expect(mocks.completeRemovedMemberCleanup).toHaveBeenCalledOnce();
	});

	it("revalidates the organization employee cache after successful removal", async () => {
		setupRemoval();

		await removeEmployeeAccessAction(employeeId);

		expect(mocks.revalidateEmployeesCache).toHaveBeenCalledExactlyOnceWith(
			organizationId,
		);
	});

	it("exposes employee access removal as the only application lifecycle wrapper", () => {
		const employeeActionsSource = readFileSync(
			new URL("./actions.ts", import.meta.url),
			"utf8",
		);
		const organizationActionsSource = readFileSync(
			new URL("../organizations/actions.ts", import.meta.url),
			"utf8",
		);

		expect(employeeActionsSource).toContain(
			"export async function removeEmployeeAccess(",
		);
		expect(employeeActionsSource).toContain(
			"return removeEmployeeAccessAction(employeeId)",
		);
		expect(organizationActionsSource).not.toContain(
			"export async function removeMember(",
		);
		expect(organizationActionsSource).not.toContain(
			"export async function toggleEmployeeStatus(",
		);
	});
});
