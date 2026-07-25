import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { db as appDb } from "@/db";
import { invitation } from "@/db/auth-schema";
import { employee, employeeInvitationDraft } from "@/db/schema";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	attachInvitationToEmployeeDraft,
	isInvitationActionable,
	normalizeInvitationEmail,
	persistEmployeeInvitationDraft,
	resolveAcceptedInvitationCanCreateOrganizations,
	syncInvitationTargetTeam,
} from "./employee-invitation-draft";

describe("employee invitation draft", () => {
	afterEach(() => {
		vi.useRealTimers();
	});
	it("restricts initial roles to employee draft roles", () => {
		expectTypeOf<
			Parameters<typeof attachInvitationToEmployeeDraft>[1]["initialRole"]
		>().toEqualTypeOf<"admin" | "employee">();
	});

	it("normalizes invitation emails by trimming and lowercasing", () => {
		expect(normalizeInvitationEmail("  Ada.Lovelace@Example.COM  ")).toBe(
			"ada.lovelace@example.com",
		);
	});

	it("treats a pending invitation with a future expiration as actionable", () => {
		const now = parseInstant("2026-07-18T12:00:00Z");

		expect(
			isInvitationActionable(
				{
					status: "pending",
					expiresAt: new Date("2026-07-18T12:00:00.001Z"),
				},
				now,
			),
		).toBe(true);
	});

	it.each([
		"accepted",
		"canceled",
		"rejected",
	])("treats a %s invitation as not actionable", (status) => {
		const now = parseInstant("2026-07-18T12:00:00Z");

		expect(
			isInvitationActionable(
				{
					status,
					expiresAt: new Date("2026-07-19T12:00:00Z"),
				},
				now,
			),
		).toBe(false);
	});

	it.each([
		["at the current instant", "2026-07-18T12:00:00Z"],
		["before the current instant", "2026-07-18T11:59:59.999Z"],
	])("treats a pending invitation expiring %s as not actionable", (_case, expiresAt) => {
		const now = parseInstant("2026-07-18T12:00:00Z");

		expect(
			isInvitationActionable(
				{ status: "pending", expiresAt: new Date(expiresAt) },
				now,
			),
		).toBe(false);
	});

	it("attaches an invitation without overwriting prepared employee fields", async () => {
		const draft = { id: "draft-1", invitationId: "invitation-1" };
		const returning = vi.fn().mockResolvedValue([draft]);
		const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
		const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
		const insert = vi.fn().mockReturnValue({ values });
		const dbClient = { insert } as unknown as typeof appDb;

		const result = await attachInvitationToEmployeeDraft(dbClient, {
			organizationId: "organization-1",
			normalizedEmail: "ada.lovelace@example.com",
			invitationId: "invitation-1",
			canCreateOrganizations: true,
			initialTeamId: "00000000-0000-4000-8000-000000000001",
			initialRole: "employee",
			updatedBy: "user-1",
		});

		expect(insert).toHaveBeenCalledWith(employeeInvitationDraft);
		expect(values).toHaveBeenCalledWith({
			organizationId: "organization-1",
			normalizedEmail: "ada.lovelace@example.com",
			invitationId: "invitation-1",
			canCreateOrganizations: true,
			teamId: "00000000-0000-4000-8000-000000000001",
			role: "employee",
			contractType: "fixed",
			updatedBy: "user-1",
		});
		expect(onConflictDoUpdate).toHaveBeenCalledWith({
			target: [
				employeeInvitationDraft.organizationId,
				employeeInvitationDraft.normalizedEmail,
			],
			set: {
				invitationId: "invitation-1",
				canCreateOrganizations: true,
			},
		});
		expect(Object.keys(onConflictDoUpdate.mock.calls[0]?.[0].set)).toEqual([
			"invitationId",
			"canCreateOrganizations",
		]);
		expect(returning).toHaveBeenCalledOnce();
		expect(result).toBe(draft);
	});

	it("uses the same-organization normalized-email stable draft when replacement persistence failed", async () => {
		const draftFindFirst = vi
			.fn()
			.mockResolvedValue({ canCreateOrganizations: true });
		const dbClient = {
			query: { employeeInvitationDraft: { findFirst: draftFindFirst } },
		} as unknown as typeof appDb;

		await expect(
			resolveAcceptedInvitationCanCreateOrganizations(dbClient, {
				organizationId: "organization-1",
				normalizedEmail: "ada@example.com",
				invitationCanCreateOrganizations: false,
			}),
		).resolves.toBe(true);
		const query = new PgDialect().sqlToQuery(
			draftFindFirst.mock.calls[0]?.[0].where,
		);
		expect(query.params).toEqual(["organization-1", "ada@example.com"]);
	});

	it("does not use stable permission from another organization or email", async () => {
		const foreignDraft = {
			organizationId: "organization-2",
			normalizedEmail: "other@example.com",
			canCreateOrganizations: true,
		};
		const draftFindFirst = vi.fn(async ({ where }) => {
			const query = new PgDialect().sqlToQuery(where);
			return query.params[0] === foreignDraft.organizationId &&
				query.params[1] === foreignDraft.normalizedEmail
				? foreignDraft
				: null;
		});
		const dbClient = {
			query: { employeeInvitationDraft: { findFirst: draftFindFirst } },
		} as unknown as typeof appDb;

		await expect(
			resolveAcceptedInvitationCanCreateOrganizations(dbClient, {
				organizationId: "organization-1",
				email: "ada@example.com",
				invitationCanCreateOrganizations: false,
			}),
		).resolves.toBe(false);
	});

	function createPersistenceDb(
		options: {
			afterIdentityLock?: (model: {
				invitation: {
					id: string;
					organizationId: string;
					email: string;
					status: string;
					expiresAt: Date;
				};
				employeeExists: boolean;
			}) => void;
			beforeInvitationUpdate?: (model: {
				invitation: {
					id: string;
					organizationId: string;
					email: string;
					status: string;
					expiresAt: Date;
				};
				employeeExists: boolean;
			}) => void;
			forceZeroUpdate?: boolean;
		} = {},
	) {
		const model = {
			invitation: {
				id: "invitation-1",
				organizationId: "organization-1",
				email: "ada@example.com",
				status: "pending",
				expiresAt: new Date("2099-01-01T00:00:00.000Z"),
			},
			employeeExists: false,
		};
		const events: string[] = [];
		const updatePredicates: unknown[] = [];
		const updateValues: unknown[] = [];
		const execute = vi.fn(async () => {
			events.push("identity-lock");
			options.afterIdentityLock?.(model);
		});
		const invitationFindFirst = vi.fn(async () => {
			events.push("invitation-read");
			return { ...model.invitation };
		});
		const select = vi.fn(() => {
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
				where() {
					if (source === employee) {
						events.push("employee-read");
						rows.splice(
							0,
							rows.length,
							...(model.employeeExists ? [{ id: "employee-1" }] : []),
						);
					}
					return chain;
				},
				limit() {
					return chain;
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
		const update = vi.fn((table: unknown) => ({
			set: vi.fn((values: unknown) => {
				if (table === invitation) updateValues.push(values);
				return {
					where: vi.fn((predicate: unknown) => {
						if (table === invitation) updatePredicates.push(predicate);
						return {
							returning: vi.fn(async () => {
								events.push("invitation-update");
								options.beforeInvitationUpdate?.(model);
								if (
									options.forceZeroUpdate ||
									model.invitation.status !== "pending" ||
									model.invitation.expiresAt.getTime() <= Date.now()
								) {
									return [];
								}
								return [{ id: model.invitation.id }];
							}),
						};
					}),
				};
			}),
		}));
		const returning = vi.fn(async () => {
			events.push("draft-attach");
			return [{ id: "draft-1", invitationId: model.invitation.id }];
		});
		const onConflictDoUpdate = vi.fn(() => ({ returning }));
		const values = vi.fn(() => ({ onConflictDoUpdate }));
		const insert = vi.fn(() => ({ values }));
		const tx = {
			execute,
			insert,
			query: { invitation: { findFirst: invitationFindFirst } },
			select,
			update,
		};
		const transaction = vi.fn(async (run) => run(tx));
		const db = { transaction } as unknown as typeof appDb;

		return {
			db,
			events,
			insert,
			invitationFindFirst,
			model,
			transaction,
			update,
			updatePredicates,
			updateValues,
		};
	}

	const persistenceInput = {
		organizationId: "organization-1",
		normalizedEmail: "ada@example.com",
		invitationId: "invitation-1",
		canCreateOrganizations: true,
		targetTeamId: "00000000-0000-4000-8000-000000000001",
		initialRole: "employee" as const,
		updatedBy: "user-1",
	};

	it("persists app fields and stable draft in one identity-locked transaction", async () => {
		const fake = createPersistenceDb();

		const result = await persistEmployeeInvitationDraft(
			fake.db,
			persistenceInput,
		);

		expect(result).toEqual({ outcome: "persisted" });
		expect(fake.transaction).toHaveBeenCalledOnce();
		expect(fake.events).toEqual([
			"identity-lock",
			"invitation-read",
			"employee-read",
			"invitation-update",
			"draft-attach",
		]);
		expect(fake.updateValues).toEqual([
			{
				canCreateOrganizations: true,
				targetTeamId: "00000000-0000-4000-8000-000000000001",
			},
		]);
	});

	it("does not recreate a draft when acceptance wins before persistence reads", async () => {
		const fake = createPersistenceDb({
			afterIdentityLock: (model) => {
				model.invitation.status = "accepted";
			},
		});

		const result = await persistEmployeeInvitationDraft(
			fake.db,
			persistenceInput,
		);

		expect(result).toEqual({ outcome: "consumed" });
		expect(fake.model.invitation.status).toBe("accepted");
		expect(fake.update).not.toHaveBeenCalled();
		expect(fake.insert).not.toHaveBeenCalled();
	});

	it("does not recreate a draft when employee provisioning wins before persistence", async () => {
		const fake = createPersistenceDb({
			afterIdentityLock: (model) => {
				model.employeeExists = true;
			},
		});

		const result = await persistEmployeeInvitationDraft(
			fake.db,
			persistenceInput,
		);

		expect(result).toEqual({ outcome: "consumed" });
		expect(fake.update).not.toHaveBeenCalled();
		expect(fake.insert).not.toHaveBeenCalled();
	});

	it("does not overwrite accepted status when acceptance wins before conditional field update", async () => {
		const fake = createPersistenceDb({
			beforeInvitationUpdate: (model) => {
				model.invitation.status = "accepted";
			},
		});

		const result = await persistEmployeeInvitationDraft(
			fake.db,
			persistenceInput,
		);

		expect(result).toEqual({ outcome: "consumed" });
		expect(fake.model.invitation.status).toBe("accepted");
		expect(fake.insert).not.toHaveBeenCalled();
	});

	it("fails when the guarded app-field update affects zero actionable rows", async () => {
		const fake = createPersistenceDb({ forceZeroUpdate: true });

		await expect(
			persistEmployeeInvitationDraft(fake.db, persistenceInput),
		).rejects.toThrow("Invitation persistence conflict");
		expect(fake.insert).not.toHaveBeenCalled();
	});

	it("scopes guarded app-field persistence by invitation, org, email, status, and fresh expiry", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-19T12:00:00.000Z"));
		const fake = createPersistenceDb();

		await persistEmployeeInvitationDraft(fake.db, persistenceInput);

		const query = new PgDialect().sqlToQuery(fake.updatePredicates[0] as never);
		expect(query.sql).toContain('"invitation"."id"');
		expect(query.sql).toContain('"invitation"."organization_id"');
		expect(query.sql).toContain('lower(btrim("invitation"."email"))');
		expect(query.sql).toContain('"invitation"."status"');
		expect(query.sql).toContain('"invitation"."expires_at" >');
		expect(query.params).toEqual([
			"invitation-1",
			"organization-1",
			"ada@example.com",
			"pending",
			"2026-07-19T12:00:00.000Z",
		]);
	});

	function createTeamSyncDb({
		draftExists = true,
		teamExists = true,
		afterInvitationLock,
	}: {
		draftExists?: boolean;
		teamExists?: boolean;
		afterInvitationLock?: (invitationRow: { status: string }) => void;
	} = {}) {
		const invitationRow = {
			id: "invitation-1",
			organizationId: "organization-1",
			email: "ada@example.com",
			status: "pending",
		};
		const draftRow = draftExists
			? {
					id: "draft-1",
					invitationId: "invitation-1",
					organizationId: "organization-1",
					normalizedEmail: "ada@example.com",
				}
			: null;
		const events: string[] = [];
		const updatePredicates: unknown[] = [];
		const updateValues: unknown[] = [];
		const updatedTables: unknown[] = [];
		const execute = vi.fn(async () => events.push("identity-lock"));
		const select = vi.fn(() => {
			let source: unknown;
			let rows: unknown[] = [];
			let chain: Record<string, unknown>;
			const methods = {
				from(table: unknown) {
					source = table;
					return chain;
				},
				where() {
					rows =
						source === employeeInvitationDraft
							? draftRow
								? [draftRow]
								: []
							: source === invitation
								? [invitationRow]
								: [];
					return chain;
				},
				for() {
					if (source === employeeInvitationDraft) events.push("draft-lock");
					if (source === invitation) {
						events.push("invitation-lock");
						afterInvitationLock?.(invitationRow);
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
		const update = vi.fn((table: unknown) => ({
			set: vi.fn((values: unknown) => {
				updatedTables.push(table);
				updateValues.push(values);
				return {
					where: vi.fn((predicate: unknown) => {
						updatePredicates.push(predicate);
						return {
							returning: vi.fn(async () => {
								events.push(
									table === invitation ? "invitation-update" : "draft-update",
								);
								return [
									{
										id: table === invitation ? invitationRow.id : draftRow?.id,
									},
								];
							}),
						};
					}),
				};
			}),
		}));
		const tx = {
			execute,
			select,
			update,
			query: {
				team: {
					findFirst: vi.fn(async () => (teamExists ? { id: "team-1" } : null)),
				},
			},
		};
		const transaction = vi.fn(async (run) => run(tx));

		return {
			db: { transaction } as unknown as typeof appDb,
			events,
			transaction,
			updatePredicates,
			updateValues,
			updatedTables,
		};
	}

	it.each([
		"team-1",
		null,
	] as const)("updates invitation and stable draft atomically for team %s", async (targetTeamId) => {
		const fake = createTeamSyncDb();

		await syncInvitationTargetTeam(fake.db, {
			organizationId: "organization-1",
			invitationId: "invitation-1",
			email: "ada@example.com",
			targetTeamId,
		});

		expect(fake.events).toEqual([
			"identity-lock",
			"draft-lock",
			"invitation-lock",
			"invitation-update",
			"draft-update",
		]);
		expect(fake.updatedTables).toEqual([invitation, employeeInvitationDraft]);
		expect(fake.updateValues).toEqual([
			{ targetTeamId },
			{ teamId: targetTeamId },
		]);
	});

	it("updates the invitation safely when no stable draft exists", async () => {
		const fake = createTeamSyncDb({ draftExists: false });

		await syncInvitationTargetTeam(fake.db, {
			organizationId: "organization-1",
			invitationId: "invitation-1",
			email: "ada@example.com",
			targetTeamId: null,
		});

		expect(fake.updatedTables).toEqual([invitation]);
	});

	it("rejects a selected team outside the organization before writes", async () => {
		const fake = createTeamSyncDb({ teamExists: false });

		await expect(
			syncInvitationTargetTeam(fake.db, {
				organizationId: "organization-1",
				invitationId: "invitation-1",
				email: "ada@example.com",
				targetTeamId: "other-team",
			}),
		).rejects.toThrow("Invitation target team conflict");
		expect(fake.updatedTables).toEqual([]);
	});

	it("does not overwrite an invitation accepted while waiting for its lock", async () => {
		const fake = createTeamSyncDb({
			afterInvitationLock: (row) => {
				row.status = "accepted";
			},
		});

		await expect(
			syncInvitationTargetTeam(fake.db, {
				organizationId: "organization-1",
				invitationId: "invitation-1",
				email: "ada@example.com",
				targetTeamId: null,
			}),
		).rejects.toThrow("Invitation target team conflict");
		expect(fake.updatedTables).toEqual([]);
	});

	it("organization-scopes the selected team and both guarded updates", async () => {
		const fake = createTeamSyncDb();

		await syncInvitationTargetTeam(fake.db, {
			organizationId: "organization-1",
			invitationId: "invitation-1",
			email: "ada@example.com",
			targetTeamId: "team-1",
		});

		const invitationUpdate = new PgDialect().sqlToQuery(
			fake.updatePredicates[0] as never,
		);
		const draftUpdate = new PgDialect().sqlToQuery(
			fake.updatePredicates[1] as never,
		);
		expect(invitationUpdate.params).toEqual([
			"invitation-1",
			"organization-1",
			"pending",
		]);
		expect(draftUpdate.params).toEqual([
			"draft-1",
			"organization-1",
			"ada@example.com",
			"invitation-1",
		]);
	});
});
