// Pure catalog configuration: languages, namespaces, route scopes and tree helpers.
// Client modules import this instead of `./shared`, which also holds the dynamic
// import map over every `messages/` file and would put it in every page bundle.

// Adding a language: extend this list, LANGUAGE_CONFIG, the calendar locale maps and the
// Tolgee push list; `language-coverage.test.ts` names any that are missing.
export const ALL_LANGUAGES = [
	"en",
	"de",
	"fr",
	"es",
	"it",
	"pt",
	"el",
	"pl",
	"tr",
	"gsw",
	"no",
	"sv",
	"ro",
	"hr",
	"bs",
	"sq",
	"uk",
	"ru",
];

export const DEFAULT_LANGUAGE = "en";

/**
 * The app's namespaces: what a route, the shell, the client and the complete server
 * catalog can load. Each must have a directory under `messages/`.
 */
export const APP_NAMESPACES = [
	"common",
	"admin",
	"approvals",
	"auth",
	"compliance",
	"analytics",
	"dashboard",
	"calendar",
	"timeTracking",
	"reports",
	"myRequests",
	"payroll",
	"scheduling",
	"setup",
	"settings/generic",
	"billing",
	"organization",
	"team",
	"today",
	"travelExpenses",
	"webhooks",
	"settings/enterprise",
	"settings/payrollExport",
	"settings/scheduledExports",
	"settings/holidays",
	"settings/workPolicies",
	"settings/vacation",
	"settings/auditExport",
	"settings/demo",
	"settings/rules",
	"settings/people",
	"settings/integrations",
	"onboarding",
	"bot",
	"teamsBot",
] as const;

/**
 * Namespaces only the mailer loads (`lib/email/email-i18n.ts`): never a route, the
 * shell, the client or the complete server catalog. The extractor, the Tolgee push
 * and the catalog metadata still know them through `CATALOG_NAMESPACES`.
 */
export const MAILER_NAMESPACES = ["emails"] as const;

/** Every catalog under `messages/`: the app's namespaces and the mailer's. */
export const CATALOG_NAMESPACES = [...APP_NAMESPACES, ...MAILER_NAMESPACES] as const;

export type Namespace = (typeof CATALOG_NAMESPACES)[number];

/** A namespace a route may load. */
export type AppNamespace = (typeof APP_NAMESPACES)[number];

export function isAppNamespace(namespace: string): namespace is AppNamespace {
	return (APP_NAMESPACES as readonly string[]).includes(namespace);
}

// Default namespace - loaded on all pages
export const DEFAULT_NAMESPACE: AppNamespace = "common";

// Namespace mapping for route prefixes
export const ROUTE_NAMESPACES: Record<string, AppNamespace[]> = {
	// Auth pages
	"/sign-in": ["common", "auth"],
	"/sign-up": ["common", "auth"],
	"/forgot-password": ["common", "auth"],
	"/reset-password": ["common", "auth"],
	"/verify-email": ["common", "auth"],
	// Platform admin routes
	"/platform-admin": ["common", "admin"],
	"/platform-admin/worker-queue": ["common", "admin", "settings/generic"],
	"/setup": ["common", "setup"],
	"/init": ["common", "setup"],
	"/kiosk": ["common", "timeTracking"],
	// The public report share link page (#806) renders project report copy.
	"/share": ["common", "reports"],
	"/approvals": ["common", "approvals"],
	"/my-requests": ["common", "myRequests"],
	"/my-documents": ["common", "settings/people"],
	"/equipment": ["common", "settings/generic"],
	"/my-equipment": ["common", "settings/generic"],
	"/driving-licence": ["common"],
	// settings/generic: the verifier responsibility panel (settings.drivingLicence.verifiers).
	"/team/driving-licence": ["common", "team", "settings/generic"],
	"/personnel-files": ["common", "settings/people"],
	// travelExpenses: confirming a payroll run as paid (#853).
	// settings/payrollExport: payroll line kind labels in payroll readiness (#854) and export history (#1957).
	// Note: settings/generic is already included for /payroll via route-catalog-scopes DEPENDENCIES.
	"/payroll": ["common", "payroll", "travelExpenses", "settings/payrollExport"],
	// settings/people: the Work balance section of the employee settings page (#995).
	"/payroll/work-balances": ["common", "payroll", "settings/people"],
	// Main app routes
	"/": ["common", "dashboard"],
	// settings/generic: merged health monitoring sections and scope labels from /settings/statistics (#1955).
	"/analytics": ["common", "analytics", "settings/generic"],
	"/calendar": ["common", "calendar", "timeTracking"],
	// settings/people: sick notes reuse the personnel file document list (#982).
	"/absences": ["common", "calendar", "settings/people"],
	"/time-tracking": ["common", "timeTracking", "compliance"],
	"/travel-expenses": ["common", "travelExpenses"],
	"/reports": ["common", "reports"],
	"/team": ["common", "team"],
	"/today": ["common", "today"],
	"/scheduling": ["common", "scheduling", "compliance"],
	"/billable-time/hand-off": ["common", "settings/generic", "reports"],
	"/settings/billing": ["common", "settings/generic", "billing"],
	"/settings": ["common", "settings/generic"],
	"/settings/approval-policies": [
		"common",
		"settings/generic",
		"settings/rules",
		"settings/people",
	],
	"/settings/audit-export": ["common", "settings/generic", "settings/auditExport"],
	"/settings/calendar": ["common", "settings/generic", "settings/integrations"],
	// scheduling: the Reviews & Conflicts inbox words statutory findings as Scheduling does (#1994).
	"/settings/contracts": [
		"common",
		"settings/generic",
		"settings/workPolicies",
		"settings/rules",
		"settings/people",
		"scheduling",
	],
	"/settings/demo": ["common", "settings/generic", "settings/demo"],
	"/settings/employees": ["common", "settings/generic", "settings/people", "settings/workPolicies"],
	// One boundary (enterprise/layout.tsx) serves every enterprise page; nested
	// scopes would ship the enterprise catalog twice. webhooks: the API key pages
	// embed the webhook management client.
	"/settings/enterprise": ["common", "settings/generic", "settings/enterprise", "webhooks"],
	// organization: the tracking-date, period-submission, reminder and automatic
	// clock-out panels moved here from the organization page.
	"/settings/clocking": [
		"common",
		"settings/generic",
		"settings/enterprise",
		"settings/workPolicies",
		"organization",
	],
	"/settings/notification-channels": ["common", "settings/generic", "settings/integrations"],
	"/settings/payroll-export": ["common", "settings/generic", "settings/payrollExport"],
	"/settings/personnel-files": ["common", "settings/generic", "settings/people"],
	"/settings/work-diagnostics": ["common", "settings/generic", "settings/payrollExport"],
	"/settings/report-share-links": ["common", "settings/generic", "reports"],
	"/settings/roles": ["common", "settings/generic", "settings/people"],
	"/settings/scheduled-exports": ["common", "settings/generic", "settings/scheduledExports"],
	"/settings/shifts": ["common", "settings/generic", "settings/rules"],
	"/settings/surcharges": ["common", "settings/generic", "settings/rules"],
	"/settings/teams": ["common", "settings/generic", "settings/people"],
	"/settings/travel-expenses": ["common", "settings/generic", "travelExpenses"],
	"/settings/vacation": [
		"common",
		"settings/generic",
		"settings/vacation",
		"settings/holidays",
		"settings/rules",
		"settings/people",
	],
	"/settings/work-categories": ["common", "settings/generic", "settings/rules"],
	"/settings/vehicles": ["common", "settings/generic", "settings/workPolicies"],
	"/settings/equipment": ["common", "settings/generic"],
	// settings/workPolicies: the intended-driver assignment cards (#1423).
	"/settings/driving-licence": ["common", "settings/generic", "settings/workPolicies"],
	"/settings/position-capture": ["common", "settings/generic", "settings/workPolicies"],
	"/settings/work-policies": [
		"common",
		"settings/generic",
		"settings/workPolicies",
		"settings/rules",
	],
	"/settings/compliance": ["common", "settings/generic", "compliance"],
	"/onboarding": ["common", "onboarding"],
};

/**
 * Get namespaces needed for a specific route path
 */
export function getNamespacesForRoute(pathname: string): AppNamespace[] {
	// Check exact match first
	if (ROUTE_NAMESPACES[pathname]) {
		return ROUTE_NAMESPACES[pathname];
	}

	// Check prefix matches (e.g., /settings/employees matches /settings)
	const prefixRoutes = Object.entries(ROUTE_NAMESPACES)
		.filter(([route]) => route !== "/")
		.sort(([a], [b]) => b.length - a.length);

	for (const [route, namespaces] of prefixRoutes) {
		const isSegmentBoundaryMatch = pathname === route || pathname.startsWith(`${route}/`);
		if (isSegmentBoundaryMatch) {
			return namespaces;
		}
	}

	// Default to common namespace
	return [DEFAULT_NAMESPACE];
}

// Tolgee's expected translation data type
export type TreeTranslationsData = {
	[key: string]: TreeTranslationsData | string;
};

export function mergeTreeTranslations(
	items: readonly TreeTranslationsData[],
): TreeTranslationsData {
	const merged: TreeTranslationsData = {};

	for (const item of items) {
		mergeTreeTranslationInto(merged, item);
	}

	return merged;
}

function mergeTreeTranslationInto(target: TreeTranslationsData, source: TreeTranslationsData) {
	for (const [key, value] of Object.entries(source)) {
		const targetValue = target[key];
		if (isTreeTranslationsData(targetValue) && isTreeTranslationsData(value)) {
			mergeTreeTranslationInto(targetValue, value);
			continue;
		}

		target[key] = value;
	}
}

function isTreeTranslationsData(value: unknown): value is TreeTranslationsData {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
