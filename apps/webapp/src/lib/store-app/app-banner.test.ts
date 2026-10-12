import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { type AppBannerContext, decideAppBanner } from "./app-banner";

const APP_STORE_URL = "https://apps.apple.com/app/z8/id1234567890";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.z8.app";

const IPHONE_SAFARI =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
	"Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const ANDROID_TABLET_CHROME =
	"Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPAD_SAFARI =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const DESKTOP_CHROME =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const NOW = Temporal.Instant.from("2026-10-10T12:00:00Z");

function context(overrides: Partial<AppBannerContext> = {}): AppBannerContext {
	return {
		userAgent: IPHONE_SAFARI,
		isPhoneWidth: true,
		isStandalone: false,
		isStoreAppShell: false,
		dismissedAt: null,
		now: NOW,
		storeUrls: { ios: APP_STORE_URL, android: PLAY_STORE_URL },
		...overrides,
	};
}

describe("decideAppBanner", () => {
	it("links an iPhone browser to the App Store", () => {
		expect(decideAppBanner(context({ userAgent: IPHONE_SAFARI }))).toEqual({
			platform: "ios",
			storeUrl: APP_STORE_URL,
		});
	});

	it("links an Android phone browser to Google Play", () => {
		expect(decideAppBanner(context({ userAgent: ANDROID_CHROME }))).toEqual({
			platform: "android",
			storeUrl: PLAY_STORE_URL,
		});
	});

	it("stays hidden inside the store app shell", () => {
		expect(decideAppBanner(context({ isStoreAppShell: true }))).toBeNull();
	});

	it("stays hidden in an installed PWA", () => {
		expect(decideAppBanner(context({ isStandalone: true }))).toBeNull();
	});

	it.each([
		["desktop Chrome", DESKTOP_CHROME],
		["iPad Safari (desktop user agent)", IPAD_SAFARI],
		["Android tablet Chrome", ANDROID_TABLET_CHROME],
	])("stays hidden on %s", (_label, userAgent) => {
		expect(decideAppBanner(context({ userAgent }))).toBeNull();
	});

	it("stays hidden on a phone at tablet or desktop layout width", () => {
		expect(decideAppBanner(context({ isPhoneWidth: false }))).toBeNull();
		expect(decideAppBanner(context({ userAgent: ANDROID_CHROME, isPhoneWidth: false }))).toBeNull();
	});

	it("stays hidden without any store URL configured", () => {
		const storeUrls = { ios: null, android: null };
		expect(decideAppBanner(context({ storeUrls }))).toBeNull();
		expect(decideAppBanner(context({ storeUrls, userAgent: ANDROID_CHROME }))).toBeNull();
	});

	it("stays hidden when only the other platform's store URL is configured", () => {
		expect(
			decideAppBanner(context({ storeUrls: { ios: null, android: PLAY_STORE_URL } })),
		).toBeNull();
		expect(
			decideAppBanner(
				context({ userAgent: ANDROID_CHROME, storeUrls: { ios: APP_STORE_URL, android: null } }),
			),
		).toBeNull();
	});

	it("stays hidden for 90 days after a dismissal", () => {
		const dismissedAt = NOW.subtract({ hours: 24 * 90 - 1 }).toString();
		expect(decideAppBanner(context({ dismissedAt }))).toBeNull();
		expect(decideAppBanner(context({ dismissedAt: NOW.toString() }))).toBeNull();
	});

	it("shows again once 90 days have passed since the dismissal", () => {
		const dismissedAt = NOW.subtract({ hours: 24 * 90 }).toString();
		expect(decideAppBanner(context({ dismissedAt }))).toEqual({
			platform: "ios",
			storeUrl: APP_STORE_URL,
		});
	});

	it("treats an unreadable dismissal value as not dismissed", () => {
		expect(decideAppBanner(context({ dismissedAt: "not-a-date" }))).toEqual({
			platform: "ios",
			storeUrl: APP_STORE_URL,
		});
	});
});
