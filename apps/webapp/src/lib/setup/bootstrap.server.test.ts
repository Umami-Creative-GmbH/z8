import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	ready: vi.fn(),
	ping: vi.fn(),
	eval: vi.fn(),
	limit: vi.fn(),
	status: "ready",
}));
vi.mock("@/lib/redis", () => ({
	ensureRedisReady: mocks.ready,
	redis: {
		ping: mocks.ping,
		eval: mocks.eval,
		get status() {
			return mocks.status;
		},
	},
}));
vi.mock("@/db", () => ({
	db: {
		select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }),
	},
}));
vi.mock("@/db/auth-schema", () => ({ user: { id: "id", role: "role" } }));

import { setupBootstrap } from "./bootstrap.server";

describe("strict setup Redis adapter", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.status = "ready";
		mocks.ready.mockResolvedValue(true);
		mocks.ping.mockResolvedValue("PONG");
		mocks.limit.mockResolvedValue([]);
		mocks.eval.mockResolvedValue(1);
	});
	it.each(["end", "connecting", "connect"])(
		"rejects a non-ready client even when ping/readiness claim success: %s",
		async (status) => {
			mocks.status = status;
			await expect(setupBootstrap.authorize("a".repeat(64))).rejects.toThrow(
				"Setup authorization unavailable",
			);
			expect(mocks.eval).not.toHaveBeenCalled();
		},
	);
	it("rejects Redis operation when the ping fails", async () => {
		mocks.ping.mockRejectedValue(new Error("connection failed"));
		await expect(setupBootstrap.authorize("a".repeat(64))).rejects.toThrow(
			"Setup authorization unavailable",
		);
		expect(mocks.eval).not.toHaveBeenCalled();
	});
	it("rejects authorization if the authoritative DB check fails", async () => {
		mocks.limit.mockRejectedValue(new Error("DB unavailable"));
		await expect(setupBootstrap.authorize("a".repeat(64))).rejects.toThrow();
		expect(mocks.eval).not.toHaveBeenCalled();
	});
	it("rejects leftover credentials when an admin exists in the DB", async () => {
		mocks.limit.mockResolvedValue([{ id: "admin" }]);
		expect(await setupBootstrap.authorize("a".repeat(64))).toBe(false);
		expect(mocks.eval).not.toHaveBeenCalled();
	});
	it("rechecks Redis without a global DB query inside a trusted setup transaction", async () => {
		mocks.limit.mockRejectedValue(new Error("No second pool slot available"));
		expect(
			await setupBootstrap.authorizeWithinSetupTransaction("a".repeat(64)),
		).toBe(true);
		expect(mocks.limit).not.toHaveBeenCalled();
		expect(mocks.eval).toHaveBeenCalledOnce();
	});
	it("fails closed on Redis readiness failures during the transaction recheck", async () => {
		mocks.ready.mockResolvedValue(false);
		await expect(
			setupBootstrap.authorizeWithinSetupTransaction("a".repeat(64)),
		).rejects.toThrow("Setup authorization unavailable");
		expect(mocks.limit).not.toHaveBeenCalled();
		expect(mocks.eval).not.toHaveBeenCalled();
	});
});
