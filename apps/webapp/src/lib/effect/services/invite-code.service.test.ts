import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { member, user } from "@/db/auth-schema";
import {
	auditLog,
	employee,
	inviteCode,
	inviteCodeUsage,
	memberApproval,
} from "@/db/schema";
import { DatabaseError, NotFoundError, ValidationError } from "../errors";
import { DatabaseService } from "./database.service";
import {
	InviteCodeService,
	InviteCodeServiceLive,
} from "./invite-code.service";

const enterpriseIdentityMock = vi.hoisted(() => ({
	assertRedemptionAllowed: vi.fn(async () => undefined),
}));

const billingMock = vi.hoisted(() => ({
	sync: vi.fn(async () => undefined),
}));

vi.mock("@/lib/enterprise-identity/enforcement", () => ({
	assertEnterpriseIdentityInviteCodeRedemptionAllowed:
		enterpriseIdentityMock.assertRedemptionAllowed,
}));

vi.mock("@/lib/billing/seat-sync-trigger", () => ({
	syncBillingSeatsAfterMemberChange: billingMock.sync,
}));

function resetEnterpriseIdentityMock() {
	enterpriseIdentityMock.assertRedemptionAllowed.mockReset();
	enterpriseIdentityMock.assertRedemptionAllowed.mockResolvedValue(undefined);
}

function collectColumnNames(value: unknown): string[] {
	if (!value || typeof value !== "object") return [];
	const node = value as {
		config?: { name?: unknown };
		queryChunks?: unknown[];
	};
	const ownName =
		typeof node.config?.name === "string" ? [node.config.name] : [];
	const chunkNames = Array.isArray(node.queryChunks)
		? node.queryChunks.flatMap(collectColumnNames)
		: [];
	return [...ownName, ...chunkNames];
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function scopedCrudLayer() {
	const mutations: unknown[] = [];
	const crossOrgRecord = {
		id: "invite-1",
		organizationId: "org-other",
		defaultTeamId: null,
	};
	const findFirst = vi.fn(async (query: { where: unknown }) => {
		const compiled = new PgDialect().sqlToQuery(
			sql`select * from ${inviteCode} where ${query.where as SQL}`,
		);
		return compiled.params.length === 1 || compiled.params.includes("org-other")
			? crossOrgRecord
			: null;
	});
	const update = vi.fn(() => ({
		set: vi.fn((values) => ({
			where: vi.fn(() => ({
				returning: vi.fn(async () => {
					mutations.push(values);
					return [crossOrgRecord];
				}),
			})),
		})),
	}));
	const mockDb = {
		query: {
			inviteCode: { findFirst },
			inviteCodeUsage: { findMany: vi.fn(async () => []) },
			memberApproval: { findMany: vi.fn(async () => []) },
		},
		transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
			callback(mockDb),
		),
		update,
	};
	const layer = InviteCodeServiceLive.pipe(
		Layer.provide(
			Layer.succeed(
				DatabaseService,
				DatabaseService.of({
					db: mockDb as never,
					query: (_name, query) => Effect.promise(query) as never,
				}),
			),
		),
	);

	return { layer, mutations, update };
}

describe("InviteCodeService organization scoping", () => {
	it("does not read a known invite code from another organization", async () => {
		const { layer } = scopedCrudLayer();
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* InviteCodeService;
				return yield* service.getById("invite-1", "org-1");
			}).pipe(Effect.provide(layer)),
		);

		expect(result).toBeNull();
	});

	it.each(["update", "delete", "getUsageStats"] as const)(
		"returns not found and performs no mutation for cross-org %s",
		async (method) => {
			const { layer, mutations, update } = scopedCrudLayer();
			const operation = Effect.gen(function* () {
				const service = yield* InviteCodeService;
				if (method === "update") {
					return yield* service.update("invite-1", "org-1", {
						label: "Changed",
					});
				}
				if (method === "delete") {
					return yield* service.delete("invite-1", "org-1", "user-1");
				}
				return yield* service.getUsageStats("invite-1", "org-1");
			});

			const result = await Effect.runPromise(
				Effect.either(operation).pipe(Effect.provide(layer)),
			);

			expect(result).toMatchObject({
				_tag: "Left",
				left: expect.any(NotFoundError),
			});
			expect(mutations).toEqual([]);
			expect(update).not.toHaveBeenCalled();
		},
	);
});

describe("InviteCodeService.useCode", () => {
	it("rejects an ambiguous cross-organization code without selecting a tenant", async () => {
		resetEnterpriseIdentityMock();
		billingMock.sync.mockClear();
		const fake = duplicatePendingCodeLayer();

		const result = await Effect.runPromise(
			Effect.either(
				Effect.gen(function* () {
					const service = yield* InviteCodeService;
					return yield* service.useCode({
						code: "JOIN-TEAM",
						userId: "user-1",
					});
				}).pipe(Effect.provide(fake.layer)),
			),
		);

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.objectContaining({
				_tag: "NotFoundError",
				message: "Invalid invite code",
			}),
		});
		expect(fake.mockDb.query.inviteCode.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 2 }),
		);
		expect(fake.mockDb.transaction).not.toHaveBeenCalled();
		expect(fake.insertedMembers).toEqual([]);
		expect(billingMock.sync).not.toHaveBeenCalled();
	});

	it("returns durable membership rejection before enterprise denial", async () => {
		resetEnterpriseIdentityMock();
		billingMock.sync.mockClear();
		enterpriseIdentityMock.assertRedemptionAllowed.mockRejectedValue(
			new Error("Domain blocked"),
		);
		const fake = durableRejectedReuseLayer({ pending: false });

		const result = await Effect.runPromise(
			Effect.either(
				Effect.gen(function* () {
					const service = yield* InviteCodeService;
					return yield* service.useCode({
						code: "JOIN-TEAM",
						userId: "user-1",
					});
				}).pipe(Effect.provide(fake.layer)),
			),
		);

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.objectContaining({
				_tag: "ValidationError",
				message: "Membership for this invite code was rejected",
				field: "code",
			}),
		});
		expect(fake.mockDb.transaction).toHaveBeenCalledOnce();
		expect(
			enterpriseIdentityMock.assertRedemptionAllowed,
		).not.toHaveBeenCalled();
		expect(fake.writes).toEqual([]);
		expect(billingMock.sync).not.toHaveBeenCalled();
		expect(collectColumnNames(fake.auditQueries[0])).toEqual(
			expect.arrayContaining([
				"organization_id",
				"entity_type",
				"entity_id",
				"action",
			]),
		);
		expect(
			new PgDialect().sqlToQuery(fake.auditQueries[0] as SQL).params,
		).toEqual(["org-1", "membership", "invite-1", "reject"]);
		expect(fake.mockDb.query.auditLog.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ columns: { metadata: true } }),
		);
	});

	it("provisions an active employee on a valid no-approval invite target team", async () => {
		resetEnterpriseIdentityMock();
		const insertedEmployees: unknown[] = [];
		const inviteCodeRecord = {
			id: "invite-1",
			code: "JOIN-TEAM",
			organizationId: "org-1",
			defaultTeamId: "team-1",
			requiresApproval: false,
			status: "active",
			expiresAt: null,
			maxUses: null,
			currentUses: 0,
			organization: { id: "org-1", name: "Acme", slug: "acme" },
		};
		const memberRecord = { id: "member-1", role: "member", status: "approved" };
		const transaction = vi.fn(
			async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb),
		);
		const mockDb = {
			query: {
				inviteCode: {
					findFirst: vi.fn(async () => inviteCodeRecord),
					findMany: vi.fn(async () => [inviteCodeRecord]),
				},
				member: { findFirst: vi.fn(async () => null) },
				auditLog: { findMany: vi.fn(async () => []) },
				user: { findFirst: vi.fn(async () => ({ email: "ada@example.com" })) },
				employee: { findFirst: vi.fn(async () => null) },
				team: { findFirst: vi.fn(async () => ({ id: "team-1" })) },
			},
			insert: vi.fn((table) => ({
				values: vi.fn((values) => {
					if (table === employee) {
						insertedEmployees.push(values);
					}

					return {
						returning: vi.fn(async () => [memberRecord]),
					};
				}),
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => [{ id: "invite-1", currentUses: 1 }]),
					})),
				})),
			})),
			execute: vi.fn(async () => undefined),
			transaction,
		};
		const layer = InviteCodeServiceLive.pipe(
			Layer.provide(
				Layer.succeed(
					DatabaseService,
					DatabaseService.of({
						db: mockDb as never,
						query: (_name, query) => Effect.promise(query) as never,
					}),
				),
			),
		);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* InviteCodeService;

				return yield* service.useCode({ code: "JOIN-TEAM", userId: "user-1" });
			}).pipe(Effect.provide(layer)),
		);

		expect(result.status).toBe("approved");
		expect(transaction).toHaveBeenCalledOnce();
		expect(insertedEmployees).toEqual([
			{
				userId: "user-1",
				organizationId: "org-1",
				teamId: "team-1",
				role: "employee",
				isActive: true,
			},
		]);
	});

	it("keeps approval-required invite redemptions pending without provisioning an employee", async () => {
		resetEnterpriseIdentityMock();
		const insertedEmployees: unknown[] = [];
		const insertedMembers: unknown[] = [];
		const inviteCodeRecord = {
			id: "invite-1",
			code: "JOIN-TEAM",
			organizationId: "org-1",
			defaultTeamId: "team-1",
			requiresApproval: true,
			status: "active",
			expiresAt: null,
			maxUses: null,
			currentUses: 0,
			organization: { id: "org-1", name: "Acme", slug: "acme" },
		};
		const memberRecord = { id: "member-1", role: "member", status: "pending" };
		const transaction = vi.fn(
			async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb),
		);
		const mockDb = {
			query: {
				inviteCode: {
					findFirst: vi.fn(async () => inviteCodeRecord),
					findMany: vi.fn(async () => [inviteCodeRecord]),
				},
				member: { findFirst: vi.fn(async () => null) },
				auditLog: { findMany: vi.fn(async () => []) },
				user: { findFirst: vi.fn(async () => ({ email: "ada@example.com" })) },
				employee: { findFirst: vi.fn(async () => null) },
				team: { findFirst: vi.fn(async () => ({ id: "team-1" })) },
			},
			insert: vi.fn((table) => ({
				values: vi.fn((values) => {
					if (table === member) {
						insertedMembers.push(values);
					}
					if (table === employee) {
						insertedEmployees.push(values);
					}

					return {
						returning: vi.fn(async () => [memberRecord]),
					};
				}),
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(async () => [{ id: "invite-1", currentUses: 1 }]),
					})),
				})),
			})),
			execute: vi.fn(async () => undefined),
			transaction,
		};
		const layer = InviteCodeServiceLive.pipe(
			Layer.provide(
				Layer.succeed(
					DatabaseService,
					DatabaseService.of({
						db: mockDb as never,
						query: (_name, query) => Effect.promise(query) as never,
					}),
				),
			),
		);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* InviteCodeService;

				return yield* service.useCode({ code: "JOIN-TEAM", userId: "user-1" });
			}).pipe(Effect.provide(layer)),
		);

		expect(result.status).toBe("pending");
		expect(insertedMembers).toEqual([
			expect.objectContaining({
				status: "pending",
				inviteCodeId: "invite-1",
			}),
		]);
		expect(insertedEmployees).toEqual([]);
	});
});

describe("InviteCodeService transactional usability", () => {
	beforeEach(() => {
		resetEnterpriseIdentityMock();
		billingMock.sync.mockClear();
	});

	it("rejects a code paused after pre-validation using the locked current row", async () => {
		const fake = transactionalUsabilityLayer({
			lockedStatus: "paused",
			maxUses: null,
		});

		const result = await Effect.runPromise(
			Effect.either(
				Effect.gen(function* () {
					const service = yield* InviteCodeService;
					return yield* service.useCode({
						code: "JOIN-TEAM",
						userId: "user-1",
					});
				}).pipe(Effect.provide(fake.layer)),
			),
		);

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.objectContaining({
				_tag: "ValidationError",
				message: "Code is paused",
				field: "code",
			}),
		});
		expect(fake.db.transaction).toHaveBeenCalledOnce();
		expect(fake.tx.query.inviteCode.findFirst).toHaveBeenCalledOnce();
		expect(fake.members).toEqual([]);
		expect(fake.usages).toEqual([]);
		expect(fake.employees).toEqual([]);
		expect(fake.lockedInvite.currentUses).toBe(0);
		expect(billingMock.sync).not.toHaveBeenCalled();
		const lock = inviteLockQuery(fake.transactionStatements);
		expect(lock?.sql.toLowerCase()).toContain("for update");
		expect(lock?.params).toEqual(["invite-1", "org-1"]);
		expect(
			new PgDialect()
				.sqlToQuery(fake.transactionStatements[0] as SQL)
				.sql.toLowerCase(),
		).toContain("for update");
	});

	it("serializes max-use redemption so a stale second precheck cannot exceed the limit", async () => {
		const fake = transactionalUsabilityLayer({ maxUses: 1 });
		const redeem = (userId: string) =>
			Effect.runPromise(
				Effect.either(
					Effect.gen(function* () {
						const service = yield* InviteCodeService;
						return yield* service.useCode({ code: "JOIN-TEAM", userId });
					}).pipe(Effect.provide(fake.layer)),
				),
			);

		const first = await redeem("user-1");
		const second = await redeem("user-2");

		expect(first).toMatchObject({ _tag: "Right" });
		expect(second).toMatchObject({
			_tag: "Left",
			left: expect.objectContaining({
				_tag: "ValidationError",
				message: "Code has reached maximum uses",
				field: "code",
			}),
		});
		expect(fake.db.transaction).toHaveBeenCalledTimes(2);
		expect(fake.tx.query.inviteCode.findFirst).toHaveBeenCalledTimes(2);
		expect(fake.members).toHaveLength(1);
		expect(fake.usages).toHaveLength(1);
		expect(fake.employees).toHaveLength(1);
		expect(fake.lockedInvite.currentUses).toBe(1);
		expect(billingMock.sync).toHaveBeenCalledOnce();
		expect(fake.incrementPredicates).toHaveLength(1);
		expect(collectColumnNames(fake.incrementPredicates[0])).toEqual(
			expect.arrayContaining([
				"id",
				"organization_id",
				"status",
				"max_uses",
				"current_uses",
			]),
		);
	});
});

describe("InviteCodeService billing seat sync", () => {
	it("syncs billing seats after approved invite code member creation paths", () => {
		const source = readFileSync(
			join(process.cwd(), "src/lib/effect/services/invite-code.service.ts"),
			"utf8",
		);

		expect(source).toContain("syncBillingSeatsAfterMemberChange");
		expect(source).toContain("memberId: redemption.member.id");
		expect(source).toContain('change: "added"');
	});
});

function rejectedPendingCodeLayer() {
	let pendingInviteCode: string | null = "JOIN-TEAM";
	const writes: Array<{ table: unknown; values: unknown }> = [];
	const inviteCodeRecord = {
		id: "invite-1",
		code: "JOIN-TEAM",
		organizationId: "org-1",
		defaultTeamId: "team-1",
		requiresApproval: false,
		status: "active",
		expiresAt: null,
		maxUses: null,
		currentUses: 0,
		organization: { id: "org-1", name: "Acme", slug: "acme" },
	};
	const mockDb = {
		query: {
			user: {
				findFirst: vi.fn(async () => ({
					id: "user-1",
					email: "ada@example.com",
					pendingInviteCode,
				})),
			},
			inviteCode: {
				findFirst: vi.fn(async () => ({
					...inviteCodeRecord,
					status: "paused",
				})),
				findMany: vi.fn(async () => [inviteCodeRecord]),
			},
			member: {
				findFirst: vi.fn(async () => ({
					id: "member-rejected",
					role: "member",
					status: "rejected",
				})),
			},
			employee: { findFirst: vi.fn(async () => null) },
			team: { findFirst: vi.fn(async () => ({ id: "team-1" })) },
		},
		execute: vi.fn(async () => undefined),
		insert: vi.fn((table) => ({
			values: vi.fn((values) => {
				writes.push({ table, values });
				return { returning: vi.fn(async () => []) };
			}),
		})),
		update: vi.fn((table) => ({
			set: vi.fn((values: { pendingInviteCode?: string | null }) => ({
				where: vi.fn(async () => {
					writes.push({ table, values });
					if (table === user && "pendingInviteCode" in values) {
						pendingInviteCode = values.pendingInviteCode ?? null;
					}
				}),
			})),
		})),
		transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
			callback(mockDb),
		),
	};
	const layer = InviteCodeServiceLive.pipe(
		Layer.provide(
			Layer.succeed(
				DatabaseService,
				DatabaseService.of({
					db: mockDb as never,
					query: (_name, query) => Effect.promise(query) as never,
				}),
			),
		),
	);

	return {
		getPendingInviteCode: () => pendingInviteCode,
		layer,
		mockDb,
		writes,
	};
}

function clearFailurePendingCodeLayer() {
	const users = [
		{ id: "user-1", pendingInviteCode: "JOIN-TEAM" as string | null },
	];
	const members: Array<Record<string, unknown>> = [];
	const usages: Array<Record<string, unknown>> = [];
	const employees: Array<Record<string, unknown>> = [];
	const inviteState = { currentUses: 0 };
	const rootUserUpdates: unknown[] = [];
	const transactionUserUpdates: unknown[] = [];
	const transactionEvents: string[] = [];
	const inviteCodeRecord = {
		id: "invite-1",
		code: "JOIN-TEAM",
		organizationId: "org-1",
		defaultTeamId: null,
		requiresApproval: false,
		status: "active",
		expiresAt: null,
		maxUses: null,
		currentUses: inviteState.currentUses,
		organization: { id: "org-1", name: "Acme", slug: "acme" },
	};
	const makeClient = (client: "root" | "transaction") => ({
		query: {
			user: {
				findFirst: vi.fn(async () => ({
					...users[0],
					email: "ada@example.com",
				})),
			},
			inviteCode: {
				findFirst: vi.fn(async () => inviteCodeRecord),
				findMany: vi.fn(async () => [inviteCodeRecord]),
			},
			member: { findFirst: vi.fn(async () => null) },
			auditLog: { findMany: vi.fn(async () => []) },
			employee: { findFirst: vi.fn(async () => null) },
			team: { findFirst: vi.fn(async () => null) },
		},
		execute: vi.fn(async () => undefined),
		insert: vi.fn((table) => ({
			values: vi.fn((values: Record<string, unknown>) => {
				if (table === member) {
					const created = { ...values, id: "member-new" };
					members.push(created);
					return { returning: vi.fn(async () => [created]) };
				}
				if (table === inviteCodeUsage) usages.push(values);
				if (table === employee) employees.push(values);
				return { returning: vi.fn(async () => []) };
			}),
		})),
		update: vi.fn((table) => ({
			set: vi.fn((values: { pendingInviteCode?: string | null }) => ({
				where: vi.fn(() => {
					if (table === user) {
						(client === "root" ? rootUserUpdates : transactionUserUpdates).push(
							values,
						);
						return {
							returning: vi.fn(async () => {
								throw new Error("pending code clear failed");
							}),
						};
					}
					if (table === inviteCode) inviteState.currentUses++;
					return Promise.resolve(values);
				}),
			})),
		})),
	});
	const tx = makeClient("transaction");
	const db = makeClient("root") as ReturnType<typeof makeClient> & {
		transaction: (
			callback: (client: typeof tx) => Promise<unknown>,
		) => Promise<unknown>;
	};
	db.transaction = vi.fn(async (callback) => {
		transactionEvents.push("start");
		const snapshots = {
			users: users.map((record) => ({ ...record })),
			members: members.map((record) => ({ ...record })),
			usages: usages.map((record) => ({ ...record })),
			employees: employees.map((record) => ({ ...record })),
			currentUses: inviteState.currentUses,
		};
		try {
			const result = await callback(tx);
			transactionEvents.push("commit");
			return result;
		} catch (error) {
			users.splice(0, users.length, ...snapshots.users);
			members.splice(0, members.length, ...snapshots.members);
			usages.splice(0, usages.length, ...snapshots.usages);
			employees.splice(0, employees.length, ...snapshots.employees);
			inviteState.currentUses = snapshots.currentUses;
			transactionEvents.push("rollback");
			throw error;
		}
	});
	const layer = InviteCodeServiceLive.pipe(
		Layer.provide(
			Layer.succeed(
				DatabaseService,
				DatabaseService.of({
					db: db as never,
					query: (name, query) =>
						Effect.tryPromise({
							try: query,
							catch: (cause) =>
								new DatabaseError({
									message: `Database query failed: ${name}`,
									operation: name,
									cause,
								}),
						}) as never,
				}),
			),
		),
	);

	return {
		db,
		employees,
		inviteState,
		layer,
		members,
		rootUserUpdates,
		transactionEvents,
		transactionUserUpdates,
		usages,
		users,
	};
}

type StalePendingCodeOptions = {
	inviteRecord?: Record<string, unknown> | null;
};

function stalePendingCodeLayer(options: StalePendingCodeOptions = {}) {
	let pendingInviteCode: string | null = "JOIN-TEAM";
	let userReadCount = 0;
	const clearPredicates: SQL[] = [];
	const rootClearPredicates: SQL[] = [];
	const transactionClearPredicates: SQL[] = [];
	const members: Array<Record<string, unknown>> = [];
	const usages: Array<Record<string, unknown>> = [];
	const employees: Array<Record<string, unknown>> = [];
	const inviteState = { currentUses: 0 };
	const defaultInviteRecord = {
		id: "invite-1",
		code: "JOIN-TEAM",
		organizationId: "org-1",
		defaultTeamId: null,
		requiresApproval: false,
		status: "active",
		expiresAt: null,
		maxUses: null,
		currentUses: 0,
		organization: { id: "org-1", name: "Acme", slug: "acme" },
	};
	const inviteRecord =
		options.inviteRecord === undefined
			? defaultInviteRecord
			: options.inviteRecord;
	const makeClient = (client: "root" | "transaction") => ({
		query: {
			user: {
				findFirst: vi.fn(async () => {
					const result = {
						id: "user-1",
						email: "ada@example.com",
						pendingInviteCode,
					};
					if (userReadCount++ === 0) pendingInviteCode = "NEW-CODE";
					return result;
				}),
			},
			inviteCode: {
				findFirst: vi.fn(async () => inviteRecord),
				findMany: vi.fn(async () => (inviteRecord ? [inviteRecord] : [])),
			},
			member: { findFirst: vi.fn(async () => null) },
			auditLog: { findMany: vi.fn(async () => []) },
			employee: { findFirst: vi.fn(async () => null) },
			team: { findFirst: vi.fn(async () => null) },
		},
		execute: vi.fn(async () => undefined),
		insert: vi.fn((table) => ({
			values: vi.fn((values: Record<string, unknown>) => {
				if (table === member) {
					const created = { ...values, id: "member-new" };
					members.push(created);
					return { returning: vi.fn(async () => [created]) };
				}
				if (table === inviteCodeUsage) usages.push(values);
				if (table === employee) employees.push(values);
				return { returning: vi.fn(async () => []) };
			}),
		})),
		update: vi.fn((table) => ({
			set: vi.fn(() => ({
				where: vi.fn((where: SQL) => {
					if (table === inviteCode) {
						inviteState.currentUses++;
						return Promise.resolve(undefined);
					}
					if (table !== user) return Promise.resolve(undefined);

					clearPredicates.push(where);
					(client === "root"
						? rootClearPredicates
						: transactionClearPredicates
					).push(where);
					const params = new PgDialect().sqlToQuery(where).params;
					const matched =
						params.includes("user-1") &&
						(!params.includes("JOIN-TEAM") ||
							pendingInviteCode === "JOIN-TEAM");
					if (matched) pendingInviteCode = null;
					return {
						returning: vi.fn(async () => (matched ? [{ id: "user-1" }] : [])),
					};
				}),
			})),
		})),
	});
	const tx = makeClient("transaction");
	const db = makeClient("root") as ReturnType<typeof makeClient> & {
		transaction: (
			callback: (client: typeof tx) => Promise<unknown>,
		) => Promise<unknown>;
	};
	db.transaction = vi.fn(async (callback) => {
		const snapshots = {
			pendingInviteCode,
			members: members.map((record) => ({ ...record })),
			usages: usages.map((record) => ({ ...record })),
			employees: employees.map((record) => ({ ...record })),
			currentUses: inviteState.currentUses,
		};
		try {
			return await callback(tx);
		} catch (error) {
			pendingInviteCode = snapshots.pendingInviteCode;
			members.splice(0, members.length, ...snapshots.members);
			usages.splice(0, usages.length, ...snapshots.usages);
			employees.splice(0, employees.length, ...snapshots.employees);
			inviteState.currentUses = snapshots.currentUses;
			throw error;
		}
	});
	const layer = InviteCodeServiceLive.pipe(
		Layer.provide(
			Layer.succeed(
				DatabaseService,
				DatabaseService.of({
					db: db as never,
					query: (_name, query) => Effect.promise(query) as never,
				}),
			),
		),
	);

	return {
		clearPredicates,
		db,
		employees,
		getPendingInviteCode: () => pendingInviteCode,
		inviteState,
		layer,
		members,
		rootClearPredicates,
		transactionClearPredicates,
		usages,
	};
}

function expectExactPendingCodeCas(
	fake: ReturnType<typeof stalePendingCodeLayer>,
) {
	expect(fake.clearPredicates).toHaveLength(1);
	const predicate = fake.clearPredicates[0] as SQL;
	expect(new PgDialect().sqlToQuery(predicate).params).toEqual([
		"user-1",
		"JOIN-TEAM",
	]);
	expect(collectColumnNames(predicate)).toEqual(["id", "pending_invite_code"]);
}

function duplicatePendingCodeLayer() {
	const insertedMembers: Array<Record<string, unknown>> = [];
	const inviteRecords = [
		{
			id: "invite-other",
			code: "JOIN-TEAM",
			organizationId: "org-other",
			defaultTeamId: null,
			requiresApproval: false,
			status: "active",
			expiresAt: null,
			maxUses: null,
			currentUses: 0,
			organization: { id: "org-other", name: "Other", slug: "other" },
		},
		{
			id: "invite-1",
			code: "JOIN-TEAM",
			organizationId: "org-1",
			defaultTeamId: null,
			requiresApproval: false,
			status: "active",
			expiresAt: null,
			maxUses: null,
			currentUses: 0,
			organization: { id: "org-1", name: "Acme", slug: "acme" },
		},
	];
	const mockDb = {
		query: {
			user: {
				findFirst: vi.fn(async () => ({
					id: "user-1",
					email: "ada@example.com",
					pendingInviteCode: "JOIN-TEAM",
				})),
			},
			inviteCode: {
				findFirst: vi.fn(async () => inviteRecords[0]),
				findMany: vi.fn(async () => inviteRecords),
			},
			member: { findFirst: vi.fn(async () => null) },
			employee: { findFirst: vi.fn(async () => null) },
			team: { findFirst: vi.fn(async () => null) },
		},
		execute: vi.fn(async () => undefined),
		insert: vi.fn((table) => ({
			values: vi.fn((values: Record<string, unknown>) => {
				if (table === member) {
					const created = { ...values, id: "member-new" };
					insertedMembers.push(created);
					return { returning: vi.fn(async () => [created]) };
				}
				return { returning: vi.fn(async () => []) };
			}),
		})),
		update: vi.fn((table) => ({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn(async () =>
						table === user
							? [{ id: "user-1" }]
							: [{ id: "invite-other", currentUses: 1 }],
					),
				})),
			})),
		})),
		transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
			callback(mockDb),
		),
	};
	const layer = InviteCodeServiceLive.pipe(
		Layer.provide(
			Layer.succeed(
				DatabaseService,
				DatabaseService.of({
					db: mockDb as never,
					query: (_name, query) => Effect.promise(query) as never,
				}),
			),
		),
	);

	return { insertedMembers, layer, mockDb };
}

function durableRejectedReuseLayer(input: {
	pending: boolean;
	malformedAuditFirst?: boolean;
}) {
	let pendingInviteCode: string | null = input.pending ? "JOIN-TEAM" : null;
	const writes: Array<{ table: unknown; values: unknown }> = [];
	const auditQueries: SQL[] = [];
	const inviteCodeRecord = {
		id: "invite-1",
		code: "JOIN-TEAM",
		organizationId: "org-1",
		defaultTeamId: null,
		requiresApproval: false,
		status: "active",
		expiresAt: null,
		maxUses: null,
		currentUses: 0,
		organization: { id: "org-1", name: "Acme", slug: "acme" },
	};
	const mockDb = {
		query: {
			user: {
				findFirst: vi.fn(async () => ({
					id: "user-1",
					email: "ada@example.com",
					pendingInviteCode,
				})),
			},
			inviteCode: {
				findFirst: vi.fn(async () => inviteCodeRecord),
				findMany: vi.fn(async () => [inviteCodeRecord]),
			},
			member: { findFirst: vi.fn(async () => null) },
			auditLog: {
				findFirst: vi.fn(async (query: { where: SQL }) => {
					auditQueries.push(query.where);
					if (input.malformedAuditFirst) {
						throw new Error("invalid input syntax for type json");
					}
					return {
						id: "audit-1",
						organizationId: "org-1",
						entityType: "membership",
						entityId: "invite-1",
						action: "reject",
						metadata: JSON.stringify({
							memberId: "member-old",
							userId: "user-1",
							inviteCodeId: "invite-1",
						}),
					};
				}),
				findMany: vi.fn(async (query: { where: SQL }) => {
					auditQueries.push(query.where);
					return [
						...(input.malformedAuditFirst
							? [{ id: "audit-malformed", metadata: "not-json" }]
							: []),
						{
							id: "audit-1",
							organizationId: "org-1",
							entityType: "membership",
							entityId: "invite-1",
							action: "reject",
							metadata: JSON.stringify({
								memberId: "member-old",
								userId: "user-1",
								inviteCodeId: "invite-1",
							}),
						},
					];
				}),
			},
			employee: { findFirst: vi.fn(async () => null) },
			team: { findFirst: vi.fn(async () => null) },
		},
		execute: vi.fn(async () => undefined),
		insert: vi.fn((table) => ({
			values: vi.fn((values) => {
				writes.push({ table, values });
				return { returning: vi.fn(async () => [{ id: "created" }]) };
			}),
		})),
		update: vi.fn((table) => ({
			set: vi.fn((values: { pendingInviteCode?: string | null }) => ({
				where: vi.fn(() => ({
					returning: vi.fn(async () => {
						writes.push({ table, values });
						if (table === user) pendingInviteCode = null;
						return [{ id: "updated", currentUses: 1 }];
					}),
				})),
			})),
		})),
		transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
			callback(mockDb),
		),
	};
	const layer = InviteCodeServiceLive.pipe(
		Layer.provide(
			Layer.succeed(
				DatabaseService,
				DatabaseService.of({
					db: mockDb as never,
					query: (_name, query) => Effect.promise(query) as never,
				}),
			),
		),
	);

	return {
		auditQueries,
		getPendingInviteCode: () => pendingInviteCode,
		layer,
		mockDb,
		writes,
	};
}

function transactionalUsabilityLayer(input: {
	lockedStatus?: string;
	maxUses: number | null;
}) {
	const lockedInvite = {
		id: "invite-1",
		code: "JOIN-TEAM",
		organizationId: "org-1",
		defaultTeamId: null,
		requiresApproval: false,
		status: input.lockedStatus ?? "active",
		expiresAt: null,
		maxUses: input.maxUses,
		currentUses: 0,
		organization: { id: "org-1", name: "Acme", slug: "acme" },
	};
	const staleInvite = { ...lockedInvite, status: "active", currentUses: 0 };
	const members: Array<Record<string, unknown>> = [];
	const usages: Array<Record<string, unknown>> = [];
	const employees: Array<Record<string, unknown>> = [];
	const transactionStatements: SQL[] = [];
	const incrementPredicates: SQL[] = [];
	const tx = {
		query: {
			user: {
				findFirst: vi.fn(async () => ({ email: "ada@example.com" })),
			},
			inviteCode: { findFirst: vi.fn(async () => ({ ...lockedInvite })) },
			member: { findFirst: vi.fn(async () => null) },
			auditLog: { findMany: vi.fn(async () => []) },
			employee: { findFirst: vi.fn(async () => null) },
			team: { findFirst: vi.fn(async () => null) },
		},
		execute: vi.fn(async (statement: SQL) => {
			transactionStatements.push(statement);
		}),
		insert: vi.fn((table) => ({
			values: vi.fn((values: Record<string, unknown>) => {
				if (table === member) {
					const created = { ...values, id: `member-${members.length + 1}` };
					members.push(created);
					return { returning: vi.fn(async () => [created]) };
				}
				if (table === inviteCodeUsage) usages.push(values);
				if (table === employee) employees.push(values);
				return { returning: vi.fn(async () => []) };
			}),
		})),
		update: vi.fn((table) => ({
			set: vi.fn(() => ({
				where: vi.fn((where: SQL) => {
					if (table === inviteCode) {
						incrementPredicates.push(where);
						lockedInvite.currentUses++;
					}
					return {
						returning: vi.fn(async () => [
							{ id: "invite-1", currentUses: lockedInvite.currentUses },
						]),
					};
				}),
			})),
		})),
	};
	const db = {
		query: {
			inviteCode: {
				findFirst: vi.fn(async () => ({ ...staleInvite })),
				findMany: vi.fn(async () => [{ ...staleInvite }]),
			},
		},
		transaction: vi.fn(
			async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
		),
	};
	const layer = InviteCodeServiceLive.pipe(
		Layer.provide(
			Layer.succeed(
				DatabaseService,
				DatabaseService.of({
					db: db as never,
					query: (name, query) =>
						Effect.tryPromise({
							try: query,
							catch: (cause) =>
								new DatabaseError({
									message: `Database query failed: ${name}`,
									operation: name,
									cause,
								}),
						}) as never,
				}),
			),
		),
	);

	return {
		db,
		employees,
		incrementPredicates,
		layer,
		lockedInvite,
		members,
		transactionStatements,
		tx,
		usages,
	};
}

function inviteLockQuery(statements: SQL[]) {
	return statements
		.map((statement) => new PgDialect().sqlToQuery(statement))
		.find((query) => query.sql.toLowerCase().includes("for update"));
}

describe("InviteCodeService.processPendingInviteCode", () => {
	beforeEach(() => {
		resetEnterpriseIdentityMock();
		billingMock.sync.mockClear();
	});

	it("retains pending code and returns durable rejection before enterprise denial", async () => {
		enterpriseIdentityMock.assertRedemptionAllowed.mockRejectedValue(
			new Error("Domain blocked"),
		);
		const fake = durableRejectedReuseLayer({ pending: true });

		const result = await Effect.runPromise(
			Effect.either(
				Effect.gen(function* () {
					const service = yield* InviteCodeService;
					return yield* service.processPendingInviteCode("user-1");
				}).pipe(Effect.provide(fake.layer)),
			),
		);

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.objectContaining({
				_tag: "ValidationError",
				message: "Membership for this invite code was rejected",
				field: "code",
			}),
		});
		expect(fake.getPendingInviteCode()).toBe("JOIN-TEAM");
		expect(fake.mockDb.transaction).toHaveBeenCalledOnce();
		expect(
			enterpriseIdentityMock.assertRedemptionAllowed,
		).not.toHaveBeenCalled();
		expect(fake.writes).toEqual([]);
		expect(billingMock.sync).not.toHaveBeenCalled();
	});

	it("does not choose arbitrarily when the pending code exists in multiple organizations", async () => {
		const fake = duplicatePendingCodeLayer();

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* InviteCodeService;
				return yield* service.processPendingInviteCode("user-1");
			}).pipe(Effect.provide(fake.layer)),
		);

		expect(result).toBeNull();
		expect(fake.mockDb.query.inviteCode.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 2 }),
		);
		expect(fake.mockDb.transaction).not.toHaveBeenCalled();
		expect(fake.insertedMembers).toEqual([]);
		expect(billingMock.sync).not.toHaveBeenCalled();
	});

	it("retains the pending code when its existing membership was rejected", async () => {
		const fake = rejectedPendingCodeLayer();

		const result = await Effect.runPromise(
			Effect.either(
				Effect.gen(function* () {
					const service = yield* InviteCodeService;
					return yield* service.processPendingInviteCode("user-1");
				}).pipe(Effect.provide(fake.layer)),
			),
		);

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.objectContaining({
				_tag: "ValidationError",
				message: "Membership for this invite code was rejected",
				field: "code",
			}),
		});
		expect(fake.getPendingInviteCode()).toBe("JOIN-TEAM");
		expect(fake.writes).toEqual([]);
		expect(fake.mockDb.insert).not.toHaveBeenCalled();
		expect(fake.mockDb.query.employee.findFirst).not.toHaveBeenCalled();
		expect(fake.mockDb.query.team.findFirst).not.toHaveBeenCalled();
		expect(billingMock.sync).not.toHaveBeenCalled();
	});

	it("rolls back lifecycle writes when clearing the pending code fails", async () => {
		const fake = clearFailurePendingCodeLayer();

		const result = await Effect.runPromise(
			Effect.either(
				Effect.gen(function* () {
					const service = yield* InviteCodeService;
					return yield* service.processPendingInviteCode("user-1");
				}).pipe(Effect.provide(fake.layer)),
			),
		);

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.any(DatabaseError),
		});
		expect(fake.users).toEqual([
			expect.objectContaining({ pendingInviteCode: "JOIN-TEAM" }),
		]);
		expect(fake.members).toEqual([]);
		expect(fake.usages).toEqual([]);
		expect(fake.employees).toEqual([]);
		expect(fake.inviteState.currentUses).toBe(0);
		expect(billingMock.sync).not.toHaveBeenCalled();
		expect(fake.db.transaction).toHaveBeenCalledOnce();
		expect(fake.rootUserUpdates).toEqual([]);
		expect(fake.transactionUserUpdates).toEqual([{ pendingInviteCode: null }]);
		expect(fake.transactionEvents).toEqual(["start", "rollback"]);
	});

	it("abandons a valid stale pending code when its transactional clear CAS loses", async () => {
		const fake = stalePendingCodeLayer();

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* InviteCodeService;
				return yield* service.processPendingInviteCode("user-1");
			}).pipe(Effect.provide(fake.layer)),
		);

		expect(result).toBeNull();
		expect(fake.getPendingInviteCode()).toBe("NEW-CODE");
		expect(fake.members).toEqual([]);
		expect(fake.usages).toEqual([]);
		expect(fake.employees).toEqual([]);
		expect(fake.inviteState.currentUses).toBe(0);
		expect(billingMock.sync).not.toHaveBeenCalled();
		expect(fake.db.transaction).toHaveBeenCalledOnce();
		expect(fake.rootClearPredicates).toEqual([]);
		expect(fake.transactionClearPredicates).toHaveLength(1);
		expectExactPendingCodeCas(fake);
	});

	it.each([
		["missing", null],
		[
			"expired",
			{
				id: "invite-1",
				code: "JOIN-TEAM",
				organizationId: "org-1",
				defaultTeamId: null,
				requiresApproval: false,
				status: "expired",
				expiresAt: null,
				maxUses: null,
				currentUses: 0,
			},
		],
	] as const)(
		"preserves a replacement code when stale %s-code clearing loses",
		async (_case, inviteRecord) => {
			const fake = stalePendingCodeLayer({ inviteRecord });

			await expect(
				Effect.runPromise(
					Effect.gen(function* () {
						const service = yield* InviteCodeService;
						return yield* service.processPendingInviteCode("user-1");
					}).pipe(Effect.provide(fake.layer)),
				),
			).resolves.toBeNull();
			expect(fake.getPendingInviteCode()).toBe("NEW-CODE");
			expect(fake.members).toEqual([]);
			expect(fake.usages).toEqual([]);
			expect(fake.employees).toEqual([]);
			expect(fake.inviteState.currentUses).toBe(0);
			expect(fake.rootClearPredicates).toHaveLength(inviteRecord ? 0 : 1);
			expect(fake.transactionClearPredicates).toHaveLength(
				inviteRecord ? 1 : 0,
			);
			expectExactPendingCodeCas(fake);
		},
	);

	it("suppresses a stale enterprise rejection when its transactional clear CAS loses", async () => {
		enterpriseIdentityMock.assertRedemptionAllowed.mockRejectedValue(
			new Error("Domain blocked"),
		);
		const fake = stalePendingCodeLayer();

		const result = await Effect.runPromise(
			Effect.either(
				Effect.gen(function* () {
					const service = yield* InviteCodeService;
					return yield* service.processPendingInviteCode("user-1");
				}).pipe(Effect.provide(fake.layer)),
			),
		);

		expect(result).toMatchObject({ _tag: "Right", right: null });
		expect(fake.getPendingInviteCode()).toBe("NEW-CODE");
		expect(fake.db.transaction).toHaveBeenCalledOnce();
		expect(fake.members).toEqual([]);
		expect(fake.usages).toEqual([]);
		expect(fake.employees).toEqual([]);
		expect(billingMock.sync).not.toHaveBeenCalled();
		expect(fake.rootClearPredicates).toEqual([]);
		expect(fake.transactionClearPredicates).toHaveLength(1);
		expectExactPendingCodeCas(fake);
	});

	it("provisions an active employee without a team when the invite target team is invalid", async () => {
		const insertedEmployees: unknown[] = [];
		const userClears: unknown[] = [];
		const inviteCodeRecord = {
			id: "invite-1",
			code: "JOIN-TEAM",
			organizationId: "org-1",
			defaultTeamId: "team-other-org",
			requiresApproval: false,
			status: "active",
			expiresAt: null,
			maxUses: null,
			currentUses: 0,
			organization: { id: "org-1", name: "Acme", slug: "acme" },
		};
		const memberRecord = { id: "member-1", role: "member", status: "approved" };
		const transaction = vi.fn(
			async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb),
		);
		const mockDb = {
			query: {
				user: {
					findFirst: vi.fn(async () => ({
						id: "user-1",
						email: "ada@example.com",
						pendingInviteCode: "JOIN-TEAM",
					})),
				},
				inviteCode: {
					findFirst: vi.fn(async () => inviteCodeRecord),
					findMany: vi.fn(async () => [inviteCodeRecord]),
				},
				member: { findFirst: vi.fn(async () => null) },
				auditLog: { findMany: vi.fn(async () => []) },
				employee: { findFirst: vi.fn(async () => null) },
				team: { findFirst: vi.fn(async () => null) },
			},
			insert: vi.fn((table) => ({
				values: vi.fn((values) => {
					if (table === employee) {
						insertedEmployees.push(values);
					}

					return {
						returning: vi.fn(async () => [memberRecord]),
					};
				}),
			})),
			update: vi.fn((table) => ({
				set: vi.fn((values) => ({
					where: vi.fn(() => {
						if (table === user) userClears.push(values);
						return {
							returning: vi.fn(async () => [{ id: "user-1" }]),
						};
					}),
				})),
			})),
			execute: vi.fn(async () => undefined),
			transaction,
		};
		const layer = InviteCodeServiceLive.pipe(
			Layer.provide(
				Layer.succeed(
					DatabaseService,
					DatabaseService.of({
						db: mockDb as never,
						query: (_name, query) => Effect.promise(query) as never,
					}),
				),
			),
		);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* InviteCodeService;

				return yield* service.processPendingInviteCode("user-1");
			}).pipe(Effect.provide(layer)),
		);

		expect(result?.status).toBe("approved");
		expect(transaction).toHaveBeenCalledOnce();
		expect(userClears).toEqual([{ pendingInviteCode: null }]);
		expect(insertedEmployees).toEqual([
			{
				userId: "user-1",
				organizationId: "org-1",
				teamId: null,
				role: "employee",
				isActive: true,
			},
		]);
	});

	it("rejects enterprise identity blocked pending invite codes before member or employee inserts", async () => {
		enterpriseIdentityMock.assertRedemptionAllowed.mockRejectedValue(
			new Error("Domain blocked"),
		);
		const inviteCodeRecord = {
			id: "invite-1",
			code: "JOIN-TEAM",
			organizationId: "org-1",
			defaultTeamId: "team-1",
			requiresApproval: false,
			status: "active",
			expiresAt: null,
			maxUses: null,
			currentUses: 0,
			organization: { id: "org-1", name: "Acme", slug: "acme" },
		};
		const insert = vi.fn(() => ({
			values: vi.fn(() => ({
				returning: vi.fn(async () => [{ id: "member-1" }]),
			})),
		}));
		const userClears: unknown[] = [];
		const transaction = vi.fn(
			async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb),
		);
		const mockDb = {
			query: {
				user: {
					findFirst: vi.fn(async () => ({
						id: "user-1",
						email: "ada@example.com",
						pendingInviteCode: "JOIN-TEAM",
					})),
				},
				inviteCode: {
					findFirst: vi.fn(async () => inviteCodeRecord),
					findMany: vi.fn(async () => [inviteCodeRecord]),
				},
				member: { findFirst: vi.fn(async () => null) },
				auditLog: { findMany: vi.fn(async () => []) },
				employee: { findFirst: vi.fn(async () => null) },
				team: { findFirst: vi.fn(async () => ({ id: "team-1" })) },
			},
			insert,
			execute: vi.fn(async () => undefined),
			update: vi.fn((table) => ({
				set: vi.fn((values) => ({
					where: vi.fn(() => {
						if (table === user) userClears.push(values);
						return {
							returning: vi.fn(async () => [{ id: "user-1" }]),
						};
					}),
				})),
			})),
			transaction,
		};
		const layer = InviteCodeServiceLive.pipe(
			Layer.provide(
				Layer.succeed(
					DatabaseService,
					DatabaseService.of({
						db: mockDb as never,
						query: (_name, query) => Effect.promise(query) as never,
					}),
				),
			),
		);

		const result = await Effect.runPromise(
			Effect.either(
				Effect.gen(function* () {
					const service = yield* InviteCodeService;

					return yield* service.processPendingInviteCode("user-1");
				}).pipe(Effect.provide(layer)),
			),
		);

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.any(ValidationError),
		});
		expect(enterpriseIdentityMock.assertRedemptionAllowed).toHaveBeenCalledWith(
			{
				organizationId: "org-1",
				userId: "user-1",
			},
		);
		expect(insert).not.toHaveBeenCalled();
		expect(transaction).toHaveBeenCalledOnce();
		expect(userClears).toEqual([{ pendingInviteCode: null }]);
	});

	it.each([
		["missing", null],
		[
			"expired",
			{
				id: "invite-1",
				code: "JOIN-TEAM",
				organizationId: "org-1",
				defaultTeamId: null,
				requiresApproval: false,
				status: "expired",
				expiresAt: null,
				maxUses: null,
				currentUses: 0,
			},
		],
	] as const)(
		"clears a %s pending invite code exactly once",
		async (_case, inviteRecord) => {
			const userClears: unknown[] = [];
			const transaction = vi.fn(
				async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb),
			);
			const mockDb = {
				query: {
					user: {
						findFirst: vi.fn(async () => ({
							id: "user-1",
							email: "ada@example.com",
							pendingInviteCode: "JOIN-TEAM",
						})),
					},
					inviteCode: {
						findFirst: vi.fn(async () => inviteRecord),
						findMany: vi.fn(async () => (inviteRecord ? [inviteRecord] : [])),
					},
					member: { findFirst: vi.fn(async () => null) },
					auditLog: { findMany: vi.fn(async () => []) },
					employee: { findFirst: vi.fn(async () => null) },
					team: { findFirst: vi.fn(async () => null) },
				},
				execute: vi.fn(async () => undefined),
				insert: vi.fn(() => ({
					values: vi.fn(() => ({ returning: vi.fn(async () => []) })),
				})),
				update: vi.fn((table) => ({
					set: vi.fn((values) => ({
						where: vi.fn(() => {
							if (table === user) userClears.push(values);
							return {
								returning: vi.fn(async () => [{ id: "user-1" }]),
							};
						}),
					})),
				})),
				transaction,
			};
			const layer = InviteCodeServiceLive.pipe(
				Layer.provide(
					Layer.succeed(
						DatabaseService,
						DatabaseService.of({
							db: mockDb as never,
							query: (_name, query) => Effect.promise(query) as never,
						}),
					),
				),
			);

			await expect(
				Effect.runPromise(
					Effect.gen(function* () {
						const service = yield* InviteCodeService;
						return yield* service.processPendingInviteCode("user-1");
					}).pipe(Effect.provide(layer)),
				),
			).resolves.toBeNull();
			expect(userClears).toEqual([{ pendingInviteCode: null }]);
			expect(transaction).toHaveBeenCalledTimes(inviteRecord ? 1 : 0);
		},
	);
});

describe("InviteCodeService rejection audit parsing", () => {
	it("ignores malformed metadata before finding a durable direct redemption rejection", async () => {
		resetEnterpriseIdentityMock();
		const fake = durableRejectedReuseLayer({
			pending: false,
			malformedAuditFirst: true,
		});

		const result = await Effect.runPromise(
			Effect.either(
				Effect.gen(function* () {
					const service = yield* InviteCodeService;
					return yield* service.useCode({
						code: "JOIN-TEAM",
						userId: "user-1",
					});
				}).pipe(Effect.provide(fake.layer)),
			),
		);

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.objectContaining({
				_tag: "ValidationError",
				message: "Membership for this invite code was rejected",
			}),
		});
		expect(fake.mockDb.query.auditLog.findMany).toHaveBeenCalledOnce();
		expect(
			enterpriseIdentityMock.assertRedemptionAllowed,
		).not.toHaveBeenCalled();
	});

	it("ignores malformed metadata before finding a durable pending redemption rejection", async () => {
		resetEnterpriseIdentityMock();
		const fake = durableRejectedReuseLayer({
			pending: true,
			malformedAuditFirst: true,
		});

		const result = await Effect.runPromise(
			Effect.either(
				Effect.gen(function* () {
					const service = yield* InviteCodeService;
					return yield* service.processPendingInviteCode("user-1");
				}).pipe(Effect.provide(fake.layer)),
			),
		);

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.objectContaining({
				_tag: "ValidationError",
				message: "Membership for this invite code was rejected",
			}),
		});
		expect(fake.mockDb.query.auditLog.findMany).toHaveBeenCalledOnce();
		expect(
			enterpriseIdentityMock.assertRedemptionAllowed,
		).not.toHaveBeenCalled();
	});
});

type ReactivationFakeOptions = {
	existingMember?: { id: string; role: string; status: string } | null;
	existingEmployee?: Record<string, unknown> | null;
	defaultTeamId?: string | null;
	teamIsValid?: boolean;
	employeeFindFirst?: () => Promise<Record<string, unknown> | null>;
	teamFindFirst?: () => Promise<{ id: string } | null>;
};

function reactivationLayer(options: ReactivationFakeOptions = {}) {
	const employeeInserts: unknown[] = [];
	const employeeUpdates: unknown[] = [];
	const events: string[] = [];
	const inviteCodeRecord = {
		id: "invite-1",
		code: "JOIN-TEAM",
		organizationId: "org-1",
		defaultTeamId: options.defaultTeamId ?? null,
		requiresApproval: false,
		status: "active",
		expiresAt: null,
		maxUses: null,
		currentUses: 0,
		organization: { id: "org-1", name: "Acme", slug: "acme" },
	};
	const createdMember = {
		id: "member-new",
		userId: "user-1",
		organizationId: "org-1",
		role: "member",
		status: "approved",
	};
	const mockDb = {
		query: {
			inviteCode: {
				findFirst: vi.fn(async () => inviteCodeRecord),
				findMany: vi.fn(async () => [inviteCodeRecord]),
			},
			member: {
				findFirst: vi.fn(async () => options.existingMember ?? null),
			},
			auditLog: { findMany: vi.fn(async () => []) },
			user: {
				findFirst: vi.fn(async () => ({ email: "ada@example.com" })),
			},
			employee: {
				findFirst: vi.fn(async (query: { where: SQL }) => {
					const existingEmployee = options.employeeFindFirst
						? await options.employeeFindFirst()
						: options.existingEmployee;
					if (!existingEmployee) return null;
					const compiled = new PgDialect().sqlToQuery(query.where);
					return compiled.params.includes(existingEmployee.organizationId)
						? existingEmployee
						: null;
				}),
			},
			team: {
				findFirst: vi.fn(async () =>
					options.teamFindFirst
						? options.teamFindFirst()
						: options.teamIsValid === false
							? null
							: { id: options.defaultTeamId },
				),
			},
		},
		execute: vi.fn(async () => {
			events.push("identity-lock");
		}),
		insert: vi.fn((table) => ({
			values: vi.fn((values) => {
				if (table === employee) employeeInserts.push(values);
				return { returning: vi.fn(async () => [createdMember]) };
			}),
		})),
		update: vi.fn((table) => ({
			set: vi.fn((values) => {
				if (table === employee) employeeUpdates.push(values);
				return {
					where: vi.fn(() => ({
						returning: vi.fn(async () => [{ id: "invite-1", currentUses: 1 }]),
					})),
				};
			}),
		})),
		transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
			events.push("transaction-start");
			const result = await callback(mockDb);
			events.push("transaction-commit");
			return result;
		}),
	};
	const layer = InviteCodeServiceLive.pipe(
		Layer.provide(
			Layer.succeed(
				DatabaseService,
				DatabaseService.of({
					db: mockDb as never,
					query: (_name, query) => Effect.promise(query) as never,
				}),
			),
		),
	);

	return { employeeInserts, employeeUpdates, events, layer, mockDb };
}

async function redeemNoApprovalCode(
	layer: ReturnType<typeof reactivationLayer>["layer"],
) {
	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* InviteCodeService;
			return yield* service.useCode({ code: "JOIN-TEAM", userId: "user-1" });
		}).pipe(Effect.provide(layer)),
	);
}

describe("InviteCodeService preserved employee reactivation", () => {
	beforeEach(() => {
		resetEnterpriseIdentityMock();
		billingMock.sync.mockClear();
	});

	it("rejects reuse of an invite code for an existing rejected membership without side effects", async () => {
		const fake = reactivationLayer({
			existingMember: {
				id: "member-rejected",
				role: "member",
				status: "rejected",
			},
		});

		const result = await Effect.runPromise(
			Effect.either(
				Effect.gen(function* () {
					const service = yield* InviteCodeService;
					return yield* service.useCode({
						code: "JOIN-TEAM",
						userId: "user-1",
					});
				}).pipe(Effect.provide(fake.layer)),
			),
		);

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.objectContaining({
				_tag: "ValidationError",
				message: "Membership for this invite code was rejected",
				field: "code",
			}),
		});
		expect(fake.mockDb.insert).not.toHaveBeenCalled();
		expect(fake.mockDb.update).not.toHaveBeenCalled();
		expect(fake.mockDb.query.employee.findFirst).not.toHaveBeenCalled();
		expect(fake.mockDb.query.team.findFirst).not.toHaveBeenCalled();
		expect(fake.employeeInserts).toEqual([]);
		expect(fake.employeeUpdates).toEqual([]);
		expect(billingMock.sync).not.toHaveBeenCalled();
	});

	it("starts employee and default-team reads together", async () => {
		const employeeRead = deferred<Record<string, unknown> | null>();
		const teamRead = deferred<{ id: string } | null>();
		const employeeReadStarted = deferred<void>();
		const employeeFindFirst = vi.fn(() => {
			employeeReadStarted.resolve();
			return employeeRead.promise;
		});
		const teamFindFirst = vi.fn(() => teamRead.promise);
		const fake = reactivationLayer({
			defaultTeamId: "team-1",
			employeeFindFirst,
			teamFindFirst,
		});
		const redemption = redeemNoApprovalCode(fake.layer);
		let redemptionOutcome!: PromiseSettledResult<Awaited<typeof redemption>>;

		try {
			await employeeReadStarted.promise;
			expect(teamFindFirst).toHaveBeenCalledOnce();
		} finally {
			employeeRead.resolve(null);
			teamRead.resolve({ id: "team-1" });
			[redemptionOutcome] = await Promise.allSettled([redemption]);
		}

		if (redemptionOutcome.status === "rejected") {
			throw redemptionOutcome.reason;
		}
		expect(redemptionOutcome.value).toMatchObject({
			status: "approved",
		});
	});

	it.each([
		["without an invite team", null, { isActive: true }],
		[
			"with a valid invite team",
			"team-1",
			{ isActive: true, teamId: "team-1" },
		],
	] as const)(
		"reactivates the same employee after membership removal %s and preserves HR fields",
		async (_case, defaultTeamId, expectedUpdate) => {
			const fake = reactivationLayer({
				defaultTeamId,
				existingEmployee: {
					id: "employee-preserved",
					userId: "user-1",
					organizationId: "org-1",
					isActive: false,
					teamId: "team-history",
					role: "manager",
					employeeNumber: "E-42",
					position: "Historian",
					currentHourlyRate: "42.00",
				},
			});

			await expect(redeemNoApprovalCode(fake.layer)).resolves.toMatchObject({
				status: "approved",
				memberId: "member-new",
			});

			expect(fake.mockDb.transaction).toHaveBeenCalledOnce();
			expect(fake.events).toContain("identity-lock");
			expect(fake.employeeInserts).toEqual([]);
			expect(fake.employeeUpdates).toEqual([expectedUpdate]);
		},
	);

	it("reactivates an inactive employee behind an existing approved membership", async () => {
		const fake = reactivationLayer({
			existingMember: {
				id: "member-existing",
				role: "owner,admin",
				status: "approved",
			},
			existingEmployee: {
				id: "employee-preserved",
				userId: "user-1",
				organizationId: "org-1",
				isActive: false,
				teamId: "team-history",
				role: "manager",
			},
		});

		await expect(redeemNoApprovalCode(fake.layer)).resolves.toMatchObject({
			status: "approved",
			memberId: "member-existing",
		});
		expect(fake.employeeUpdates).toEqual([{ isActive: true }]);
		expect(fake.employeeInserts).toEqual([]);
	});

	it("keeps an active existing member idempotent", async () => {
		const fake = reactivationLayer({
			existingMember: {
				id: "member-existing",
				role: "member",
				status: "approved",
			},
			existingEmployee: {
				id: "employee-existing",
				userId: "user-1",
				organizationId: "org-1",
				isActive: true,
			},
		});

		await expect(redeemNoApprovalCode(fake.layer)).resolves.toMatchObject({
			status: "approved",
			memberId: "member-existing",
		});
		expect(fake.employeeUpdates).toEqual([]);
		expect(fake.employeeInserts).toEqual([]);
	});

	it("uses complete Better Auth role tokens when provisioning an existing bootstrap admin", async () => {
		const fake = reactivationLayer({
			existingMember: {
				id: "member-existing",
				role: "member,admin",
				status: "approved",
			},
			existingEmployee: null,
		});

		await expect(redeemNoApprovalCode(fake.layer)).resolves.toMatchObject({
			status: "approved",
			memberId: "member-existing",
		});
		expect(fake.employeeInserts).toEqual([
			expect.objectContaining({ role: "admin", organizationId: "org-1" }),
		]);
	});

	it("never reactivates a preserved employee from another organization", async () => {
		const fake = reactivationLayer({
			existingEmployee: {
				id: "employee-other-org",
				userId: "user-1",
				organizationId: "org-other",
				isActive: false,
			},
		});

		await expect(redeemNoApprovalCode(fake.layer)).resolves.toMatchObject({
			status: "approved",
		});
		expect(fake.employeeUpdates).toEqual([]);
		expect(fake.employeeInserts).toEqual([
			expect.objectContaining({
				userId: "user-1",
				organizationId: "org-1",
				isActive: true,
			}),
		]);
	});
});

function usageStatsLayer() {
	const approvalQueries: unknown[] = [];
	const auditQueries: unknown[] = [];
	const usages = [
		{
			id: "usage-pending",
			inviteCodeId: "invite-1",
			memberId: "member-pending",
			userId: "user-pending",
		},
		{
			id: "usage-approved",
			inviteCodeId: "invite-1",
			memberId: "member-approved",
			userId: "user-approved",
		},
	];
	const transactionClient = {
		query: {
			inviteCode: {
				findFirst: vi.fn(async () => ({
					id: "invite-1",
					organizationId: "org-1",
				})),
			},
			inviteCodeUsage: { findMany: vi.fn(async () => usages) },
			memberApproval: {
				findMany: vi.fn(async (query: { where: unknown }) => {
					approvalQueries.push(query.where);
					return [
						{
							id: "approval-1",
							memberId: "member-approved",
							organizationId: "org-1",
							status: "approved",
						},
					];
				}),
			},
			auditLog: {
				findMany: vi.fn(async (query: { where: unknown }) => {
					auditQueries.push(query.where);
					const rejection = {
						organizationId: "org-1",
						entityType: "membership",
						entityId: "invite-1",
						action: "reject",
						metadata: JSON.stringify({
							userId: "user-rejected",
							inviteCodeId: "invite-1",
						}),
					};
					return [rejection, { ...rejection }];
				}),
			},
		},
	};
	const rootRead = vi.fn(async () => {
		throw new Error("usage stats read escaped snapshot transaction");
	});
	const transaction = vi.fn(
		async (
			callback: (client: typeof transactionClient) => Promise<unknown>,
			_options: { isolationLevel: string },
		) => callback(transactionClient),
	);
	const mockDb = {
		query: {
			inviteCode: { findFirst: rootRead },
			inviteCodeUsage: { findMany: rootRead },
			memberApproval: { findMany: rootRead },
			auditLog: { findMany: rootRead },
		},
		transaction,
	};
	const layer = InviteCodeServiceLive.pipe(
		Layer.provide(
			Layer.succeed(
				DatabaseService,
				DatabaseService.of({
					db: mockDb as never,
					query: (_name, query) => Effect.promise(query) as never,
				}),
			),
		),
	);

	return { approvalQueries, auditQueries, layer, rootRead, transaction };
}

describe("InviteCodeService retained usage stats", () => {
	it("combines surviving usage with deduplicated organization-scoped rejection audits", async () => {
		const fake = usageStatsLayer();

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* InviteCodeService;
				return yield* service.getUsageStats("invite-1", "org-1");
			}).pipe(Effect.provide(fake.layer)),
		);

		expect(result).toEqual({
			total: 3,
			pending: 1,
			approved: 1,
			rejected: 1,
		});
		expect(fake.transaction).toHaveBeenCalledExactlyOnceWith(
			expect.any(Function),
			{ isolationLevel: "repeatable read" },
		);
		expect(fake.rootRead).not.toHaveBeenCalled();
		expect(collectColumnNames(fake.approvalQueries[0])).toEqual(
			expect.arrayContaining([
				memberApproval.memberId.name,
				memberApproval.organizationId.name,
			]),
		);
		expect(collectColumnNames(fake.auditQueries[0])).toEqual(
			expect.arrayContaining([
				auditLog.organizationId.name,
				auditLog.entityType.name,
				auditLog.entityId.name,
				auditLog.action.name,
			]),
		);
	});
});
