import { Effect, Exit } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	transaction: vi.fn(),
	execute: vi.fn(),
	limit: vi.fn(),
	insert: vi.fn(),
	values: vi.fn(),
	authorize: vi.fn(),
	authorizeWithinSetupTransaction: vi.fn(),
	invalidate: vi.fn(),
	setConfigured: vi.fn(),
}));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/db/auth-schema", () => ({
	user: { id: "id", role: "role", email: "email" },
	account: {},
}));
vi.mock("@/db/schema", () => ({ platformAdminAuditLog: {} }));
vi.mock("@/lib/setup/config-cache", () => ({
	setConfiguredStatus: mocks.setConfigured,
}));
vi.mock("@/lib/setup/bootstrap.server", () => ({
	setupBootstrap: {
		authorize: mocks.authorize,
		authorizeWithinSetupTransaction: mocks.authorizeWithinSetupTransaction,
		invalidate: mocks.invalidate,
	},
}));
vi.mock("better-auth/crypto", () => ({ hashPassword: async () => "hashed" }));

import { SetupService, SetupServiceLive } from "./setup.service";

const input = {
	name: "Operator",
	email: "admin@example.com",
	password: "StrongPassword123",
};
const run = (token?: string) =>
	Effect.runPromiseExit(
		Effect.gen(function* () {
			const service = yield* SetupService;
			return yield* service.createPlatformAdmin(input, token);
		}).pipe(Effect.provide(SetupServiceLive)),
	);

describe("platform admin setup authorization", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.authorize.mockResolvedValue(true);
		mocks.authorizeWithinSetupTransaction.mockResolvedValue(true);
		mocks.limit.mockResolvedValue([]);
		mocks.insert.mockReturnValue({ values: mocks.values });
		mocks.transaction.mockImplementation(async (callback) =>
			callback({
				execute: mocks.execute,
				select: () => ({
					from: () => ({ where: () => ({ limit: mocks.limit }) }),
				}),
				insert: mocks.insert,
			}),
		);
	});

	it("rejects direct service calls without a setup cookie", async () => {
		mocks.authorize.mockResolvedValue(false);
		expect(Exit.isFailure(await run())).toBe(true);
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.invalidate).not.toHaveBeenCalled();
	});

	it("revalidates authorization after acquiring the advisory lock", async () => {
		mocks.authorizeWithinSetupTransaction.mockResolvedValueOnce(false);
		expect(Exit.isFailure(await run("cookie"))).toBe(true);
		expect(mocks.execute).toHaveBeenCalled();
		expect(mocks.authorize).toHaveBeenCalledOnce();
		expect(mocks.authorizeWithinSetupTransaction).toHaveBeenCalledOnce();
		expect(mocks.insert).not.toHaveBeenCalled();
	});

	it("rejects an existing admin under the lock even with a valid cookie", async () => {
		mocks.limit.mockResolvedValueOnce([{ id: "existing" }]);
		expect(Exit.isFailure(await run("cookie"))).toBe(true);
		expect(mocks.insert).not.toHaveBeenCalled();
	});

	it("preserves setup authorization after a failed transaction so the operator can retry", async () => {
		mocks.values.mockRejectedValueOnce(new Error("database failure"));
		expect(Exit.isFailure(await run("cookie"))).toBe(true);
		expect(mocks.invalidate).not.toHaveBeenCalled();
		expect(mocks.setConfigured).not.toHaveBeenCalled();
		expect(Exit.isSuccess(await run("cookie"))).toBe(true);
		expect(mocks.invalidate).toHaveBeenCalledTimes(1);
	});

	it("invalidates bootstrap only after a successful commit", async () => {
		mocks.invalidate.mockImplementation(async () => {
			expect(mocks.values).toHaveBeenCalledTimes(3);
		});
		expect(Exit.isSuccess(await run("cookie"))).toBe(true);
		expect(mocks.invalidate).toHaveBeenCalledOnce();
	});

	it("fails closed if Redis is unavailable before creation", async () => {
		mocks.authorize.mockRejectedValue(
			new Error("Setup authorization unavailable"),
		);
		expect(Exit.isFailure(await run("cookie"))).toBe(true);
		expect(mocks.insert).not.toHaveBeenCalled();
	});

	it("does not misreport a committed admin as failed when Redis cleanup is unavailable", async () => {
		mocks.invalidate.mockRejectedValue(
			new Error("Setup authorization unavailable"),
		);
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(Exit.isSuccess(await run("cookie"))).toBe(true);
		expect(mocks.setConfigured).toHaveBeenCalledWith(true);
		warning.mockRestore();
	});
});
