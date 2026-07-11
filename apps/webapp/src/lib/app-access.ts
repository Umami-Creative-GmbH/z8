import type { AppType } from "@/lib/audit-logger";

export interface AppAccessUser {
	canUseWebapp?: boolean | null;
	canUseDesktop?: boolean | null;
	canUseMobile?: boolean | null;
}

export interface AppAccessValidationResult {
	allowed: boolean;
	appType: AppType;
	reason?: string;
}

export function detectAppType(requestHeaders: Headers): AppType {
	const authHeader = requestHeaders.get("authorization");

	if (authHeader?.toLowerCase().startsWith("bearer ")) {
		const appTypeHeader = requestHeaders.get("x-z8-app-type")?.toLowerCase();
		if (appTypeHeader === "mobile" || appTypeHeader === "desktop") {
			return appTypeHeader;
		}

		const userAgent = requestHeaders.get("user-agent")?.toLowerCase() || "";
		if (
			userAgent.includes("mobile") ||
			userAgent.includes("android") ||
			userAgent.includes("ios") ||
			userAgent.includes("react native")
		) {
			return "mobile";
		}

		return "desktop";
	}

	return "webapp";
}

function getDeniedReason(appType: AppType): string {
	switch (appType) {
		case "webapp":
			return "Your account does not have access to the web application. Please contact your administrator.";
		case "desktop":
			return "Your account does not have access to the desktop application. Please contact your administrator.";
		case "mobile":
			return "Your account does not have access to the mobile application. Please contact your administrator.";
	}
}

export function validateAppAccess(
	user: AppAccessUser,
	requestHeaders: Headers,
	appTypeOverride?: AppType,
): AppAccessValidationResult {
	const appType = appTypeOverride ?? detectAppType(requestHeaders);
	const allowed =
		appType === "webapp"
			? (user.canUseWebapp ?? true)
			: appType === "mobile"
				? (user.canUseMobile ?? true)
				: (user.canUseDesktop ?? true);

	return {
		allowed,
		appType,
		reason: allowed ? undefined : getDeniedReason(appType),
	};
}

export function requireAppAccess(user: AppAccessUser, requestHeaders: Headers): AppType {
	const result = validateAppAccess(user, requestHeaders);

	if (!result.allowed) {
		throw new Error(result.reason || "Access denied");
	}

	return result.appType;
}
