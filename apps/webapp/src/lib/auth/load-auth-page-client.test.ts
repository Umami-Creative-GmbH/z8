import { beforeEach, describe, expect, it, vi } from "vitest";

describe("loadAuthPageClient", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.doUnmock("./auth-page-client");
	});

	it("loads the client once and reuses it", async () => {
		const authPageClient = { signIn: {} };
		const factory = vi.fn(() => ({ authPageClient }));
		vi.doMock("./auth-page-client", factory);
		const { loadAuthPageClient } = await import("./load-auth-page-client");

		await expect(loadAuthPageClient()).resolves.toBe(authPageClient);
		await expect(loadAuthPageClient()).resolves.toBe(authPageClient);
		expect(factory).toHaveBeenCalledOnce();
	});

	it("retries after a failed load", async () => {
		vi.doMock("./auth-page-client", () => {
			throw new Error("chunk failed");
		});
		const { loadAuthPageClient } = await import("./load-auth-page-client");
		// Vitest wraps factory errors, so only the rejection itself is asserted.
		await expect(loadAuthPageClient()).rejects.toThrow();

		const authPageClient = { signIn: {} };
		vi.resetModules();
		vi.doMock("./auth-page-client", () => ({ authPageClient }));
		await expect(loadAuthPageClient()).resolves.toBe(authPageClient);
	});
});
