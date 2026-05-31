import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { DatabaseService } from "./database.service";
import { InviteCodeService, InviteCodeServiceLive } from "./invite-code.service";

vi.mock("@/lib/enterprise-identity/enforcement", () => ({
	assertEnterpriseIdentityInviteCodeRedemptionAllowed: vi.fn(async () => undefined),
}));

describe("InviteCodeService.useCode", () => {
	it("provisions an active employee on a valid no-approval invite target team", async () => {
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
});
