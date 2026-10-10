import { afterEach, describe, expect, it, vi } from "vitest";
import { getStoreAppPlatform, isStoreAppShell } from "./shell";

const IPHONE_SAFARI =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID_WEBVIEW =
	"Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36";
const ANDROID_CHROME =
	"Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

function runInBrowserWithUserAgent(userAgent: string) {
	vi.stubGlobal("window", {});
	vi.stubGlobal("navigator", { userAgent });
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("store app shell detection", () => {
	it("is false during server rendering", () => {
		vi.stubGlobal("window", undefined);
		vi.stubGlobal("navigator", { userAgent: `${IPHONE_SAFARI} Z8StoreApp/ios` });

		expect(isStoreAppShell()).toBe(false);
		expect(getStoreAppPlatform()).toBeNull();
	});

	it("recognizes the iOS shell from its user-agent suffix", () => {
		runInBrowserWithUserAgent(`${IPHONE_SAFARI} Z8StoreApp/ios`);

		expect(isStoreAppShell()).toBe(true);
		expect(getStoreAppPlatform()).toBe("ios");
	});

	it("recognizes the Android shell from its user-agent suffix", () => {
		runInBrowserWithUserAgent(`${ANDROID_WEBVIEW} Z8StoreApp/android`);

		expect(isStoreAppShell()).toBe(true);
		expect(getStoreAppPlatform()).toBe("android");
	});

	it("is false in phone browsers outside the shell", () => {
		for (const userAgent of [IPHONE_SAFARI, ANDROID_CHROME, ANDROID_WEBVIEW]) {
			runInBrowserWithUserAgent(userAgent);

			expect(isStoreAppShell()).toBe(false);
			expect(getStoreAppPlatform()).toBeNull();
		}
	});

	it("ignores a marker for a platform the shell does not ship", () => {
		runInBrowserWithUserAgent(`${ANDROID_CHROME} Z8StoreApp/windows`);

		expect(isStoreAppShell()).toBe(false);
	});

	it("ignores a marker that is only part of another product token", () => {
		runInBrowserWithUserAgent(`${ANDROID_CHROME} NotZ8StoreApp/android`);

		expect(isStoreAppShell()).toBe(false);
	});
});
