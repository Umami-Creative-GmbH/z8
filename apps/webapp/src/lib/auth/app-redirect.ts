import type { SupportedApp } from "./app-auth-code";

const APP_CALLBACK_URLS: Record<SupportedApp, string> = {
	desktop: "z8://auth/callback",
	mobile: "z8mobile://auth/callback",
};

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
