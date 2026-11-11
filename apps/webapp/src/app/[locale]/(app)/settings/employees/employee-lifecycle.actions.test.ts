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
import { DeactivationRequestConflictError } from "@/lib/employee-lifecycle/receipts";

const mocks = vi.hoisted(() => ({
	authRemoveMember: vi.fn(),
	completeRemovedMemberCleanup: vi.fn(),
	deactivate: vi.fn(),
	/** The reactivation tests still assert under the command's former name (#1638). */
	get executeDeactivation() {
		return this.deactivate;
	},
	getEmployeeSettingsActorContext: vi.fn(),
	headers: vi.fn(),
	logAudit: vi.fn(),
	loggerWarn: vi.fn(),
	markDeactivationReactivated: vi.fn(),
	notifyReleasedDeputyAssignments: vi.fn(),
	previewEmployeeDeactivation: vi.fn(),
	readDeactivationByRequest: vi.fn(),
	reconcileBillingSeatsForOrganization: vi.fn(),
	revalidateEmployeesCache: vi.fn(),
	revokeOrganizationActiveSessions: vi.fn(),
	runTracedEmployeeAction: vi.fn(),
}));

// The deactivation is one call into its module (#1638). Its locks, replay,
// target rules, consequences and after-commit work are covered against
// PostgreSQL by deactivate.integration.test.ts, deactivation.integration.test.ts
// and the area suites; here it returns the outcome the action words.
vi.mock("@/lib/employee-lifecycle/deactivation/command", () => ({
	deactivate: mocks.deactivate,
}));

vi.mock("@/lib/employee-lifecycle/deactivation/preview", () => ({
	previewEmployeeDeactivation: mocks.previewEmployeeDeactivation,
}));

vi.mock("@/lib/employee-lifecycle/receipts", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/employee-lifecycle/receipts")>()),
	markDeactivationReactivated: mocks.markDeactivationReactivated,
	readDeactivationByRequest: mocks.readDeactivationByRequest,
}));

// Protection is covered by authorization-mutation.test.ts and the PostgreSQL
// suite; here it records its scope and opens the fake transaction.
const protection = vi.hoisted(() => ({ scopes: [] as unknown[] }));
vi.mock("@/lib/authorization/authorization-mutation", () => ({
	withAuthorizationMutation: async (
		scope: unknown,
		mutation: (tx: unknown) => Promise<unknown>,
		database: { transaction: (run: (tx: unknown) => Promise<unknown>) => Promise<unknown> },
	) => {
		protection.scopes.push(scope);
		return database.transaction(mutation);
	},
}));

// The coordinated auth transaction (#314) is covered by auth-mutation-coordination
// tests and the PostgreSQL suite; here it records that removal ran inside it.
const coordination = vi.hoisted(() => ({ inside: false, removalsInside: 0 }));
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			removeMember: (input: unknown) => {
				if (coordination.inside) coordination.removalsInside += 1;
				return mocks.authRemoveMember(input);
			},
		},
	},
	runAuthMutation: async (mutation: () => Promise<unknown>) => {
		coordination.inside = true;
		try {
			return await mutation();
		} finally {
			coordination.inside = false;
		}
	},
}));

vi.mock("@/lib/auth/member-removal-cleanup", () => ({
	completeRemovedMemberCleanup: mocks.completeRemovedMemberCleanup,
}));

// Reactivation's history event needs an employment period; the PostgreSQL suite covers it.
vi.mock("@/lib/employee-lifecycle/employment-periods", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/employee-lifecycle/employment-periods")>()),
	resolveCurrentEmploymentPeriod: async () => null,
}));

vi.mock("@/lib/employee-lifecycle/deputy-release-runtime", () => ({
	notifyReleasedDeputyAssignments: mocks.notifyReleasedDeputyAssignments,
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

// The seat count itself is covered by billable-seat-count.integration.test.ts (#1439).
vi.mock("@/lib/billing/seat-sync-trigger", () => ({
	reconcileBillingSeatsForOrganization: mocks.reconcileBillingSeatsForOrganization,
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
	deactivateEmployeeAction as deactivateEmployeeWithInput,
	previewEmployeeDeactivationAction,
	reactivateEmployeeAction,
	removeEmployeeAccessAction,
} from "./employee-lifecycle.actions";

const actorUserId = "actor-user";
const actorEmail = "owner@example.com";
const employeeId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const reportId = "55555555-5555-4555-8555-555555555555";
const replacementId = "66666666-6666-4666-8666-666666666666";

/** Deactivate with a request ID and no replacement picks (#1440). */
function deactivateEmployeeAction(id: string) {
	return deactivateEmployeeWithInput({ employeeId: id, requestId, replacementManagers: {} });
}
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
	employmentEnded?: boolean;
	/** What the deactivation returns; defaults to an applied deactivation. */
	outcome?: unknown;
	/** What the deactivation throws instead. */
	deactivationError?: unknown;
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
	const ownerWhere = vi.fn().mockResolvedValue(
		state.owners ?? [
			{ userId: actorUserId, role: "owner", employeeIsActive: true },
			{ userId: targetUserId, role: "member", employeeIsActive: true },
		],
	);
	const leftJoin = vi.fn(() => ({ where: ownerWhere }));
	const from = vi.fn().mockImplementationOnce(() => ({ leftJoin }));
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
			// The organization row lock (`tryLockLifecycleOrganization`), else the employment check.
			execute: vi.fn(async (query: SQL) =>
				/FOR UPDATE/.test(new PgDialect().sqlToQuery(query).sql)
					? { rows: await lockFor("update") }
					: { rows: [{ ended: state.employmentEnded ?? false }] },
			),
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
	mocks.reconcileBillingSeatsForOrganization.mockImplementation(async () => {
		events.push("seats-reconciled");
	});
	mocks.revalidateEmployeesCache.mockImplementation(() => {
		events.push("cache-revalidated");
	});
	mocks.revokeOrganizationActiveSessions.mockImplementation(async () => {
		events.push("sessions-revoked");
		if (state.revocationError) throw state.revocationError;
	});
	mocks.deactivate.mockImplementation(async () => {
		if (state.deactivationError) throw state.deactivationError;
		return state.outcome ?? { kind: "deactivated", deactivationId: "deactivation-1", warnings: [] };
	});
	mocks.markDeactivationReactivated.mockImplementation(async () => {
		events.push("deactivation-reactivated");
		return [];
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
		setup({ accessTier });

		const result = await deactivateEmployeeAction(employeeId);

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.deactivate).not.toHaveBeenCalled();
	});

	it.each([
		{ label: "a missing request ID", input: { employeeId, replacementManagers: {} } },
		{ label: "a malformed request ID", input: { employeeId, requestId: "retry-1" } },
		{
			label: "a replacement that is no employee ID",
			input: { employeeId, requestId, replacementManagers: { [reportId]: "anna" } },
		},
		{ label: "an unknown field", input: { employeeId, requestId, isActive: false } },
	])("rejects $label before deactivating (#1440)", async ({ input }) => {
		setup();

		const result = await deactivateEmployeeWithInput(input as never);

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.deactivate).not.toHaveBeenCalled();
	});

	it("hands the deactivation the actor's database, organization and the parsed command", async () => {
		const { dbService } = setup();

		await deactivateEmployeeWithInput({
			employeeId,
			requestId,
			replacementManagers: { [reportId]: replacementId },
		});

		expect(mocks.deactivate).toHaveBeenCalledExactlyOnceWith(dbService.db, {
			organizationId,
			actorUserId,
			actorEmail,
			employeeId,
			requestId,
			replacementManagers: { [reportId]: replacementId },
		});
	});

	it.each([
		{ label: "applied", outcome: { kind: "deactivated", deactivationId: "deactivation-1" } },
		{ label: "replayed the request", outcome: { kind: "replayed", reactivatedSince: false } },
		{
			label: "replayed a request reactivated since",
			outcome: { kind: "replayed", reactivatedSince: true },
		},
		{ label: "found a former employee", outcome: { kind: "unchanged" } },
		{
			label: "left follow-up work pending",
			outcome: { kind: "unchanged", warnings: ["Session cleanup is pending"] },
		},
	])("succeeds and revalidates the employees cache when the deactivation $label", async ({
		outcome,
	}) => {
		setup({ outcome: { warnings: [], ...outcome } });

		const result = await deactivateEmployeeAction(employeeId);

		expect(result).toEqual({ success: true, data: undefined });
		expect(mocks.revalidateEmployeesCache).toHaveBeenCalledExactlyOnceWith(organizationId);
	});

	it.each([
		{ type: "not_found", code: "NotFoundError", error: "Employee not found" },
		{
			type: "actor_membership_missing",
			code: "AuthorizationError",
			error: "You do not have access to employee settings",
		},
		{
			type: "target_membership_missing",
			code: "ValidationError",
			error: "This employee is not an approved organization member.",
		},
		{
			type: "self_target",
			code: "AuthorizationError",
			error: "You cannot deactivate your own employee profile",
		},
		{
			type: "admin_targeting_owner",
			code: "AuthorizationError",
			error: "Only an organization owner can change an owner's lifecycle state",
		},
		{
			type: "final_accessible_owner",
			code: "ValidationError",
			error: "Assign and activate another approved owner before deactivating this employee",
		},
	])("words the deactivation's $type refusal", async ({ type, code, error }) => {
		setup({ outcome: { kind: "rejected", refusal: { type } } });

		const result = await deactivateEmployeeAction(employeeId);

		expect(result).toMatchObject({ success: false, code, error });
		expect(mocks.revalidateEmployeesCache).not.toHaveBeenCalled();
	});

	it.each([
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
		expect(mocks.executeDeactivation).not.toHaveBeenCalled();
	});

	it("reactivates under the target's configuration/access protection", async () => {
		protection.scopes.length = 0;
		setup({
			target: { id: employeeId, userId: targetUserId, organizationId, isActive: false },
		});

		await reactivateEmployeeAction(employeeId);

		expect(protection.scopes).toEqual([{ organizationId, employeeIds: [employeeId] }]);
	});

	it("names the reports when a report still needs an eligible replacement (#1440)", async () => {
		setup({
			outcome: {
				kind: "refused",
				reports: [
					{ employeeId: reportId, name: "Rita Report", refusal: "replacement_ineligible" },
				],
			},
		});

		const result = await deactivateEmployeeAction(employeeId);

		expect(result).toEqual({
			success: false,
			code: "ValidationError",
			error: "Choose a current admin or manager as the new manager of Rita Report.",
			refusal: "replacement_required",
		});
		expect(mocks.revalidateEmployeesCache).not.toHaveBeenCalled();
	});

	it("refuses a request ID used before with other choices", async () => {
		setup({ deactivationError: new DeactivationRequestConflictError() });

		const result = await deactivateEmployeeAction(employeeId);

		expect(result).toEqual({
			success: false,
			code: "ValidationError",
			error:
				"This deactivation was already submitted with different choices. Review the preview and try again.",
			refusal: "request_conflict",
		});
	});

	it("never touches the deactivation ledger's consequences when reactivating, and ends the open deactivation", async () => {
		const { events } = setup({
			target: { id: employeeId, userId: targetUserId, organizationId, isActive: false },
		});

		await reactivateEmployeeAction(employeeId);

		expect(mocks.executeDeactivation).not.toHaveBeenCalled();
		expect(mocks.notifyReleasedDeputyAssignments).not.toHaveBeenCalled();
		expect(mocks.markDeactivationReactivated).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ update: expect.any(Function) }),
			{
				organizationId,
				employeeId,
				reactivatedAt: expect.anything(),
				reactivatedBy: actorUserId,
				// Each reactivation has its own request ID (#1441).
				reactivationRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
			},
		);
		expect(events.indexOf("employee-updated")).toBeLessThan(
			events.indexOf("deactivation-reactivated"),
		);
		expect(events.indexOf("deactivation-reactivated")).toBeLessThan(
			events.indexOf("transaction-committed"),
		);
	});

	it("translates the database owner guard into fixed friendly guidance", async () => {
		const triggerError = Object.assign(
			new Error("Organization must retain an approved accessible owner"),
			{ code: "23514" },
		);
		setup({ deactivationError: triggerError });

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

	it("directs an offboarded employee to rehire instead of reactivating the projection", async () => {
		const { update } = setup({
			target: { id: employeeId, userId: targetUserId, organizationId, isActive: false },
			employmentEnded: true,
		});

		const result = await reactivateEmployeeAction(employeeId);

		expect(result).toEqual({
			success: false,
			code: "ValidationError",
			error:
				"This employee has left the organization. Rehire them to start a new employment period.",
		});
		expect(update).not.toHaveBeenCalled();
		expect(mocks.logAudit).not.toHaveBeenCalled();
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
		// Reactivation takes a paid seat again (#1439).
		expect(mocks.reconcileBillingSeatsForOrganization).toHaveBeenCalledExactlyOnceWith(
			organizationId,
			{ alsoWhenBillingDisabled: true },
		);
		expect(mocks.logAudit).toHaveBeenCalledWith({
			action: AuditAction.EMPLOYEE_REACTIVATED,
			actorId: actorUserId,
			actorEmail,
			employeeId,
			targetId: employeeId,
			targetType: "employee",
			organizationId,
			changes: { isActive: { from: false, to: true } },
			metadata: { reactivationRequestId: expect.any(String) },
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
		expect(mocks.reconcileBillingSeatsForOrganization).not.toHaveBeenCalled();
		expect(mocks.markDeactivationReactivated).not.toHaveBeenCalled();
	});

	it("previews with the actor's organization and the picks, and maps refusals (#1440)", async () => {
		setup();
		const plan = { at: "2026-10-24T08:00:00Z" };
		mocks.previewEmployeeDeactivation.mockResolvedValueOnce({ kind: "ok", plan });

		await expect(
			previewEmployeeDeactivationAction({
				employeeId,
				replacementManagers: { [reportId]: replacementId },
			}),
		).resolves.toEqual({ success: true, data: plan });
		expect(mocks.previewEmployeeDeactivation).toHaveBeenCalledWith(expect.anything(), {
			organizationId,
			employeeId,
			actorUserId,
			replacementManagers: { [reportId]: replacementId },
			now: expect.anything(),
		});

		mocks.previewEmployeeDeactivation.mockResolvedValueOnce({
			kind: "forbidden",
			code: "admin_targeting_owner",
		});
		await expect(previewEmployeeDeactivationAction({ employeeId })).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		mocks.previewEmployeeDeactivation.mockResolvedValueOnce({
			kind: "invalid",
			code: "already_inactive",
		});
		await expect(previewEmployeeDeactivationAction({ employeeId })).resolves.toEqual({
			success: false,
			code: "ValidationError",
			error: "This employee is already deactivated.",
		});
	});

	it("denies the preview to member and manager settings actors", async () => {
		setup({ accessTier: "manager" });

		await expect(previewEmployeeDeactivationAction({ employeeId })).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.previewEmployeeDeactivation).not.toHaveBeenCalled();
	});

	it("exposes lifecycle wrappers from the employee action aggregator", () => {
		const source = readFileSync(
			new URL("./actions.ts", import.meta.url),
			"utf8",
		);

		expect(source).toContain("export async function deactivateEmployee(");
		expect(source).toContain("return deactivateEmployeeAction(input)");
		expect(source).toContain("export async function previewEmployeeDeactivation(");
		expect(source).toContain("return previewEmployeeDeactivationAction(input)");
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
			actorUserId: "actor-user",
		});
		expect(mocks.authRemoveMember).not.toHaveBeenCalled();
		expect(mocks.revalidateEmployeesCache).toHaveBeenCalledExactlyOnceWith(
			organizationId,
		);
	});

	it("delegates removal by membership ID with the actor organization and request headers", async () => {
		const { requestHeaders } = setupRemoval();
		coordination.removalsInside = 0;

		const result = await removeEmployeeAccessAction(employeeId);

		expect(result).toEqual({ success: true, data: undefined });
		expect(coordination.removalsInside).toBe(1);
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
			actorUserId: "actor-user",
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
			new URL("../organization/actions.ts", import.meta.url),
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
