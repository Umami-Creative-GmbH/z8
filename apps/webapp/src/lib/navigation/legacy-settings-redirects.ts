export interface LegacySettingsRedirectTarget {
	readonly pathname: string;
	readonly tab?: string;
}

/**
 * Legacy settings URLs (and other retired app routes such as `/approvals`) replaced by centralized
 * 308 permanent redirects in the request proxy (#1963).
 * Keys are exact locale-stripped paths (without trailing slashes) so canonical sibling or child
 * routes such as `/settings/enterprise/api-keys` or `/settings/employees/[id]` are never hijacked.
 */
export const LEGACY_SETTINGS_REDIRECTS: Readonly<Record<string, LegacySettingsRedirectTarget>> = {
	"/settings/organizations": { pathname: "/settings/organization" },
	"/settings/audit-log": { pathname: "/settings/audit-export", tab: "activity" },
	"/settings/enterprise/audit-log": { pathname: "/settings/audit-export", tab: "activity" },
	"/settings/enterprise": { pathname: "/settings/enterprise/domains" },
	"/settings/enterprise/sso": { pathname: "/settings/enterprise/identity-setup", tab: "sso" },
	"/settings/enterprise/branding": { pathname: "/settings/enterprise/domains", tab: "branding" },
	"/settings/discord": { pathname: "/settings/notification-channels", tab: "discord" },
	"/settings/slack": { pathname: "/settings/notification-channels", tab: "slack" },
	"/settings/telegram": { pathname: "/settings/notification-channels", tab: "telegram" },
	"/settings/teams-notifications": { pathname: "/settings/notification-channels", tab: "teams" },
	"/settings/email-templates": { pathname: "/settings/enterprise/email", tab: "templates" },
	"/settings/webhooks": { pathname: "/settings/enterprise/api-keys", tab: "webhooks" },
	"/settings/vehicle-use": { pathname: "/settings/vehicles", tab: "use" },
	"/settings/clockodo-import": { pathname: "/settings/import" },
	"/settings/holidays": { pathname: "/settings/vacation", tab: "holidays" },
	"/settings/change-policies": { pathname: "/settings/work-policies", tab: "changes" },
	"/settings/coverage-rules": { pathname: "/settings/shifts", tab: "coverage" },
	"/settings/approval-escalation": { pathname: "/settings/approval-policies", tab: "escalation" },
	"/settings/employees/new": { pathname: "/settings/employees" },
	"/settings/permissions": { pathname: "/settings/roles", tab: "team-permissions" },
	// The retired two-tab approvals workspace; the Approval inbox is canonical (#1976).
	"/approvals": { pathname: "/approvals/inbox" },
};

/**
 * Resolves a locale-stripped pathname to its canonical localized settings destination
 * (preserving extra query parameters while applying the canonical `tab` when defined),
 * or returns `null` if the pathname is not a retired legacy settings route.
 */
export function resolveLegacySettingsRedirect(
	pathWithoutLocale: string,
	locale: string,
	searchParams: URLSearchParams,
): string | null {
	const normalizedPath =
		pathWithoutLocale.length > 1 ? pathWithoutLocale.replace(/\/+$/, "") || "/" : pathWithoutLocale;
	if (!Object.hasOwn(LEGACY_SETTINGS_REDIRECTS, normalizedPath)) {
		return null;
	}
	const target = LEGACY_SETTINGS_REDIRECTS[normalizedPath];
	const mergedSearch = new URLSearchParams(searchParams);
	if (target.tab !== undefined) {
		mergedSearch.set("tab", target.tab);
	}
	const query = mergedSearch.toString();
	return `/${locale}${target.pathname}${query ? `?${query}` : ""}`;
}
