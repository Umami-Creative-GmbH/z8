import { z } from "zod";
import { SETTINGS_ENTRIES } from "@/components/settings/settings-config";
import { ALL_LANGUAGES } from "@/tolgee/catalog-config";
import { getManifestOwnedHeadingPaths, getManifestRouteMetadata } from "./navigation-manifest";

export type AppRouteMetadata = {
	id: string;
	href: string;
	titleKey: string;
	titleDefault: string;
};

export const APP_ROUTE_METADATA: readonly AppRouteMetadata[] = [
	...getManifestRouteMetadata(),
	// Equipment's and Approval's new titles still need Tolgee sync. Until then the
	// shell uses their catalog-backed Settings ancestor; the page/nav have dedicated defaults.
	...SETTINGS_ENTRIES.filter((entry) => entry.id !== "equipment" && entry.id !== "approval").map(
		(entry) => ({
			id: `settings-${entry.id}`,
			href: entry.href,
			titleKey: entry.titleKey,
			titleDefault: entry.titleDefault,
		}),
	),
] as const;

const MANIFEST_PAGE_HEADING_ROUTES = getManifestOwnedHeadingPaths();

export const UNKNOWN_ROUTE_METADATA: AppRouteMetadata = {
	id: "unknown",
	href: "",
	titleKey: "common.appName",
	titleDefault: "Z8",
};

export function normalizeAppPath(pathname: string): string {
	const [firstSegment, ...remainingSegments] = pathname.split("/").filter(Boolean);
	const segments = ALL_LANGUAGES.includes(firstSegment as (typeof ALL_LANGUAGES)[number])
		? remainingSegments
		: [firstSegment, ...remainingSegments].filter(Boolean);
	return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/** Settings routes that render their own PageHeader (or SettingsTabbedPage) h1.
 * Legacy settings URLs redirect in `proxy.ts` and are not listed here.
 */
const SETTINGS_PAGE_HEADING_ROUTES: ReadonlySet<string> = new Set([
	"/settings",
	"/settings/approval-policies",
	"/settings/audit-export",
	"/settings/avv",
	"/settings/billable-time",
	"/settings/billable-time/accounting",
	"/settings/billable-time/cost-rates",
	"/settings/billing",
	"/settings/calendar",
	"/settings/clocking",
	"/settings/compliance",
	"/settings/compliance/works-council",
	"/settings/custom-fields",
	"/settings/customers",
	"/settings/demo",
	"/settings/driving-licence",
	"/settings/employees",
	"/settings/enterprise/api-keys",
	"/settings/enterprise/domains",
	"/settings/enterprise/email",
	"/settings/enterprise/identity-setup",
	"/settings/equipment",
	"/settings/export",
	"/settings/export-operations",
	"/settings/implementation-checklist",
	"/settings/import",
	"/settings/kiosks",
	"/settings/locations",
	"/settings/my-data",
	"/settings/notification-channels",
	"/settings/notifications",
	"/settings/organization",
	"/settings/payroll-access",
	"/settings/payroll-export",
	"/settings/personnel-files",
	"/settings/position-capture",
	"/settings/position-stamps",
	"/settings/profile",
	"/settings/projects",
	"/settings/report-share-links",
	"/settings/roles",
	"/settings/scheduled-exports",
	"/settings/security",
	"/settings/shifts",
	"/settings/skills",
	"/settings/surcharges",
	"/settings/teams",
	"/settings/travel-expenses",
	"/settings/vacation",
	"/settings/vacation/employees",
	"/settings/vehicles",
	"/settings/wellness",
	"/settings/work-diagnostics",
	"/settings/work-policies",
]);

/** Settings record pages (one dynamic segment) that render their own h1. */
const SETTINGS_RECORD_HEADING_ROUTES: readonly RegExp[] = [
	// `new` is a retired legacy URL redirected in `proxy.ts`, not an employee detail record.
	/^\/settings\/employees\/(?!new$)[^/]+$/,
	/^\/settings\/teams\/[^/]+$/,
	/^\/settings\/locations\/[^/]+$/,
	/^\/settings\/import\/[^/]+$/,
	/^\/settings\/enterprise\/api-keys\/[^/]+$/,
	/^\/settings\/vacation\/employees\/[^/]+$/,
	/^\/settings\/export\/history\/[^/]+$/,
];

/** Exact opt-ins only: adopt a page heading and update this list atomically.
 * Descendants keep their shell title until their own page ticket converts them.
 */
export function appPageOwnsHeading(pathname: string): boolean {
	const path = normalizeAppPath(pathname);
	const legacyClaimId = /^\/travel-expenses\/([^/]+)$/.exec(path)?.[1];
	const reportId = /^\/travel-expenses\/reports\/([^/]+)$/.exec(path)?.[1];
	return (
		MANIFEST_PAGE_HEADING_ROUTES.has(path) ||
		SETTINGS_PAGE_HEADING_ROUTES.has(path) ||
		SETTINGS_RECORD_HEADING_ROUTES.some((pattern) => pattern.test(path)) ||
		Boolean(legacyClaimId && z.uuid().safeParse(legacyClaimId).success) ||
		Boolean(reportId && z.uuid().safeParse(reportId).success) ||
		/^\/team\/presence\/[^/]+$/.test(path) ||
		/^\/personnel-files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
			path,
		) ||
		/^\/equipment\/assignments\/[^/]+$/.test(path) ||
		/^\/equipment\/employees\/[^/]+$/.test(path) ||
		/^\/team\/driving-licence\/[^/]+$/.test(path) ||
		/^\/approvals\/review\/[^/]+\/[^/]+\/[^/]+$/.test(path) ||
		/^\/approvals\/deputy-decisions\/[^/]+$/.test(path) ||
		/^\/calendar\/[^/]+$/.test(path) ||
		/^\/payroll\/work-balances\/[^/]+$/.test(path) ||
		/^\/personnel-files\/payslip-batches\/[^/]+$/.test(path)
	);
}

function routeMatches(pathname: string, href: string): boolean {
	if (href === "/") return pathname === "/";
	return pathname === href || pathname.startsWith(`${href}/`);
}

export function resolveAppRouteMetadata(pathname: string): AppRouteMetadata {
	const normalizedPath = normalizeAppPath(pathname);
	return (
		[...APP_ROUTE_METADATA]
			.sort((left, right) => right.href.length - left.href.length)
			.find((route) => routeMatches(normalizedPath, route.href)) ?? UNKNOWN_ROUTE_METADATA
	);
}
