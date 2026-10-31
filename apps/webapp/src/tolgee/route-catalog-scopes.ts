import { type Namespace, ROUTE_NAMESPACES, type TreeTranslationsData } from "./catalog-config";
import { type CatalogSlice, canonicalizeNamespaces } from "./catalog-slices";

export type RouteCatalogScope = {
	route: string;
	namespaces: readonly Namespace[];
	keys: readonly string[];
	/** Top-level `common` subtrees the route never renders; left out of its slice. */
	omittedCommonSubtrees?: readonly string[];
};
const EXTRA_SCOPES: Record<string, Namespace[]> = {
	"/mfa": ["common", "settings/generic", "auth", "setup"],
	"/organization": ["common", "organization"],
	"/notifications": ["common"],
	"/compliance": ["common", "compliance"],
	"/works-council": ["common", "compliance", "settings/generic"],
	"/billing": ["common", "billing"],
	"/join": ["common", "auth", "setup", "settings/people"],
	"/licenses": ["common", "auth", "settings/generic"],
	"/settings/import": [
		"common",
		"settings/generic",
		"settings/integrations",
		"calendar",
	],
	"/settings/organizations": ["common", "settings/generic", "organization"],
	"/settings/profile": ["common", "settings/generic", "setup"],
	"/settings/security": ["common", "settings/generic", "auth", "setup"],
	"/settings/skills": ["common", "settings/generic", "settings/people"],
	// The enterprise ancestor supplies its own catalog; this page only needs audit-log copy.
	"/settings/enterprise/audit-log": ["common", "settings/auditExport"],
};
const AUTH_ROUTES = [
	"/sign-in",
	"/sign-up",
	"/forgot-password",
	"/reset-password",
	"/verify-email",
	"/verify-email-pending",
	"/verify-2fa",
	"/accept-invitation",
];
const AUTH_SET = new Set(AUTH_ROUTES);
// Signed-out pages never render these feature families. Together they are about two
// thirds of `common` (~125 KB of en JSON), which every auth page would inline otherwise.
const AUTH_OMITTED_COMMON_SUBTREES = [
	"drivingLicence",
	"notifications",
	"personalDataExport",
];
const DEPENDENCIES: Record<string, Namespace[]> = {
	"/sign-in": ["setup"],
	"/setup": ["auth"],
	"/init": ["organization"],
	"/analytics": ["reports"],
	"/calendar": ["timeTracking"],
	// settings/people: sick notes in the absence recording dialog (#984).
	"/team": ["calendar", "settings/people"],
	// Officers attach, link and unlink sick notes with the absence dialogs (#984).
	"/personnel-files": ["calendar"],
	// Report review panels and per diem place names render travelExpenses copy;
	// calendar: the sick-note marker on absence requests (#982).
	"/approvals": ["bot", "calendar", "travelExpenses"],
	// settings/generic: the close-month panel (#762).
	"/payroll": ["settings/generic"],
	"/platform-admin": ["settings/generic"],
	"/settings/approval-policies": ["settings/people"],
	"/settings/employees": ["organization"],
	"/settings/teams": ["organization"],
	"/settings/vacation": ["settings/rules"],
};
const AUDITED_KEYS: Record<string, string[]> = {
	"/": [
		"dashboard.customize",
		"errors.noOrganization.title",
		"organization.createDialog.title",
	],
	"/reports": [
		"reports.title",
		"reports:reports.title",
		"reports.projects.title",
	],
	"/billing": [
		"billing.suspended.title",
		"billing.suspended.adminDescription",
		"billing.suspended.memberDescription",
	],
	"/settings/clockodo-import": ["settings.clockodoImport.title"],
	"/settings/approval-policies": [
		"settings.approvalPolicies.title",
		"settings/rules:settings.approvalPolicies.title",
	],
};

/** Explicit route families. Grouped auth pages share their actual group boundary.
 * These scopes never use request pathname headers or acquire catalogs in a client.
 */
export const ROUTE_CATALOG_SCOPES: readonly RouteCatalogScope[] =
	Object.entries({
		...ROUTE_NAMESPACES,
		...EXTRA_SCOPES,
	})
		.filter(([route]) => !AUTH_SET.has(route) || route === "/sign-in")
		.filter(([route]) => route !== "/platform-admin/worker-queue")
		.map(([route, namespaces]) => ({
			route,
			namespaces: canonicalizeNamespaces([
				...namespaces,
				...(DEPENDENCIES[route] ?? []),
			]),
			keys: [
				"errors.noEmployee.title",
				"organization.createDialog.title",
				...(AUDITED_KEYS[route] ?? []),
			],
			...(route === "/sign-in"
				? { omittedCommonSubtrees: AUTH_OMITTED_COMMON_SUBTREES }
				: {}),
		}));

/**
 * Drops a scope's omitted `common` subtrees (and their `common:` aliases) from its
 * slice. The result no longer declares `common` complete: like the shell's partial
 * leaves, it merges into the client dictionary without claiming the namespace.
 */
export function projectRouteCatalog(
	scope: RouteCatalogScope,
	slice: CatalogSlice,
): CatalogSlice {
	if (!scope.omittedCommonSubtrees?.length) return slice;
	const omitted = new Set(
		scope.omittedCommonSubtrees.flatMap((key) => [key, `common:${key}`]),
	);
	const tree = Object.fromEntries(
		Object.entries(
			(slice.records[slice.locale] ?? {}) as TreeTranslationsData,
		).filter(([key]) => !omitted.has(key)),
	);
	const keyOwners = Object.fromEntries(
		Object.entries(slice.keyOwners).filter(
			([encoded]) => !omitted.has((JSON.parse(encoded) as string[])[0]),
		),
	);
	return {
		locale: slice.locale,
		namespaces: slice.namespaces.filter((namespace) => namespace !== "common"),
		records: { [slice.locale]: tree },
		keyOwners,
	};
}

export function getRouteCatalogScope(
	pathname: string,
): RouteCatalogScope | undefined {
	const path = AUTH_ROUTES.some(
		(route) => pathname === route || pathname.startsWith(`${route}/`),
	)
		? "/sign-in"
		: pathname;
	return [...ROUTE_CATALOG_SCOPES]
		.sort((a, b) => b.route.length - a.route.length)
		.find(
			({ route }) =>
				path === route || (route !== "/" && path.startsWith(`${route}/`)),
		);
}
