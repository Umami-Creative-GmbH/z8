import { FormatIcu } from "@tolgee/format-icu";
import type { TolgeeStaticData } from "@tolgee/react";
import { DevTools, Tolgee } from "@tolgee/web";

const isDevelopment = process.env.NODE_ENV === "development";

export const ALL_LANGUAGES = ["en", "de", "fr", "es", "it", "pt"];

export const DEFAULT_LANGUAGE = "en";

// All available namespaces - must match the namespace directory structure
export const ALL_NAMESPACES = [
	"common",
	"admin",
	"approvals",
	"auth",
	"compliance",
	"dashboard",
	"calendar",
	"timeTracking",
	"reports",
	"myRequests",
	"scheduling",
	"setup",
	"settings/generic",
	"billing",
	"organization",
	"team",
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

export type Namespace = (typeof ALL_NAMESPACES)[number];

// Default namespace - loaded on all pages
export const DEFAULT_NAMESPACE: Namespace = "common";

// Namespace mapping for route prefixes
export const ROUTE_NAMESPACES: Record<string, Namespace[]> = {
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
	"/approvals": ["common", "approvals"],
	"/my-requests": ["common", "myRequests"],
	// Main app routes
	"/": ["common", "dashboard"],
	"/calendar": ["common", "calendar"],
	"/absences": ["common", "calendar"],
	"/time-tracking": ["common", "timeTracking", "compliance"],
	"/travel-expenses": ["common", "travelExpenses"],
	"/reports": ["common", "reports"],
	"/team": ["common", "team"],
	"/scheduling": ["common", "scheduling", "compliance"],
	"/settings/billing": ["common", "settings/generic", "billing"],
	"/settings": ["common", "settings/generic"],
	"/settings/approval-policies": ["common", "settings/generic", "settings/rules"],
	"/settings/audit-export": ["common", "settings/generic", "settings/auditExport"],
	"/settings/audit-log": ["common", "settings/generic", "settings/auditExport"],
	"/settings/calendar": ["common", "settings/generic", "settings/integrations"],
	"/settings/change-policies": ["common", "settings/generic", "settings/rules"],
	"/settings/clockodo-import": ["common", "settings/generic", "settings/integrations"],
	"/settings/coverage-rules": ["common", "settings/generic", "settings/rules"],
	"/settings/demo": ["common", "settings/generic", "settings/demo"],
	"/settings/discord": ["common", "settings/generic", "settings/integrations"],
	"/settings/employees": ["common", "settings/generic", "settings/people"],
	"/settings/enterprise": ["common", "settings/generic", "settings/enterprise"],
	"/settings/holidays": ["common", "settings/generic", "settings/holidays"],
	"/settings/permissions": ["common", "settings/generic", "settings/people"],
	"/settings/payroll-export": ["common", "settings/generic", "settings/payrollExport"],
	"/settings/payroll-readiness": ["common", "settings/generic", "settings/payrollExport"],
	"/settings/roles": ["common", "settings/generic", "settings/people"],
	"/settings/scheduled-exports": ["common", "settings/generic", "settings/scheduledExports"],
	"/settings/shifts": ["common", "settings/generic", "settings/rules"],
	"/settings/slack": ["common", "settings/generic", "settings/integrations"],
	"/settings/surcharges": ["common", "settings/generic", "settings/rules"],
	"/settings/teams": ["common", "settings/generic", "settings/people"],
	"/settings/teams-notifications": ["common", "settings/generic", "settings/integrations"],
	"/settings/telegram": ["common", "settings/generic", "settings/integrations"],
	"/settings/travel-expenses": ["common", "settings/generic", "travelExpenses"],
	"/settings/vacation": ["common", "settings/generic", "settings/vacation"],
	"/settings/webhooks": ["common", "settings/generic", "webhooks"],
	"/settings/work-categories": ["common", "settings/generic", "settings/rules"],
	"/settings/work-policies": ["common", "settings/generic", "settings/workPolicies"],
	"/settings/compliance": ["common", "settings/generic", "compliance"],
	"/onboarding": ["common", "onboarding"],
};

/**
 * Get namespaces needed for a specific route path
 */
export function getNamespacesForRoute(pathname: string): Namespace[] {
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

/**
 * Dynamic import functions for each namespace and language.
 * Tolgee CLI owns the generated JSON files after this manual split.
 */
const namespaceImports: Record<Namespace, Record<string, () => Promise<unknown>>> = {
	common: {
		en: () => import("../../messages/common/en.json"),
		de: () => import("../../messages/common/de.json"),
		fr: () => import("../../messages/common/fr.json"),
		es: () => import("../../messages/common/es.json"),
		it: () => import("../../messages/common/it.json"),
		pt: () => import("../../messages/common/pt.json"),
	},
	admin: {
		en: () => import("../../messages/admin/en.json"),
		de: () => import("../../messages/admin/de.json"),
		fr: () => import("../../messages/admin/fr.json"),
		es: () => import("../../messages/admin/es.json"),
		it: () => import("../../messages/admin/it.json"),
		pt: () => import("../../messages/admin/pt.json"),
	},
	approvals: {
		en: () => import("../../messages/approvals/en.json"),
		de: () => import("../../messages/approvals/de.json"),
		fr: () => import("../../messages/approvals/fr.json"),
		es: () => import("../../messages/approvals/es.json"),
		it: () => import("../../messages/approvals/it.json"),
		pt: () => import("../../messages/approvals/pt.json"),
	},
	auth: {
		en: () => import("../../messages/auth/en.json"),
		de: () => import("../../messages/auth/de.json"),
		fr: () => import("../../messages/auth/fr.json"),
		es: () => import("../../messages/auth/es.json"),
		it: () => import("../../messages/auth/it.json"),
		pt: () => import("../../messages/auth/pt.json"),
	},
	compliance: {
		en: () => import("../../messages/compliance/en.json"),
		de: () => import("../../messages/compliance/de.json"),
		fr: () => import("../../messages/compliance/fr.json"),
		es: () => import("../../messages/compliance/es.json"),
		it: () => import("../../messages/compliance/it.json"),
		pt: () => import("../../messages/compliance/pt.json"),
	},
	dashboard: {
		en: () => import("../../messages/dashboard/en.json"),
		de: () => import("../../messages/dashboard/de.json"),
		fr: () => import("../../messages/dashboard/fr.json"),
		es: () => import("../../messages/dashboard/es.json"),
		it: () => import("../../messages/dashboard/it.json"),
		pt: () => import("../../messages/dashboard/pt.json"),
	},
	calendar: {
		en: () => import("../../messages/calendar/en.json"),
		de: () => import("../../messages/calendar/de.json"),
		fr: () => import("../../messages/calendar/fr.json"),
		es: () => import("../../messages/calendar/es.json"),
		it: () => import("../../messages/calendar/it.json"),
		pt: () => import("../../messages/calendar/pt.json"),
	},
	timeTracking: {
		en: () => import("../../messages/timeTracking/en.json"),
		de: () => import("../../messages/timeTracking/de.json"),
		fr: () => import("../../messages/timeTracking/fr.json"),
		es: () => import("../../messages/timeTracking/es.json"),
		it: () => import("../../messages/timeTracking/it.json"),
		pt: () => import("../../messages/timeTracking/pt.json"),
	},
	reports: {
		en: () => import("../../messages/reports/en.json"),
		de: () => import("../../messages/reports/de.json"),
		fr: () => import("../../messages/reports/fr.json"),
		es: () => import("../../messages/reports/es.json"),
		it: () => import("../../messages/reports/it.json"),
		pt: () => import("../../messages/reports/pt.json"),
	},
	myRequests: {
		en: () => import("../../messages/myRequests/en.json"),
		de: () => import("../../messages/myRequests/de.json"),
		fr: () => import("../../messages/myRequests/fr.json"),
		es: () => import("../../messages/myRequests/es.json"),
		it: () => import("../../messages/myRequests/it.json"),
		pt: () => import("../../messages/myRequests/pt.json"),
	},
	scheduling: {
		en: () => import("../../messages/scheduling/en.json"),
		de: () => import("../../messages/scheduling/de.json"),
		fr: () => import("../../messages/scheduling/fr.json"),
		es: () => import("../../messages/scheduling/es.json"),
		it: () => import("../../messages/scheduling/it.json"),
		pt: () => import("../../messages/scheduling/pt.json"),
	},
	setup: {
		en: () => import("../../messages/setup/en.json"),
		de: () => import("../../messages/setup/de.json"),
		fr: () => import("../../messages/setup/fr.json"),
		es: () => import("../../messages/setup/es.json"),
		it: () => import("../../messages/setup/it.json"),
		pt: () => import("../../messages/setup/pt.json"),
	},
	"settings/generic": {
		en: () => import("../../messages/settings/generic/en.json"),
		de: () => import("../../messages/settings/generic/de.json"),
		fr: () => import("../../messages/settings/generic/fr.json"),
		es: () => import("../../messages/settings/generic/es.json"),
		it: () => import("../../messages/settings/generic/it.json"),
		pt: () => import("../../messages/settings/generic/pt.json"),
	},
	billing: {
		en: () => import("../../messages/billing/en.json"),
		de: () => import("../../messages/billing/de.json"),
		fr: () => import("../../messages/billing/fr.json"),
		es: () => import("../../messages/billing/es.json"),
		it: () => import("../../messages/billing/it.json"),
		pt: () => import("../../messages/billing/pt.json"),
	},
	organization: {
		en: () => import("../../messages/organization/en.json"),
		de: () => import("../../messages/organization/de.json"),
		fr: () => import("../../messages/organization/fr.json"),
		es: () => import("../../messages/organization/es.json"),
		it: () => import("../../messages/organization/it.json"),
		pt: () => import("../../messages/organization/pt.json"),
	},
	team: {
		en: () => import("../../messages/team/en.json"),
		de: () => import("../../messages/team/de.json"),
		fr: () => import("../../messages/team/fr.json"),
		es: () => import("../../messages/team/es.json"),
		it: () => import("../../messages/team/it.json"),
		pt: () => import("../../messages/team/pt.json"),
	},
	travelExpenses: {
		en: () => import("../../messages/travelExpenses/en.json"),
		de: () => import("../../messages/travelExpenses/de.json"),
		fr: () => import("../../messages/travelExpenses/fr.json"),
		es: () => import("../../messages/travelExpenses/es.json"),
		it: () => import("../../messages/travelExpenses/it.json"),
		pt: () => import("../../messages/travelExpenses/pt.json"),
	},
	webhooks: {
		en: () => import("../../messages/webhooks/en.json"),
		de: () => import("../../messages/webhooks/de.json"),
		fr: () => import("../../messages/webhooks/fr.json"),
		es: () => import("../../messages/webhooks/es.json"),
		it: () => import("../../messages/webhooks/it.json"),
		pt: () => import("../../messages/webhooks/pt.json"),
	},
	"settings/enterprise": {
		en: () => import("../../messages/settings/enterprise/en.json"),
		de: () => import("../../messages/settings/enterprise/de.json"),
		fr: () => import("../../messages/settings/enterprise/fr.json"),
		es: () => import("../../messages/settings/enterprise/es.json"),
		it: () => import("../../messages/settings/enterprise/it.json"),
		pt: () => import("../../messages/settings/enterprise/pt.json"),
	},
	"settings/payrollExport": {
		en: () => import("../../messages/settings/payrollExport/en.json"),
		de: () => import("../../messages/settings/payrollExport/de.json"),
		fr: () => import("../../messages/settings/payrollExport/fr.json"),
		es: () => import("../../messages/settings/payrollExport/es.json"),
		it: () => import("../../messages/settings/payrollExport/it.json"),
		pt: () => import("../../messages/settings/payrollExport/pt.json"),
	},
	"settings/scheduledExports": {
		en: () => import("../../messages/settings/scheduledExports/en.json"),
		de: () => import("../../messages/settings/scheduledExports/de.json"),
		fr: () => import("../../messages/settings/scheduledExports/fr.json"),
		es: () => import("../../messages/settings/scheduledExports/es.json"),
		it: () => import("../../messages/settings/scheduledExports/it.json"),
		pt: () => import("../../messages/settings/scheduledExports/pt.json"),
	},
	"settings/holidays": {
		en: () => import("../../messages/settings/holidays/en.json"),
		de: () => import("../../messages/settings/holidays/de.json"),
		fr: () => import("../../messages/settings/holidays/fr.json"),
		es: () => import("../../messages/settings/holidays/es.json"),
		it: () => import("../../messages/settings/holidays/it.json"),
		pt: () => import("../../messages/settings/holidays/pt.json"),
	},
	"settings/workPolicies": {
		en: () => import("../../messages/settings/workPolicies/en.json"),
		de: () => import("../../messages/settings/workPolicies/de.json"),
		fr: () => import("../../messages/settings/workPolicies/fr.json"),
		es: () => import("../../messages/settings/workPolicies/es.json"),
		it: () => import("../../messages/settings/workPolicies/it.json"),
		pt: () => import("../../messages/settings/workPolicies/pt.json"),
	},
	"settings/vacation": {
		en: () => import("../../messages/settings/vacation/en.json"),
		de: () => import("../../messages/settings/vacation/de.json"),
		fr: () => import("../../messages/settings/vacation/fr.json"),
		es: () => import("../../messages/settings/vacation/es.json"),
		it: () => import("../../messages/settings/vacation/it.json"),
		pt: () => import("../../messages/settings/vacation/pt.json"),
	},
	"settings/auditExport": {
		en: () => import("../../messages/settings/auditExport/en.json"),
		de: () => import("../../messages/settings/auditExport/de.json"),
		fr: () => import("../../messages/settings/auditExport/fr.json"),
		es: () => import("../../messages/settings/auditExport/es.json"),
		it: () => import("../../messages/settings/auditExport/it.json"),
		pt: () => import("../../messages/settings/auditExport/pt.json"),
	},
	"settings/demo": {
		en: () => import("../../messages/settings/demo/en.json"),
		de: () => import("../../messages/settings/demo/de.json"),
		fr: () => import("../../messages/settings/demo/fr.json"),
		es: () => import("../../messages/settings/demo/es.json"),
		it: () => import("../../messages/settings/demo/it.json"),
		pt: () => import("../../messages/settings/demo/pt.json"),
	},
	"settings/rules": {
		en: () => import("../../messages/settings/rules/en.json"),
		de: () => import("../../messages/settings/rules/de.json"),
		fr: () => import("../../messages/settings/rules/fr.json"),
		es: () => import("../../messages/settings/rules/es.json"),
		it: () => import("../../messages/settings/rules/it.json"),
		pt: () => import("../../messages/settings/rules/pt.json"),
	},
	"settings/people": {
		en: () => import("../../messages/settings/people/en.json"),
		de: () => import("../../messages/settings/people/de.json"),
		fr: () => import("../../messages/settings/people/fr.json"),
		es: () => import("../../messages/settings/people/es.json"),
		it: () => import("../../messages/settings/people/it.json"),
		pt: () => import("../../messages/settings/people/pt.json"),
	},
	"settings/integrations": {
		en: () => import("../../messages/settings/integrations/en.json"),
		de: () => import("../../messages/settings/integrations/de.json"),
		fr: () => import("../../messages/settings/integrations/fr.json"),
		es: () => import("../../messages/settings/integrations/es.json"),
		it: () => import("../../messages/settings/integrations/it.json"),
		pt: () => import("../../messages/settings/integrations/pt.json"),
	},
	onboarding: {
		en: () => import("../../messages/onboarding/en.json"),
		de: () => import("../../messages/onboarding/de.json"),
		fr: () => import("../../messages/onboarding/fr.json"),
		es: () => import("../../messages/onboarding/es.json"),
		it: () => import("../../messages/onboarding/it.json"),
		pt: () => import("../../messages/onboarding/pt.json"),
	},
	bot: {
		en: () => import("../../messages/bot/en.json"),
		de: () => import("../../messages/bot/de.json"),
		fr: () => import("../../messages/bot/fr.json"),
		es: () => import("../../messages/bot/es.json"),
		it: () => import("../../messages/bot/it.json"),
		pt: () => import("../../messages/bot/pt.json"),
	},
	teamsBot: {
		en: () => import("../../messages/teamsBot/en.json"),
		de: () => import("../../messages/teamsBot/de.json"),
		fr: () => import("../../messages/teamsBot/fr.json"),
		es: () => import("../../messages/teamsBot/es.json"),
		it: () => import("../../messages/teamsBot/it.json"),
		pt: () => import("../../messages/teamsBot/pt.json"),
	},
};

/**
 * Load specific namespaces for SSR
 * Merges all namespace translations into a single object keyed by locale.
 * This allows t("auth.login") to work without specifying namespace.
 */
export async function loadNamespaces(
	locale: string,
	namespaces: readonly Namespace[],
): Promise<TolgeeStaticData> {
	const lang = ALL_LANGUAGES.includes(locale) ? locale : DEFAULT_LANGUAGE;

	// Load all requested namespaces in parallel
	const loadPromises = namespaces.map(async (ns) => {
		const importFn = namespaceImports[ns]?.[lang];
		if (importFn) {
			try {
				const mod = await importFn();
				const data =
					(mod as { default?: TreeTranslationsData }).default || (mod as TreeTranslationsData);
				return { ns, data };
			} catch (error) {
				console.warn(`Failed to load namespace ${ns} for ${lang}:`, error);
				return { ns, data: {} as TreeTranslationsData };
			}
		}
		return { ns, data: {} as TreeTranslationsData };
	});

	const loaded = await Promise.all(loadPromises);

	// Merge all namespace translations into a single object
	// This allows t("auth.login") to work without specifying namespace
	const merged = mergeTreeTranslations(loaded.map(({ data }) => data));
	for (const { ns, data } of loaded) {
		addNamespaceKeyAliases(merged, ns, data);
	}

	// Return in TolgeeStaticData format with just the locale as key
	const result: Record<string, TreeTranslationsData> = {
		[lang]: merged,
	};

	return result;
}

/**
 * Load translations for a specific route
 */
export async function loadRouteTranslations(
	locale: string,
	pathname: string,
): Promise<TolgeeStaticData> {
	// The locale layout persists across client-side navigation, so route-scoped
	// payloads leave newly visited pages without translations until a full refresh.
	void pathname;
	return loadNamespaces(locale, ALL_NAMESPACES);
}

// Tolgee's expected translation data type
type TreeTranslationsData = { [key: string]: TreeTranslationsData | string };

export function mergeTreeTranslations(items: readonly TreeTranslationsData[]): TreeTranslationsData {
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

function addNamespaceKeyAliases(
	target: TreeTranslationsData,
	namespace: Namespace,
	data: TreeTranslationsData,
) {
	if (namespace === DEFAULT_NAMESPACE) {
		return;
	}

	for (const [key, value] of Object.entries(data)) {
		target[`${namespace}:${key}`] = value;
	}
}

/**
 * Load and merge all namespaces for a language
 */
async function loadAllNamespacesForLanguage(lang: string): Promise<TreeTranslationsData> {
	const loaded: { ns: Namespace; data: TreeTranslationsData }[] = [];
	for (const ns of ALL_NAMESPACES) {
		const importFn = namespaceImports[ns]?.[lang];
		if (importFn) {
			try {
				const mod = await importFn();
				const data =
					(mod as { default?: TreeTranslationsData }).default || (mod as TreeTranslationsData);
				loaded.push({ ns, data });
			} catch (error) {
				console.warn(`Failed to load namespace ${ns} for ${lang}:`, error);
			}
		}
	}
	const merged = mergeTreeTranslations(loaded.map(({ data }) => data));
	for (const { ns, data } of loaded) {
		addNamespaceKeyAliases(merged, ns, data);
	}
	return merged;
}

export function TolgeeBase() {
	const tolgee = Tolgee().use(FormatIcu());

	// Only load DevTools in development AND on the client side
	// Loading DevTools on server causes hydration mismatch (server adds _tolgee attribute,
	// client adds invisible characters)
	if (isDevelopment && typeof window !== "undefined") {
		tolgee.use(DevTools());
	}

	return tolgee.updateDefaults({
		// NOTE: apiKey/apiUrl intentionally removed from config.
		// When set, Tolgee fetches translations from the API backend which only returns
		// the default namespace, overriding the complete staticData (all namespaces merged).
		// This caused non-default-namespace translations (auth, common, etc.) to be lost.
		// Translations are loaded from local JSON files via staticData instead.
		// DevTools observer still works for highlighting keys without apiKey.

		// Disable invisible character encoding to prevent broken strings in HTML
		observerOptions: {
			fullKeyEncode: false,
		},
		// Lazy load all translations for each language (merged namespaces)
		staticData: {
			en: () => loadAllNamespacesForLanguage("en"),
			de: () => loadAllNamespacesForLanguage("de"),
			fr: () => loadAllNamespacesForLanguage("fr"),
			es: () => loadAllNamespacesForLanguage("es"),
			it: () => loadAllNamespacesForLanguage("it"),
			pt: () => loadAllNamespacesForLanguage("pt"),
		},
	});
}
