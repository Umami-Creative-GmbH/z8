import type { SupportedApp } from "./app-auth-code";

const APP_CALLBACK_URLS: Record<SupportedApp, string> = {
	desktop: "z8://auth/callback",
	mobile: "z8mobile://auth/callback",
};

/**
 * The store app (#842) signs in as app type `mobile`. Unlike the desktop app, it
 * receives a session cookie in its web view, never the session token.
 */
export function isStoreApp(app: SupportedApp): app is "mobile" {
	return app === "mobile";
}

export function getAllowedAppRedirect(app: SupportedApp): string {
	return APP_CALLBACK_URLS[app];
}

export function getValidatedAppRedirectUrl(
	redirectUrl: string,
	app: SupportedApp,
): URL | null {
	try {
		const requested = new URL(redirectUrl);
		const allowed = new URL(getAllowedAppRedirect(app));
		if (
			requested.protocol !== allowed.protocol ||
			requested.hostname !== allowed.hostname ||
			requested.pathname !== allowed.pathname ||
			requested.username !== "" ||
			requested.password !== "" ||
			requested.port !== ""
		) {
			return null;
		}

		return requested;
	} catch {
		return null;
	}
}
