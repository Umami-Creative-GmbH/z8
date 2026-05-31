import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { ValidationError } from "../errors";
import { DatabaseService } from "./database.service";
import { InviteCodeService, InviteCodeServiceLive } from "./invite-code.service";

const enterpriseIdentityMock = vi.hoisted(() => ({
	assertRedemptionAllowed: vi.fn(async () => undefined),
}));

vi.mock("@/lib/enterprise-identity/enforcement", () => ({
	assertEnterpriseIdentityInviteCodeRedemptionAllowed: enterpriseIdentityMock.assertRedemptionAllowed,
}));

function resetEnterpriseIdentityMock() {
	enterpriseIdentityMock.assertRedemptionAllowed.mockReset();
	enterpriseIdentityMock.assertRedemptionAllowed.mockResolvedValue(undefined);
}

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
		const memberRecord = { id: "member-1" };
		const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
			callback(mockDb),
		);
		const mockDb = {
			query: {
				inviteCode: { findFirst: vi.fn(async () => inviteCodeRecord) },
				member: { findFirst: vi.fn(async () => null) },
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
		const memberRecord = { id: "member-1" };
		const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
			callback(mockDb),
		);
		const mockDb = {
			query: {
				inviteCode: { findFirst: vi.fn(async () => inviteCodeRecord) },
				member: { findFirst: vi.fn(async () => null) },
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
		const memberRecord = { id: "member-1" };
		const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
			callback(mockDb),
		);
		const mockDb = {
			query: {
				user: { findFirst: vi.fn(async () => ({ id: "user-1", pendingInviteCode: "JOIN-TEAM" })) },
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
		enterpriseIdentityMock.assertRedemptionAllowed.mockRejectedValue(new Error("Domain blocked"));
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
			values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: "member-1" }]) })),
		}));
		const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
			callback(mockDb),
		);
		const mockDb = {
			query: {
				user: { findFirst: vi.fn(async () => ({ id: "user-1", pendingInviteCode: "JOIN-TEAM" })) },
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
		expect(enterpriseIdentityMock.assertRedemptionAllowed).toHaveBeenCalledWith({
			organizationId: "org-1",
			userId: "user-1",
		});
		expect(insert).not.toHaveBeenCalled();
		expect(transaction).not.toHaveBeenCalled();
	});
});
