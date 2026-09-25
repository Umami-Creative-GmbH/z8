import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	update: vi.fn(),
	revoke: vi.fn(),
	audit: vi.fn(),
	getSession: vi.fn(),
	guard: vi.fn(),
	transaction: vi.fn(),
	events: [] as string[],
}));

vi.mock("@/lib/time-tracking/work-transaction", () => ({
	acquireExclusiveUserConfigurationAccessGuards: mocks.guard,
}));

vi.mock("@/lib/queue", () => ({
	addOrganizationDeletionNotificationJob: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
	auth: {
		$context: Promise.resolve({
			internalAdapter: { deleteUserSessions: mocks.revoke },
		}),
		api: { getSession: mocks.getSession },
	},
}));
vi.mock("@/db", () => {
	const client = {
		select: () => ({
			from: () => ({
				where: () => ({ limit: async () => [{ id: "user-1" }] }),
			}),
		}),
		update: () => ({
			set: (value: unknown) => ({ where: async () => mocks.update(value) }),
		}),
		insert: () => ({ values: mocks.audit }),
	};
	const transactionClient = { ...client, name: "ban transaction" };
	return {
		db: {
			...client,
			transaction: async (callback: (tx: typeof transactionClient) => Promise<unknown>) => {
				mocks.transaction(transactionClient);
				mocks.events.push("begin");
				const result = await callback(transactionClient);
				mocks.events.push("commit");
				return result;
			},
		},
	};
});

const { PlatformAdminService, PlatformAdminServiceLive, requirePlatformAdmin } =
	await import("./platform-admin.service");
const ban = () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* PlatformAdminService;
			yield* service.banUser("user-1", "Policy violation", null, "admin-1");
		}).pipe(Effect.provide(PlatformAdminServiceLive)),
	);
const unban = () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* PlatformAdminService;
			yield* service.unbanUser("user-1", "admin-1");
		}).pipe(Effect.provide(PlatformAdminServiceLive)),
	);

beforeEach(() => {
	vi.resetAllMocks();
	mocks.events.length = 0;
	mocks.guard.mockImplementation(async () => {
		mocks.events.push("guard");
	});
	mocks.update.mockImplementation(async () => {
		mocks.events.push("update");
	});
	mocks.revoke.mockImplementation(async () => {
		mocks.events.push("revoke");
	});
	mocks.getSession.mockResolvedValue({
		user: {
			id: "admin-1",
			email: "admin@example.com",
			role: "admin",
			banned: true,
			banExpires: new Date("2020-01-01T00:00:00Z"),
		},
	});
});

describe("platform account ban lifecycle", () => {
	it("commits the ban before revoking all sessions and recording success", async () => {
		await ban();
		expect(mocks.update).toHaveBeenCalledWith({
			banned: true,
			banReason: "Policy violation",
			banExpires: null,
		});
		expect(mocks.revoke).toHaveBeenCalledWith("user-1");
		expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.revoke.mock.invocationCallOrder[0],
		);
		expect(mocks.revoke.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.audit.mock.invocationCallOrder[0],
		);
	});
	it("does not report success when session revocation fails", async () => {
		mocks.revoke.mockRejectedValue(new Error("storage unavailable"));
		await expect(ban()).rejects.toThrow("Failed to ban user");
		expect(mocks.audit).not.toHaveBeenCalled();
	});
	it("changes the ban under the user's exclusive access protection, then revokes after commit", async () => {
		await ban();

		// Manual interpretation re-reads ban status under the user's shared guard.
		const [transactionClient] = mocks.transaction.mock.calls[0] ?? [];
		expect(mocks.guard).toHaveBeenCalledWith(transactionClient, ["user-1"]);
		expect(mocks.events).toEqual(["begin", "guard", "update", "commit", "revoke"]);
	});
	it("lifts a ban under the same protection", async () => {
		await unban();

		const [transactionClient] = mocks.transaction.mock.calls[0] ?? [];
		expect(mocks.guard).toHaveBeenCalledWith(transactionClient, ["user-1"]);
		expect(mocks.events).toEqual(["begin", "guard", "update", "commit"]);
		expect(mocks.update).toHaveBeenCalledWith({
			banned: false,
			banReason: null,
			banExpires: null,
		});
	});
	it("honors an expired platform admin ban", async () => {
		await expect(requirePlatformAdmin()).resolves.toMatchObject({
			userId: "admin-1",
		});
	});
});
