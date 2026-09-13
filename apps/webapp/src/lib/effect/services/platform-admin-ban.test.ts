import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	update: vi.fn(),
	revoke: vi.fn(),
	audit: vi.fn(),
	getSession: vi.fn(),
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
vi.mock("@/db", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({ limit: async () => [{ id: "user-1" }] }),
			}),
		}),
		update: () => ({
			set: (value: unknown) => ({ where: async () => mocks.update(value) }),
		}),
		insert: () => ({ values: mocks.audit }),
	},
}));

const { PlatformAdminService, PlatformAdminServiceLive, requirePlatformAdmin } =
	await import("./platform-admin.service");
const ban = () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* PlatformAdminService;
			yield* service.banUser("user-1", "Policy violation", null, "admin-1");
		}).pipe(Effect.provide(PlatformAdminServiceLive)),
	);

beforeEach(() => {
	vi.resetAllMocks();
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
	it("honors an expired platform admin ban", async () => {
		await expect(requirePlatformAdmin()).resolves.toMatchObject({
			userId: "admin-1",
		});
	});
});
