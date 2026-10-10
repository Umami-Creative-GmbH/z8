import { Temporal } from "temporal-polyfill";
import type { StoreAppPlatform } from "./shell";

/**
 * Decides whether the "Get the app" banner shows and which store it links to (#847).
 *
 * Presentation only: every input comes from the viewer's browser, so this never gates access.
 */

/** Store listing URLs from configuration; `null` when a listing is not configured. */
export interface StoreAppUrls {
	ios: string | null;
	android: string | null;
}

export interface AppBannerContext {
	userAgent: string;
	/** Whether the phone-width layout is active (below the `md` breakpoint). */
	isPhoneWidth: boolean;
	/** Whether the page runs as an installed PWA (`display-mode: standalone`). */
	isStandalone: boolean;
	isStoreAppShell: boolean;
	/** The stored dismissal instant (ISO string), or `null` when never dismissed. */
	dismissedAt: string | null;
	now: Temporal.Instant;
	storeUrls: StoreAppUrls;
}

export interface AppBannerDecision {
	platform: StoreAppPlatform;
	storeUrl: string;
}

/** A dismissal hides the banner in that browser for this long. */
export const APP_BANNER_DISMISSAL_HOURS = 24 * 90;

/** `localStorage` key holding the dismissal instant for this browser. */
export const APP_BANNER_DISMISSED_AT_STORAGE_KEY = "z8.storeAppBanner.dismissedAt";

const IPHONE = /\b(?:iPhone|iPod)\b/;
const ANDROID = /\bAndroid\b/;
// Android phones send "Mobile"; Android tablets leave it out.
const MOBILE = /\bMobile\b/;

function getPhonePlatform(userAgent: string): StoreAppPlatform | null {
	if (IPHONE.test(userAgent)) return "ios";
	if (ANDROID.test(userAgent) && MOBILE.test(userAgent)) return "android";
	// iPadOS Safari reports a desktop Mac user agent and lands here with the tablets.
	return null;
}

function isWithinDismissal(dismissedAt: string | null, now: Temporal.Instant): boolean {
	if (!dismissedAt) return false;

	let dismissed: Temporal.Instant;
	try {
		dismissed = Temporal.Instant.from(dismissedAt);
	} catch {
		return false;
	}

	const showsAgainAt = dismissed.add({ hours: APP_BANNER_DISMISSAL_HOURS });
	return Temporal.Instant.compare(now, showsAgainAt) < 0;
}

export function decideAppBanner(context: AppBannerContext): AppBannerDecision | null {
	if (context.isStoreAppShell || context.isStandalone || !context.isPhoneWidth) return null;

	const platform = getPhonePlatform(context.userAgent);
	if (!platform) return null;

	const storeUrl = context.storeUrls[platform];
	if (!storeUrl) return null;

	if (isWithinDismissal(context.dismissedAt, context.now)) return null;

	return { platform, storeUrl };
}
