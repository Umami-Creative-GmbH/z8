import { Context, Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	set: vi.fn(),
	authorize: vi.fn(),
	create: vi.fn(),
}));
vi.mock("next/headers", () => ({
	cookies: async () => ({ get: mocks.get, set: mocks.set }),
}));
vi.mock("@/lib/setup/bootstrap.server", () => ({
	setupBootstrap: { authorize: mocks.authorize },
}));
vi.mock("@/lib/effect/services/setup.service", () => ({
	SetupService: Context.Service("TestSetup"),
}));
vi.mock("@/lib/effect/runtime", async () => {
	const { SetupService } = await import("@/lib/effect/services/setup.service");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		Layer.succeed(SetupService, {
			createPlatformAdmin: mocks.create,
		}),
	);
});
vi.mock("@/lib/effect/result", async () => {
	const { runtime } = await import("@/lib/effect/runtime");
	return {
		runServerActionSafe: async (effect: Effect.Effect<unknown>) => ({
			success: true,
			data: await runtime.runPromise(effect),
		}),
	};
});

import { createPlatformAdminAction } from "./actions";

describe("setup admin server action", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});
	it("blocks direct unauthenticated POSTs before invoking admin creation", async () => {
		mocks.authorize.mockResolvedValue(false);
		const result = await createPlatformAdminAction({
			name: "Admin",
			email: "a@example.com",
			password: "Password123456",
		});
		expect(result.success).toBe(false);
		expect(mocks.create).not.toHaveBeenCalled();
	});
	it("fails closed on Redis errors", async () => {
		mocks.get.mockReturnValue({ value: "cookie" });
		mocks.authorize.mockRejectedValue(new Error("Redis unavailable"));
		const result = await createPlatformAdminAction({
			name: "Admin",
			email: "a@example.com",
			password: "Password123456",
		});
		expect(result.success).toBe(false);
		expect(mocks.create).not.toHaveBeenCalled();
	});
	it("passes only the server-read cookie to the service and clears it on success", async () => {
		mocks.get.mockReturnValue({ value: "cookie" });
		mocks.authorize.mockResolvedValue(true);
		mocks.create.mockReturnValue(
			Effect.succeed({ userId: "admin", email: "a@example.com" }),
		);
		const data = {
			name: "Admin",
			email: "a@example.com",
			password: "Password123456",
			setupToken: "forged",
		};
		expect((await createPlatformAdminAction(data)).success).toBe(true);
		expect(mocks.create).toHaveBeenCalledWith(
			{ name: data.name, email: data.email, password: data.password },
			"cookie",
		);
		expect(mocks.set).toHaveBeenCalledWith(
			expect.any(String),
			"",
			expect.objectContaining({ maxAge: 0, httpOnly: true }),
		);
	});
});
