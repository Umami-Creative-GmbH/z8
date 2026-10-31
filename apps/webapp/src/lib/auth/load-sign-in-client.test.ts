import { beforeEach, describe, expect, it, vi } from "vitest";

describe("loadSignInClient", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.doUnmock("./sign-in-client");
	});

	it("loads the client once and reuses it", async () => {
		const signInClient = { signIn: {} };
		const factory = vi.fn(() => ({ signInClient }));
		vi.doMock("./sign-in-client", factory);
		const { loadSignInClient } = await import("./load-sign-in-client");

		await expect(loadSignInClient()).resolves.toBe(signInClient);
		await expect(loadSignInClient()).resolves.toBe(signInClient);
		expect(factory).toHaveBeenCalledOnce();
	});

	it("retries after a failed load", async () => {
		vi.doMock("./sign-in-client", () => {
			throw new Error("chunk failed");
		});
		const { loadSignInClient } = await import("./load-sign-in-client");
		// Vitest wraps factory errors, so only the rejection itself is asserted.
		await expect(loadSignInClient()).rejects.toThrow();

		const signInClient = { signIn: {} };
		vi.resetModules();
		vi.doMock("./sign-in-client", () => ({ signInClient }));
		await expect(loadSignInClient()).resolves.toBe(signInClient);
	});
});
