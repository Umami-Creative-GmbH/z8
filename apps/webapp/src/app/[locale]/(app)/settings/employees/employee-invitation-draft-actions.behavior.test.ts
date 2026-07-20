import { PgDialect } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invitation } from "@/db/auth-schema";
import { employeeInvitationDraft } from "@/db/schema";
import { AuthorizationError, DatabaseError } from "@/lib/effect/errors";
import { toServerActionResult } from "@/lib/effect/result";
import {
	type InvitationDraftEligibilityModel,
	predicateMatchesInvitationDraftModel,
} from "./employee-invitation-draft-condition-fake.test-utils";

const mocks = vi.hoisted(() => ({
	ensureEmployeeProfiles: vi.fn(),
	getEmployeeSettingsActorContext: vi.fn(),
	predicateInputs: vi.fn(),
	requireOrgAdminEmployeeSettingsAccess: vi.fn(),
	revalidateEmployeesCache: vi.fn(),
	validateInput: vi.fn(),
}));

vi.mock("@/lib/auth/organization-member-provisioning", () => ({
	ensureEmployeeProfilesForOrganizationMembers: mocks.ensureEmployeeProfiles,
}));

vi.mock("@/lib/effect/runtime", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/effect/runtime")>();
	const { Layer } = await import("effect");
	return { ...actual, AppLayer: Layer.empty };
});

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty: vi.fn(),
	requestEmployeeWorkBalanceFullRebuild: vi.fn(),
}));

vi.mock("./employee-action-utils", () => ({
	ensureSettingsActorCanAccessEmployeeTarget: vi.fn(() => Effect.void),
	getEmployeeContext: vi.fn(),
	getEmployeeSettingsActorContext: mocks.getEmployeeSettingsActorContext,
	getTargetEmployee: vi.fn(),
	getTargetUser: vi.fn(),
	hasAppAccessChanges: vi.fn(() => false),
	parseHourlyRate: vi.fn(() => null),
	requireOrgAdminEmployeeSettingsAccess:
		mocks.requireOrgAdminEmployeeSettingsAccess,
	revalidateEmployeesCache: mocks.revalidateEmployeesCache,
	runTracedEmployeeAction: vi.fn(async (options) => {
		const exit = await Effect.runPromiseExit(
			options.execute({ setAttribute: vi.fn() }),
		);
		return toServerActionResult(exit);
	}),
	validateInput: mocks.validateInput,
}));

vi.mock("./employee-invitation-draft-eligibility", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("./employee-invitation-draft-eligibility")
		>();
	return {
		...actual,
		buildEligibleInvitationDraftPredicate: (input: {
			organizationId: string;
			now: Date;
			draftId?: string;
		}) => {
			mocks.predicateInputs(input);
			return actual.buildEligibleInvitationDraftPredicate(input);
		},
	};
});

import { updateEmployeeInvitationDraftAction } from "./employee-mutations.actions";
import {
	getEmployeeAction,
	listEmployeesAction,
} from "./employee-queries.actions";

const baseModel: InvitationDraftEligibilityModel = {
	draft: {
		id: "11111111-1111-4111-8111-111111111111",
		invitationId: "invitation-1",
		organizationId: "org-1",
		normalizedEmail: "invitee@example.com",
	},
	invitation: {
		id: "invitation-1",
		organizationId: "org-1",
		status: "pending",
		expiresAt: new Date("2099-01-01T00:00:00.000Z"),
	},
	employees: [],
};

const eligibilityCases: Array<{
	name: string;
	model: InvitationDraftEligibilityModel;
	eligible: boolean;
}> = [
	{ name: "pending future", model: baseModel, eligible: true },
	{
		name: "accepted",
		model: {
			...baseModel,
			invitation: { ...baseModel.invitation, status: "accepted" },
		},
		eligible: false,
	},
	{
		name: "canceled",
		model: {
			...baseModel,
			invitation: { ...baseModel.invitation, status: "canceled" },
		},
		eligible: false,
	},
	{
		name: "rejected",
		model: {
			...baseModel,
			invitation: { ...baseModel.invitation, status: "rejected" },
		},
		eligible: false,
	},
	{
		name: "expired",
		model: {
			...baseModel,
			invitation: {
				...baseModel.invitation,
				expiresAt: new Date("2000-01-01T00:00:00.000Z"),
			},
		},
		eligible: false,
	},
	{
		name: "same-org employee identity",
		model: {
			...baseModel,
			employees: [
				{ organizationId: "org-1", userEmail: " Invitee@Example.com " },
			],
		},
		eligible: false,
	},
	{
		name: "same email employee in another org",
		model: {
			...baseModel,
			employees: [
				{ organizationId: "org-2", userEmail: " Invitee@Example.com " },
			],
		},
		eligible: true,
	},
	{
		name: "draft in another organization",
		model: {
			...baseModel,
			draft: { ...baseModel.draft, organizationId: "org-2" },
		},
		eligible: false,
	},
	{
		name: "invitation in another organization",
		model: {
			...baseModel,
			invitation: { ...baseModel.invitation, organizationId: "org-2" },
		},
		eligible: false,
	},
];

function draftRow(model: InvitationDraftEligibilityModel) {
	return {
		draft: {
			...model.draft,
			teamId: null,
			role: "employee",
			firstName: "Ada",
			lastName: "Lovelace",
			position: null,
			employeeNumber: null,
			gender: null,
			pronouns: null,
			birthday: null,
			startDate: null,
			endDate: null,
			contractType: "fixed",
			currentHourlyRate: null,
			updatedBy: null,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		},
		invitation: {
			...model.invitation,
			email: "invitee@example.com",
			role: "member",
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			inviterId: "admin-user-1",
			canCreateOrganizations: false,
			targetTeamId: null,
		},
		team: null,
	};
}

function createConditionAwareDb(
	model: InvitationDraftEligibilityModel,
	options: {
		afterIdentityLock?: () => void;
		afterInvitationLock?: () => void;
		beforeDraftLock?: () => void;
		forceZeroRowUpdate?: boolean;
		serializationConflict?: Error & { code: string };
	} = {},
) {
	const draftSources: unknown[] = [];
	const draftLockPredicates: unknown[] = [];
	const events: string[] = [];
	const identityLockQueries: unknown[] = [];
	const lockPredicates: unknown[] = [];
	const predicates: unknown[] = [];
	const updatedTables: unknown[] = [];
	const updateValues: unknown[] = [];
	const updatePredicates: unknown[] = [];

	const select = vi.fn((selection: Record<string, unknown>) => {
		let source: unknown;
		let wherePredicate: unknown;
		const rows: unknown[] = Object.hasOwn(selection, "total")
			? [{ total: 0 }]
			: [];
		let chain: Record<string, unknown>;
		const methods = {
			from(table: unknown) {
				source = table;
				if (table === employeeInvitationDraft) draftSources.push(table);
				return chain;
			},
			innerJoin() {
				return chain;
			},
			leftJoin() {
				return chain;
			},
			leftJoinLateral() {
				return chain;
			},
			where(predicate: unknown) {
				wherePredicate = predicate;
				if (source === employeeInvitationDraft) {
					predicates.push(predicate);
					const matchingRow = Object.hasOwn(selection, "draft")
						? draftRow(model)
						: {
								id: model.draft.id,
								invitationId: model.draft.invitationId,
								normalizedEmail: model.draft.normalizedEmail,
							};
					const matchingRows = predicateMatchesInvitationDraftModel(
						predicate,
						model,
					)
						? [matchingRow]
						: [];
					rows.splice(0, rows.length, ...matchingRows);
				} else if (source === invitation) {
					lockPredicates.push(predicate);
					rows.splice(0, rows.length, { id: model.invitation.id });
				}
				return chain;
			},
			orderBy() {
				return chain;
			},
			limit() {
				return chain;
			},
			offset() {
				return chain;
			},
			as() {
				return chain;
			},
			for(lockMode: string) {
				if (source === employeeInvitationDraft) {
					if (predicates.at(-1) === wherePredicate) predicates.pop();
					draftLockPredicates.push(wherePredicate);
					options.beforeDraftLock?.();
					rows.splice(0, rows.length, {
						id: model.draft.id,
						invitationId: model.draft.invitationId,
					});
					events.push(`lock:draft:${lockMode}`);
				} else if (source === invitation) {
					events.push(`lock:invitation:${lockMode}`);
					options.afterInvitationLock?.();
				}
				return Promise.resolve(rows);
			},
		};
		chain = new Proxy(Promise.resolve(rows), {
			get(target, property) {
				if (property in methods)
					return methods[property as keyof typeof methods];
				const value = Reflect.get(target, property, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		return chain;
	});

	const update = vi.fn((table: unknown) => {
		events.push("update");
		updatedTables.push(table);
		return {
			set: vi.fn((values: unknown) => {
				updateValues.push(values);
				const where = vi.fn((predicate: unknown) => {
					updatePredicates.push(predicate);
					return {
						returning: vi
							.fn()
							.mockResolvedValue(
								options.forceZeroRowUpdate ||
									!predicateMatchesInvitationDraftModel(predicate, model)
									? []
									: [{ id: model.draft.id }],
							),
					};
				});
				return {
					from: vi.fn(() => ({ where })),
					where,
				};
			}),
		};
	});
	const execute = vi.fn(async (query: unknown) => {
		identityLockQueries.push(query);
		events.push("lock:identity");
		options.afterIdentityLock?.();
	});
	const transaction = vi.fn(
		async (run, config?: { isolationLevel?: string }) => {
			const result = await run({ execute, select, update });
			if (
				options.serializationConflict &&
				config?.isolationLevel === "serializable"
			) {
				throw options.serializationConflict;
			}
			return result;
		},
	);

	return {
		dbService: {
			db: {
				select,
				transaction,
				update,
				query: {
					team: { findFirst: vi.fn().mockResolvedValue({ id: "team-1" }) },
				},
			},
			query: vi.fn((name: string, run: () => Promise<unknown>) =>
				Effect.tryPromise({
					try: run,
					catch: (cause) =>
						new DatabaseError({
							message: `Database query failed: ${name}`,
							operation: name,
							cause,
						}),
				}),
			),
		},
		draftSources,
		draftLockPredicates,
		events,
		identityLockQueries,
		lockPredicates,
		predicates,
		transaction,
		execute,
		update,
		updatedTables,
		updateValues,
		updatePredicates,
	};
}

function setActor(
	accessTier: "orgAdmin" | "manager",
	dbService: ReturnType<typeof createConditionAwareDb>["dbService"],
) {
	mocks.getEmployeeSettingsActorContext.mockReturnValue(
		Effect.succeed({
			accessTier,
			organizationId: "org-1",
			session: { user: { id: "admin-user-1", email: "admin@example.com" } },
			currentEmployee: {
				id: "22222222-2222-4222-8222-222222222222",
				role: accessTier === "orgAdmin" ? "admin" : "manager",
			},
			dbService,
		}),
	);
}

describe("invitation draft action eligibility", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		mocks.ensureEmployeeProfiles.mockResolvedValue(undefined);
		mocks.requireOrgAdminEmployeeSettingsAccess.mockReturnValue(Effect.void);
		mocks.validateInput.mockImplementation((_schema, data) =>
			Effect.succeed(data),
		);
	});

	afterEach(() => {
		vi.mocked(console.error).mockRestore();
		vi.useRealTimers();
	});

	it.each(eligibilityCases)("list: $name eligibility is $eligible", async ({
		model,
		eligible,
	}) => {
		const fake = createConditionAwareDb(model);
		setActor("orgAdmin", fake.dbService);

		const result = await listEmployeesAction();

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.employees).toHaveLength(eligible ? 1 : 0);
		expect(fake.predicates).toHaveLength(1);
		expect(mocks.predicateInputs).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1" }),
		);
	});

	it.each(eligibilityCases)("detail: $name eligibility is $eligible", async ({
		model,
		eligible,
	}) => {
		const fake = createConditionAwareDb(model);
		setActor("orgAdmin", fake.dbService);

		const result = await getEmployeeAction(`draft:${model.draft.id}`);

		expect(result.success).toBe(eligible);
		if (!eligible) {
			expect(result).toEqual({
				success: false,
				error: "Employee not found",
				code: "NotFoundError",
			});
		}
		expect(fake.predicates).toHaveLength(1);
		expect(mocks.predicateInputs).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				draftId: model.draft.id,
			}),
		);
	});

	it.each(eligibilityCases)("edit: $name eligibility is $eligible", async ({
		model,
		eligible,
	}) => {
		const fake = createConditionAwareDb(model);
		setActor("orgAdmin", fake.dbService);

		const result = await updateEmployeeInvitationDraftAction(
			`draft:${model.draft.id}`,
			{
				position: "Changed",
			},
		);

		expect(result.success).toBe(eligible);
		expect(fake.update).toHaveBeenCalledTimes(eligible ? 1 : 0);
		if (model.draft.organizationId === "org-1") {
			expect(mocks.predicateInputs).toHaveBeenCalledOnce();
			expect(mocks.predicateInputs).toHaveBeenCalledWith(
				expect.objectContaining({
					organizationId: "org-1",
					draftId: model.draft.id,
				}),
			);
		} else {
			expect(mocks.predicateInputs).not.toHaveBeenCalled();
		}
		if (eligible) {
			expect(mocks.revalidateEmployeesCache).toHaveBeenCalledWith("org-1");
		} else {
			expect(result).toEqual(
				expect.objectContaining({
					success: false,
					error: "This invitation draft can no longer be edited",
					code: "ValidationError",
				}),
			);
		}
	});

	it("manager list never queries invitation drafts", async () => {
		const fake = createConditionAwareDb(baseModel);
		setActor("manager", fake.dbService);

		const result = await listEmployeesAction();

		expect(result).toEqual({
			success: true,
			data: { employees: [], total: 0, hasMore: false },
		});
		expect(fake.draftSources).toHaveLength(0);
		expect(mocks.predicateInputs).not.toHaveBeenCalled();
	});

	it("manager detail cannot query an invitation draft", async () => {
		const fake = createConditionAwareDb(baseModel);
		setActor("manager", fake.dbService);

		const result = await getEmployeeAction(`draft:${baseModel.draft.id}`);

		expect(result).toEqual({
			success: false,
			error: "Employee not found",
			code: "NotFoundError",
		});
		expect(fake.draftSources).toHaveLength(0);
		expect(mocks.predicateInputs).not.toHaveBeenCalled();
	});

	it("manager edit is denied before invitation draft lookup", async () => {
		const fake = createConditionAwareDb(baseModel);
		setActor("manager", fake.dbService);
		mocks.requireOrgAdminEmployeeSettingsAccess.mockReturnValue(
			Effect.fail(
				new AuthorizationError({
					message:
						"Only organization admins can update invited employee drafts",
					userId: "manager-user-1",
					resource: "employee_invitation_draft",
					action: "update",
				}),
			),
		);

		const result = await updateEmployeeInvitationDraftAction(
			`draft:${baseModel.draft.id}`,
			{
				position: "Changed",
			},
		);

		expect(result).toEqual({
			success: false,
			error: "Only organization admins can update invited employee drafts",
			code: "AuthorizationError",
		});
		expect(fake.draftSources).toHaveLength(0);
		expect(mocks.predicateInputs).not.toHaveBeenCalled();
	});

	it("locks the organization invitation before updating the draft", async () => {
		const model = structuredClone(baseModel);
		const fake = createConditionAwareDb(model);
		setActor("orgAdmin", fake.dbService);

		const result = await updateEmployeeInvitationDraftAction(
			`draft:${model.draft.id}`,
			{
				position: "Changed",
			},
		);

		expect(result.success).toBe(true);
		expect(fake.transaction).toHaveBeenCalledOnce();
		expect(fake.transaction).toHaveBeenCalledWith(expect.any(Function), {
			isolationLevel: "serializable",
		});
		expect(fake.events).toEqual([
			"lock:identity",
			"lock:draft:update",
			"lock:invitation:update",
			"update",
		]);
		expect(fake.execute.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.predicateInputs.mock.invocationCallOrder[0],
		);
		const draftLockQuery = new PgDialect().sqlToQuery(
			fake.draftLockPredicates[0] as never,
		);
		expect(draftLockQuery.sql).toContain(
			'"employee_invitation_draft"."organization_id"',
		);
		expect(draftLockQuery.params).toEqual([model.draft.id, "org-1"]);
		const identityLockQuery = new PgDialect().sqlToQuery(
			fake.identityLockQueries[0] as never,
		);
		expect(identityLockQuery.params).toEqual([
			"org-1",
			model.draft.normalizedEmail,
		]);
		const lockQuery = new PgDialect().sqlToQuery(
			fake.lockPredicates[0] as never,
		);
		expect(lockQuery.sql).toContain('"invitation"."id"');
		expect(lockQuery.sql).toContain('"invitation"."organization_id"');
		expect(lockQuery.params).toEqual([model.invitation.id, "org-1"]);
		const updateQuery = new PgDialect().sqlToQuery(
			fake.updatePredicates[0] as never,
		);
		expect(updateQuery.sql).toContain(
			'"employee_invitation_draft"."organization_id"',
		);
		expect(updateQuery.params).toEqual([model.draft.id, "org-1"]);
	});

	it.each([
		["changes", "22222222-2222-4222-8222-222222222222"],
		["clears", null],
	] as const)("atomically %s the draft and linked invitation team", async (_case, teamId) => {
		const model = structuredClone(baseModel);
		const fake = createConditionAwareDb(model);
		setActor("orgAdmin", fake.dbService);

		const result = await updateEmployeeInvitationDraftAction(
			`draft:${model.draft.id}`,
			{ teamId },
		);

		expect(result).toMatchObject({ success: true });
		expect(fake.transaction).toHaveBeenCalledOnce();
		expect(fake.updatedTables).toEqual([employeeInvitationDraft, invitation]);
		expect(fake.updateValues).toEqual([
			expect.objectContaining({ teamId }),
			{ targetTeamId: teamId },
		]);
		const invitationUpdate = new PgDialect().sqlToQuery(
			fake.updatePredicates[1] as never,
		);
		expect(invitationUpdate.params).toEqual([
			model.invitation.id,
			"org-1",
			"pending",
		]);
	});

	it("does not update when acceptance wins while the edit waits for the invitation lock", async () => {
		const model = structuredClone(baseModel);
		const fake = createConditionAwareDb(model, {
			afterInvitationLock: () => {
				model.invitation.status = "accepted";
			},
		});
		setActor("orgAdmin", fake.dbService);

		const result = await updateEmployeeInvitationDraftAction(
			`draft:${model.draft.id}`,
			{
				position: "Changed",
			},
		);

		expect(result).toEqual(
			expect.objectContaining({ success: false, code: "ValidationError" }),
		);
		expect(fake.events).toEqual([
			"lock:identity",
			"lock:draft:update",
			"lock:invitation:update",
		]);
		expect(fake.update).not.toHaveBeenCalled();
	});

	it("fails safely when the locked update affects zero rows", async () => {
		const model = structuredClone(baseModel);
		const fake = createConditionAwareDb(model, { forceZeroRowUpdate: true });
		setActor("orgAdmin", fake.dbService);

		const result = await updateEmployeeInvitationDraftAction(
			`draft:${model.draft.id}`,
			{
				position: "Changed",
			},
		);

		expect(result).toEqual(
			expect.objectContaining({ success: false, code: "ValidationError" }),
		);
		expect(fake.events).toEqual([
			"lock:identity",
			"lock:draft:update",
			"lock:invitation:update",
			"update",
		]);
		expect(mocks.revalidateEmployeesCache).not.toHaveBeenCalled();
	});

	it("excludes an invitation that expires during employee reconciliation", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-18T10:00:00.000Z"));
		const model = structuredClone(baseModel);
		model.invitation.expiresAt = new Date("2026-07-18T10:01:00.000Z");
		mocks.ensureEmployeeProfiles.mockImplementation(async () => {
			vi.setSystemTime(new Date("2026-07-18T10:02:00.000Z"));
		});
		const fake = createConditionAwareDb(model);
		setActor("orgAdmin", fake.dbService);

		const result = await listEmployeesAction();

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.employees).toHaveLength(0);
		expect(mocks.predicateInputs).toHaveBeenCalledWith(
			expect.objectContaining({ now: new Date("2026-07-18T10:02:00.000Z") }),
		);
	});

	it("excludes an invitation that expires during edit validation", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-18T10:00:00.000Z"));
		const model = structuredClone(baseModel);
		model.invitation.expiresAt = new Date("2026-07-18T10:01:00.000Z");
		mocks.validateInput.mockImplementation((_schema, data) => {
			vi.setSystemTime(new Date("2026-07-18T10:02:00.000Z"));
			return Effect.succeed(data);
		});
		const fake = createConditionAwareDb(model);
		setActor("orgAdmin", fake.dbService);

		const result = await updateEmployeeInvitationDraftAction(
			`draft:${model.draft.id}`,
			{
				position: "Changed",
			},
		);

		expect(result).toEqual(
			expect.objectContaining({ success: false, code: "ValidationError" }),
		);
		expect(fake.transaction).toHaveBeenCalledOnce();
		expect(fake.update).not.toHaveBeenCalled();
	});

	it("uses a fresh instant after waiting for the invitation lock", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-18T10:00:00.000Z"));
		const model = structuredClone(baseModel);
		model.invitation.expiresAt = new Date("2026-07-18T10:01:00.000Z");
		const fake = createConditionAwareDb(model, {
			afterInvitationLock: () => {
				vi.setSystemTime(new Date("2026-07-18T10:02:00.000Z"));
			},
		});
		setActor("orgAdmin", fake.dbService);

		const result = await updateEmployeeInvitationDraftAction(
			`draft:${model.draft.id}`,
			{
				position: "Changed",
			},
		);

		expect(result).toEqual(
			expect.objectContaining({ success: false, code: "ValidationError" }),
		);
		expect(fake.update).not.toHaveBeenCalled();
		expect(mocks.predicateInputs).toHaveBeenLastCalledWith(
			expect.objectContaining({ now: new Date("2026-07-18T10:02:00.000Z") }),
		);
	});

	it("locks a concurrently reassigned current invitation and cannot authorize with the stale original", async () => {
		const model = structuredClone(baseModel);
		const originalInvitationId = model.invitation.id;
		const replacementInvitationId = "invitation-2";
		const fake = createConditionAwareDb(model, {
			beforeDraftLock: () => {
				model.draft.invitationId = replacementInvitationId;
				model.invitation = {
					...model.invitation,
					id: replacementInvitationId,
					status: "accepted",
				};
			},
		});
		setActor("orgAdmin", fake.dbService);

		const result = await updateEmployeeInvitationDraftAction(
			`draft:${model.draft.id}`,
			{ position: "Changed" },
		);

		expect(result).toEqual(
			expect.objectContaining({ success: false, code: "ValidationError" }),
		);
		expect(fake.events).toEqual([
			"lock:identity",
			"lock:draft:update",
			"lock:invitation:update",
		]);
		const invitationLockQuery = new PgDialect().sqlToQuery(
			fake.lockPredicates[0] as never,
		);
		expect(invitationLockQuery.params).toEqual([
			replacementInvitationId,
			"org-1",
		]);
		expect(invitationLockQuery.params).not.toContain(originalInvitationId);
		expect(fake.update).not.toHaveBeenCalled();
	});

	it("rejects an edit when direct provisioning creates the same identity before its lock is acquired", async () => {
		const model = structuredClone(baseModel);
		const fake = createConditionAwareDb(model, {
			afterIdentityLock: () => {
				model.employees.push({
					organizationId: model.draft.organizationId,
					userEmail: model.draft.normalizedEmail,
				});
			},
		});
		setActor("orgAdmin", fake.dbService);

		const result = await updateEmployeeInvitationDraftAction(
			`draft:${model.draft.id}`,
			{ position: "Changed" },
		);

		expect(result).toEqual(
			expect.objectContaining({ success: false, code: "ValidationError" }),
		);
		expect(fake.events).toEqual([
			"lock:identity",
			"lock:draft:update",
			"lock:invitation:update",
		]);
		expect(fake.update).not.toHaveBeenCalled();
	});

	it("returns a safe failure when PostgreSQL aborts the serializable transaction", async () => {
		const model = structuredClone(baseModel);
		const serializationConflict = Object.assign(
			new Error(
				"could not serialize access due to read/write dependencies among transactions",
			),
			{ code: "40001" },
		);
		const fake = createConditionAwareDb(model, { serializationConflict });
		setActor("orgAdmin", fake.dbService);

		const result = await updateEmployeeInvitationDraftAction(
			`draft:${model.draft.id}`,
			{ position: "Changed" },
		);

		expect(result).toEqual({
			success: false,
			error: "Database query failed: updateEmployeeInvitationDraft",
			code: "DatabaseError",
		});
		expect(result.error).not.toContain(serializationConflict.message);
		expect(fake.update).toHaveBeenCalledOnce();
		expect(mocks.revalidateEmployeesCache).not.toHaveBeenCalled();
	});
});
