import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { member } from "@/db/auth-schema";
import { employee, inviteCode } from "@/db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { DatabaseService } from "./database.service";
import {
	InviteCodeService,
	InviteCodeServiceLive,
} from "./invite-code.service";

const enterpriseIdentityMock = vi.hoisted(() => ({
	assertRedemptionAllowed: vi.fn(async () => undefined),
}));

vi.mock("@/lib/enterprise-identity/enforcement", () => ({
	assertEnterpriseIdentityInviteCodeRedemptionAllowed:
		enterpriseIdentityMock.assertRedemptionAllowed,
}));

function resetEnterpriseIdentityMock() {
	enterpriseIdentityMock.assertRedemptionAllowed.mockReset();
	enterpriseIdentityMock.assertRedemptionAllowed.mockResolvedValue(undefined);
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

	it.each([
		"update",
		"delete",
		"getUsageStats",
	] as const)("returns not found and performs no mutation for cross-org %s", async (method) => {
		const { layer, mutations, update } = scopedCrudLayer();
		const operation = Effect.gen(function* () {
			const service = yield* InviteCodeService;
			if (method === "update") {
				return yield* service.update("invite-1", "org-1", { label: "Changed" });
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
	});
});

describe("InviteCodeService.useCode", () => {
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
				inviteCode: { findFirst: vi.fn(async () => inviteCodeRecord) },
				member: { findFirst: vi.fn(async () => null) },
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
				set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
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
				inviteCode: { findFirst: vi.fn(async () => inviteCodeRecord) },
				member: { findFirst: vi.fn(async () => null) },
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
				set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
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

describe("InviteCodeService.processPendingInviteCode", () => {
	it("provisions an active employee without a team when the invite target team is invalid", async () => {
		resetEnterpriseIdentityMock();
		const insertedEmployees: unknown[] = [];
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
				inviteCode: { findFirst: vi.fn(async () => inviteCodeRecord) },
				member: { findFirst: vi.fn(async () => null) },
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
			update: vi.fn(() => ({
				set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
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
		resetEnterpriseIdentityMock();
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
		const transaction = vi.fn(
			async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb),
		);
		const mockDb = {
			query: {
				user: {
					findFirst: vi.fn(async () => ({
						id: "user-1",
						pendingInviteCode: "JOIN-TEAM",
					})),
				},
				inviteCode: { findFirst: vi.fn(async () => inviteCodeRecord) },
				member: { findFirst: vi.fn(async () => null) },
				employee: { findFirst: vi.fn(async () => null) },
				team: { findFirst: vi.fn(async () => ({ id: "team-1" })) },
			},
			insert,
			update: vi.fn(() => ({
				set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
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
		expect(transaction).not.toHaveBeenCalled();
	});
});

type ReactivationFakeOptions = {
	existingMember?: { id: string; role: string; status: string } | null;
	existingEmployee?: Record<string, unknown> | null;
	defaultTeamId?: string | null;
	teamIsValid?: boolean;
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
			inviteCode: { findFirst: vi.fn(async () => inviteCodeRecord) },
			member: {
				findFirst: vi.fn(async () => options.existingMember ?? null),
			},
			user: {
				findFirst: vi.fn(async () => ({ email: "ada@example.com" })),
			},
			employee: {
				findFirst: vi.fn(async (query: { where: SQL }) => {
					if (!options.existingEmployee) return null;
					const compiled = new PgDialect().sqlToQuery(query.where);
					return compiled.params.includes(options.existingEmployee.organizationId)
						? options.existingEmployee
						: null;
				}),
			},
			team: {
				findFirst: vi.fn(async () =>
					options.teamIsValid === false ? null : { id: options.defaultTeamId },
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
				return { where: vi.fn(async () => undefined) };
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

async function redeemNoApprovalCode(layer: ReturnType<typeof reactivationLayer>["layer"]) {
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
	});

	it.each([
		["without an invite team", null, { isActive: true }],
		["with a valid invite team", "team-1", { isActive: true, teamId: "team-1" }],
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
			existingMember: { id: "member-existing", role: "owner,admin", status: "approved" },
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
			existingMember: { id: "member-existing", role: "member", status: "approved" },
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
