import { canonicalizeNamespaces } from "./catalog-slices";
import { type Namespace, ROUTE_NAMESPACES } from "./shared";

type RouteCatalogScope = {
	route: string;
	namespaces: readonly Namespace[];
	keys: readonly string[];
};
const EXTRA_SCOPES: Record<string, Namespace[]> = {
	"/organization": ["common", "organization"],
	"/notifications": ["common"],
	"/compliance": ["common", "compliance"],
	"/works-council": ["common", "compliance", "settings/generic"],
	"/billing": ["common", "billing"],
	"/join": ["common", "auth", "setup", "settings/people"],
	"/licenses": ["common", "auth", "settings/generic"],
	"/settings/import": ["common", "settings/generic", "settings/integrations"],
	"/settings/organizations": ["common", "settings/generic", "organization"],
	"/settings/profile": ["common", "settings/generic", "setup"],
	"/settings/security": ["common", "settings/generic", "auth", "setup"],
	"/settings/skills": ["common", "settings/generic", "settings/people"],
	"/settings/enterprise/audit-log": [
		"common",
		"settings/generic",
		"settings/enterprise",
		"settings/auditExport",
	],
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
const DEPENDENCIES: Record<string, Namespace[]> = {
	"/sign-in": ["setup"],
	"/init": ["organization"],
	"/analytics": ["reports"],
	"/calendar": ["timeTracking"],
	"/team": ["calendar"],
	"/approvals": ["bot"],
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
	Object.entries({ ...ROUTE_NAMESPACES, ...EXTRA_SCOPES })
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
		}));

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
