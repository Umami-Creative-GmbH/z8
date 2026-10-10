import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type AndroidAuthSessionPlugins,
	androidAuthSession,
	iosAuthSession,
} from "./native-auth-session";

const SIGN_IN = "https://time.acme.example/api/auth/app-login?app=mobile";
const CALLBACK = "z8mobile://auth/callback?code=ONE-TIME-CODE";

describe("iOS auth session (ASWebAuthenticationSession)", () => {
	it("returns the callback the session intercepted", async () => {
		const start = vi.fn(async () => ({ url: CALLBACK }));

		await expect(iosAuthSession({ start })(SIGN_IN, "z8mobile")).resolves.toEqual({
			status: "completed",
			callbackUrl: CALLBACK,
		});
		expect(start).toHaveBeenCalledWith({ url: SIGN_IN, callbackScheme: "z8mobile" });
	});

	it("reports the user closing the sheet as cancelled", async () => {
		const start = vi.fn(async () => {
			throw Object.assign(new Error("Sign-in was cancelled"), { code: "cancelled" });
		});

		await expect(iosAuthSession({ start })(SIGN_IN, "z8mobile")).resolves.toEqual({
			status: "cancelled",
		});
	});

	it("reports any other failure as failed", async () => {
		const start = vi.fn(async () => {
			throw Object.assign(new Error("Sign-in could not start"), { code: "failed" });
		});

		await expect(iosAuthSession({ start })(SIGN_IN, "z8mobile")).resolves.toEqual({
			status: "failed",
		});
	});
});

describe("Android auth session (Custom Tabs)", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	function fakePlugins() {
		const listeners: Record<string, (event: { url: string }) => void> = {};
		const removed: string[] = [];
		const plugins = {
			browser: {
				open: vi.fn(async () => {}),
				close: vi.fn(async () => {}),
				addListener: vi.fn(async (event: string, callback: () => void) => {
					listeners[event] = callback;
					return { remove: async () => void removed.push(event) };
				}),
			},
			app: {
				addListener: vi.fn(async (event: string, callback: (event: { url: string }) => void) => {
					listeners[event] = callback;
					return { remove: async () => void removed.push(event) };
				}),
			},
		} satisfies AndroidAuthSessionPlugins;
		return {
			plugins,
			removed,
			emit: (event: string, payload = { url: "" }) => listeners[event]?.(payload),
		};
	}

	it("opens a Custom Tab and returns the app link it delivered", async () => {
		const fake = fakePlugins();
		const session = androidAuthSession(fake.plugins)(SIGN_IN, "z8mobile");
		await vi.waitFor(() => expect(fake.plugins.browser.open).toHaveBeenCalledWith({ url: SIGN_IN }));

		fake.emit("appUrlOpen", { url: CALLBACK });

		await expect(session).resolves.toEqual({ status: "completed", callbackUrl: CALLBACK });
		expect(fake.removed.sort()).toEqual(["appUrlOpen", "browserFinished"]);
	});

	it("ignores links for other schemes while waiting", async () => {
		const fake = fakePlugins();
		const session = androidAuthSession(fake.plugins)(SIGN_IN, "z8mobile");
		await vi.waitFor(() => expect(fake.plugins.browser.open).toHaveBeenCalled());

		fake.emit("appUrlOpen", { url: "https://ui.example.test/time-tracking" });
		fake.emit("appUrlOpen", { url: CALLBACK });

		await expect(session).resolves.toEqual({ status: "completed", callbackUrl: CALLBACK });
	});

	it("accepts a callback that arrives just after the tab closed", async () => {
		vi.useFakeTimers();
		const fake = fakePlugins();
		const session = androidAuthSession(fake.plugins)(SIGN_IN, "z8mobile");
		await vi.waitFor(() => expect(fake.plugins.browser.open).toHaveBeenCalled());

		fake.emit("browserFinished");
		await vi.advanceTimersByTimeAsync(200);
		fake.emit("appUrlOpen", { url: CALLBACK });

		await expect(session).resolves.toEqual({ status: "completed", callbackUrl: CALLBACK });
	});

	it("reports a closed tab without a callback as cancelled", async () => {
		vi.useFakeTimers();
		const fake = fakePlugins();
		const session = androidAuthSession(fake.plugins)(SIGN_IN, "z8mobile");
		await vi.waitFor(() => expect(fake.plugins.browser.open).toHaveBeenCalled());

		fake.emit("browserFinished");
		await vi.advanceTimersByTimeAsync(5_000);

		await expect(session).resolves.toEqual({ status: "cancelled" });
		expect(fake.removed.sort()).toEqual(["appUrlOpen", "browserFinished"]);
	});

	it("reports a tab that could not open as failed", async () => {
		const fake = fakePlugins();
		fake.plugins.browser.open.mockRejectedValue(new Error("No browser"));

		await expect(androidAuthSession(fake.plugins)(SIGN_IN, "z8mobile")).resolves.toEqual({
			status: "failed",
		});
		expect(fake.removed.sort()).toEqual(["appUrlOpen", "browserFinished"]);
	});
});
