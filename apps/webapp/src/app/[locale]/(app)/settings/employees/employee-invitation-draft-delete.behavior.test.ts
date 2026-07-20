import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invitation } from "@/db/auth-schema";
import { employee, employeeInvitationDraft } from "@/db/schema";
import { AuthorizationError, DatabaseError } from "@/lib/effect/errors";
import { toServerActionResult } from "@/lib/effect/result";

const mocks = vi.hoisted(() => ({
	getEmployeeSettingsActorContext: vi.fn(),
	loggerError: vi.fn(),
	requireOrgAdminEmployeeSettingsAccess: vi.fn(),
	revalidateEmployeesCache: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: mocks.loggerError, info: vi.fn() }),
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
	validateInput: vi.fn((_schema, data) => Effect.succeed(data)),
}));

import { deleteEmployeeInvitationDraftAction } from "./employee-mutations.actions";

const draftId = "11111111-1111-4111-8111-111111111111";

type DeleteModel = {
	draft: {
		id: string;
		invitationId: string;
		organizationId: string;
		normalizedEmail: string;
	};
	invitation: {
		id: string;
		organizationId: string;
		status: string;
		expiresAt: Date;
	};
	employees: Array<{ id: string; organizationId: string; email: string }>;
};

function createModel(): DeleteModel {
	return {
		draft: {
			id: draftId,
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
}

function createDeleteDb(
	model: DeleteModel,
	options: {
		beforeInvitationConditionalUpdate?: () => void;
		beforeInvitationLock?: () => void;
		forceZeroDelete?: boolean;
	} = {},
) {
	const deletePredicates: unknown[] = [];
	const deletedTables: unknown[] = [];
	const draftPredicates: unknown[] = [];
	const events: string[] = [];
	const identityLockQueries: unknown[] = [];
	const invitationPredicates: unknown[] = [];
	const invitationUpdatePredicates: unknown[] = [];
	const invitationUpdateValues: unknown[] = [];

	const select = vi.fn((_selection: Record<string, unknown>) => {
		let source: unknown;
		const rows: unknown[] = [];
		let chain: Record<string, unknown>;
		const methods = {
			from(table: unknown) {
				source = table;
				return chain;
			},
			innerJoin() {
				return chain;
			},
			where(predicate: unknown) {
				if (source === employeeInvitationDraft) {
					draftPredicates.push(predicate);
					const matchingRows =
						model.draft.id === draftId &&
						model.draft.organizationId === "org-1" &&
						model.invitation.organizationId === "org-1" &&
						model.draft.invitationId === model.invitation.id
							? [
									{
										id: model.draft.id,
										invitationId: model.draft.invitationId,
										normalizedEmail: model.draft.normalizedEmail,
										invitationStatus: model.invitation.status,
										invitationExpiresAt: model.invitation.expiresAt,
									},
								]
							: [];
					rows.splice(0, rows.length, ...matchingRows);
				} else if (source === employee) {
					const matchingRows = model.employees
						.filter(
							(candidate) =>
								candidate.organizationId === "org-1" &&
								candidate.email.trim().toLowerCase() ===
									model.draft.normalizedEmail,
						)
						.map(({ id }) => ({ id }));
					rows.splice(0, rows.length, ...matchingRows);
				} else if (source === invitation) {
					invitationPredicates.push(predicate);
					const matchingRows =
						model.invitation.id === model.draft.invitationId &&
						model.invitation.organizationId === "org-1"
							? [{ ...model.invitation }]
							: [];
					rows.splice(0, rows.length, ...matchingRows);
				}
				return chain;
			},
			limit() {
				return chain;
			},
			for(mode: string) {
				if (source === invitation) {
					options.beforeInvitationLock?.();
					rows.splice(0, rows.length, { ...model.invitation });
				}
				events.push(
					`lock:${source === invitation ? "invitation" : "draft"}:${mode}`,
				);
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

	const deleteFrom = vi.fn((table: unknown) => {
		deletedTables.push(table);
		events.push("delete:draft");
		return {
			where: vi.fn((predicate: unknown) => {
				deletePredicates.push(predicate);
				return {
					returning: vi.fn().mockImplementation(async () => {
						if (options.forceZeroDelete) return [];
						return model.draft.invitationId === model.invitation.id
							? [{ id: model.draft.id }]
							: [];
					}),
				};
			}),
		};
	});
	const update = vi.fn((table: unknown) => ({
		set: vi.fn((values: { status?: string }) => {
			if (table === invitation) invitationUpdateValues.push(values);
			return {
				where: vi.fn((predicate: unknown) => {
					if (table === invitation) invitationUpdatePredicates.push(predicate);
					return {
						returning: vi.fn().mockImplementation(async () => {
							if (table !== invitation) return [];
							events.push("update:invitation");
							options.beforeInvitationConditionalUpdate?.();
							const isCurrentActionableInvitation =
								model.invitation.id === model.draft.invitationId &&
								model.invitation.organizationId === "org-1" &&
								model.invitation.status === "pending" &&
								model.invitation.expiresAt.getTime() > Date.now();
							if (!isCurrentActionableInvitation) return [];
							model.invitation.status =
								values.status ?? model.invitation.status;
							return [{ id: model.invitation.id }];
						}),
					};
				}),
			};
		}),
	}));
	const execute = vi.fn(async (query: unknown) => {
		identityLockQueries.push(query);
		events.push("lock:identity");
	});
	const transaction = vi.fn(async (run) =>
		run({ delete: deleteFrom, execute, select, update }),
	);

	return {
		dbService: {
			db: { transaction },
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
		deletePredicates,
		deletedTables,
		draftPredicates,
		events,
		identityLockQueries,
		invitationPredicates,
		invitationUpdatePredicates,
		invitationUpdateValues,
		transaction,
		update,
	};
}

function setActor(dbService: ReturnType<typeof createDeleteDb>["dbService"]) {
	mocks.getEmployeeSettingsActorContext.mockReturnValue(
		Effect.succeed({
			accessTier: "orgAdmin",
			organizationId: "org-1",
			session: { user: { id: "admin-1", email: "admin@example.com" } },
			currentEmployee: { id: "admin-employee-1", role: "admin" },
			dbService,
		}),
	);
}

describe("deleteEmployeeInvitationDraftAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireOrgAdminEmployeeSettingsAccess.mockReturnValue(Effect.void);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("is exported through the employee actions wrapper", () => {
		const source = readFileSync(
			new URL("./actions.ts", import.meta.url),
			"utf8",
		);
		expect(source).toContain("deleteEmployeeInvitationDraftAction");
		expect(source).toContain("deleteEmployeeInvitationDraft(");
	});

	it("decodes the draft ID and scopes both draft and invitation to the actor organization", async () => {
		const model = createModel();
		model.invitation.status = "canceled";
		const fake = createDeleteDb(model);
		setActor(fake.dbService);

		const result = await deleteEmployeeInvitationDraftAction(
			`draft:${draftId}`,
		);

		expect(result).toEqual({ success: true, data: undefined });
		const draftQuery = new PgDialect().sqlToQuery(
			fake.draftPredicates[1] as never,
		);
		expect(draftQuery.sql).toContain(
			'"employee_invitation_draft"."organization_id"',
		);
		expect(draftQuery.sql).toContain('"invitation"."organization_id"');
		expect(draftQuery.params).toEqual([draftId, "org-1", "org-1"]);
	});

	it("denies non-admin settings actors before loading a draft", async () => {
		const fake = createDeleteDb(createModel());
		setActor(fake.dbService);
		mocks.requireOrgAdminEmployeeSettingsAccess.mockReturnValue(
			Effect.fail(
				new AuthorizationError({
					message:
						"Only organization admins can delete invited employee drafts",
					userId: "manager-1",
					resource: "employee_invitation_draft",
					action: "delete",
				}),
			),
		);

		const result = await deleteEmployeeInvitationDraftAction(
			`draft:${draftId}`,
		);

		expect(result).toEqual(
			expect.objectContaining({ success: false, code: "AuthorizationError" }),
		);
		expect(fake.transaction).not.toHaveBeenCalled();
	});

	it("does not cancel or delete when the same normalized email already has an employee", async () => {
		const model = createModel();
		model.employees.push({
			id: "employee-1",
			organizationId: "org-1",
			email: " Invitee@Example.com ",
		});
		const fake = createDeleteDb(model);
		setActor(fake.dbService);

		const result = await deleteEmployeeInvitationDraftAction(
			`draft:${draftId}`,
		);

		expect(result).toEqual(
			expect.objectContaining({ success: false, code: "ValidationError" }),
		);
		expect(fake.update).not.toHaveBeenCalled();
		expect(fake.deletedTables).toHaveLength(0);
	});

	it("atomically cancels an actionable invitation before deleting only its draft", async () => {
		const model = createModel();
		const fake = createDeleteDb(model);
		setActor(fake.dbService);

		const result = await deleteEmployeeInvitationDraftAction(
			`draft:${draftId}`,
		);

		expect(result).toEqual({ success: true, data: undefined });
		expect(fake.events).toEqual([
			"lock:identity",
			"lock:draft:update",
			"update:invitation",
			"delete:draft",
		]);
		expect(model.invitation.status).toBe("canceled");
		expect(fake.deletedTables).toEqual([employeeInvitationDraft]);
		expect(fake.deletedTables).not.toContain(invitation);
		expect(mocks.revalidateEmployeesCache).toHaveBeenCalledWith("org-1");
	});

	it.each([
		"expired",
		"canceled",
		"rejected",
	])("deletes a stale %s invitation draft without updating its status", async (status) => {
		const model = createModel();
		model.invitation.status = status === "expired" ? "pending" : status;
		if (status === "expired")
			model.invitation.expiresAt = new Date("2000-01-01T00:00:00.000Z");
		const fake = createDeleteDb(model);
		setActor(fake.dbService);

		const result = await deleteEmployeeInvitationDraftAction(
			`draft:${draftId}`,
		);

		expect(result).toEqual({ success: true, data: undefined });
		expect(fake.update).not.toHaveBeenCalled();
		expect(fake.deletedTables).toEqual([employeeInvitationDraft]);
	});

	it("keeps an accepted draft protected without modifying an employee", async () => {
		const model = createModel();
		model.invitation.status = "accepted";
		const fake = createDeleteDb(model);
		setActor(fake.dbService);

		const result = await deleteEmployeeInvitationDraftAction(
			`draft:${draftId}`,
		);

		expect(result).toEqual(
			expect.objectContaining({ success: false, code: "ValidationError" }),
		);
		expect(fake.update).not.toHaveBeenCalled();
		expect(fake.deletedTables).toHaveLength(0);
	});

	it("retains the draft when acceptance wins immediately before conditional cancellation", async () => {
		const model = createModel();
		const fake = createDeleteDb(model, {
			beforeInvitationConditionalUpdate: () => {
				model.invitation.status = "accepted";
			},
		});
		setActor(fake.dbService);

		const result = await deleteEmployeeInvitationDraftAction(
			`draft:${draftId}`,
		);

		expect(result).toEqual({
			success: false,
			error:
				"The pending invitation could not be canceled. The employee draft was kept.",
			code: "ValidationError",
		});
		expect(model.invitation.status).toBe("accepted");
		expect(fake.events).toEqual([
			"lock:identity",
			"lock:draft:update",
			"update:invitation",
			"lock:invitation:update",
		]);
		expect(fake.deletedTables).toHaveLength(0);
	});

	it("does not delete a draft reattached to another invitation before conditional cancellation", async () => {
		const model = createModel();
		const fake = createDeleteDb(model, {
			beforeInvitationConditionalUpdate: () => {
				model.draft.invitationId = "invitation-2";
			},
		});
		setActor(fake.dbService);

		const result = await deleteEmployeeInvitationDraftAction(
			`draft:${draftId}`,
		);

		expect(result).toEqual(
			expect.objectContaining({ success: false, code: "ValidationError" }),
		);
		expect(model.invitation.status).toBe("pending");
		expect(fake.deletedTables).toHaveLength(0);
		expect(mocks.revalidateEmployeesCache).not.toHaveBeenCalled();
	});

	it("handles a zero-row conditional delete as a safe race loss", async () => {
		const model = createModel();
		model.invitation.status = "canceled";
		const fake = createDeleteDb(model, { forceZeroDelete: true });
		setActor(fake.dbService);

		const result = await deleteEmployeeInvitationDraftAction(
			`draft:${draftId}`,
		);

		expect(result).toEqual(
			expect.objectContaining({ success: false, code: "ValidationError" }),
		);
		expect(mocks.revalidateEmployeesCache).not.toHaveBeenCalled();
	});

	it("keeps a stale draft when resend makes its invitation actionable before deletion", async () => {
		const model = createModel();
		model.invitation.status = "canceled";
		const fake = createDeleteDb(model, {
			beforeInvitationLock: () => {
				model.invitation.status = "pending";
				model.invitation.expiresAt = new Date("2099-01-01T00:00:00.000Z");
			},
		});
		setActor(fake.dbService);

		const result = await deleteEmployeeInvitationDraftAction(
			`draft:${draftId}`,
		);

		expect(result).toEqual(
			expect.objectContaining({ success: false, code: "ValidationError" }),
		);
		expect(fake.update).not.toHaveBeenCalled();
		expect(fake.deletedTables).toHaveLength(0);
	});

	it("cannot load or delete a draft or invitation from another organization", async () => {
		const model = createModel();
		model.invitation.organizationId = "org-2";
		const fake = createDeleteDb(model);
		setActor(fake.dbService);

		const result = await deleteEmployeeInvitationDraftAction(
			`draft:${draftId}`,
		);

		expect(result).toEqual(
			expect.objectContaining({ success: false, code: "ValidationError" }),
		);
		expect(fake.update).not.toHaveBeenCalled();
		expect(fake.deletedTables).toHaveLength(0);
	});

	it("scopes the conditional cancellation to current org, pending status, and fresh expiry", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-19T10:15:00.000Z"));
		const model = createModel();
		const fake = createDeleteDb(model);
		setActor(fake.dbService);

		await deleteEmployeeInvitationDraftAction(`draft:${draftId}`);

		const updateQuery = new PgDialect().sqlToQuery(
			fake.invitationUpdatePredicates[0] as never,
		);
		expect(updateQuery.sql).toContain('"invitation"."id"');
		expect(updateQuery.sql).toContain('"invitation"."organization_id"');
		expect(updateQuery.sql).toContain('"invitation"."status"');
		expect(updateQuery.sql).toContain('"invitation"."expires_at" >');
		expect(updateQuery.params.slice(0, 3)).toEqual([
			model.invitation.id,
			"org-1",
			"pending",
		]);
		expect(updateQuery.params[3]).toBe("2026-07-19T10:15:00.000Z");
		expect(fake.invitationUpdateValues).toEqual([{ status: "canceled" }]);
	});

	it("uses parameterized identity and conditional-delete organization scopes", async () => {
		const model = createModel();
		model.invitation.status = "canceled";
		const fake = createDeleteDb(model);
		setActor(fake.dbService);

		await deleteEmployeeInvitationDraftAction(`draft:${draftId}`);

		const identityQuery = new PgDialect().sqlToQuery(
			fake.identityLockQueries[0] as never,
		);
		expect(identityQuery.params).toEqual([
			"org-1",
			model.draft.normalizedEmail,
		]);
		const deleteQuery = new PgDialect().sqlToQuery(
			fake.deletePredicates[0] as never,
		);
		expect(deleteQuery.sql).toContain(
			'"employee_invitation_draft"."organization_id"',
		);
		expect(deleteQuery.sql).toContain(
			'"employee_invitation_draft"."invitation_id"',
		);
		expect(deleteQuery.params).toEqual([draftId, "org-1", model.invitation.id]);
	});
});
