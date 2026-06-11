import { FormatIcu } from "@tolgee/format-icu";
import type { TolgeeStaticData } from "@tolgee/react";
import { DevTools, Tolgee } from "@tolgee/web";

const isDevelopment = process.env.NODE_ENV === "development";

export const ALL_LANGUAGES = ["en", "de", "fr", "es", "it", "pt", "el", "pl", "tr", "gsw"];

export const DEFAULT_LANGUAGE = "en";

// All available namespaces - must match the namespace directory structure
export const ALL_NAMESPACES = [
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
	"/payroll": ["common", "payroll"],
	// Main app routes
	"/": ["common", "dashboard"],
	"/analytics": ["common", "analytics"],
	"/calendar": ["common", "calendar"],
	"/absences": ["common", "calendar"],
	"/time-tracking": ["common", "timeTracking", "compliance"],
	"/travel-expenses": ["common", "travelExpenses"],
	"/reports": ["common", "reports"],
	"/team": ["common", "team"],
	"/today": ["common", "today"],
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
const namespaceImports: Record<
	Namespace,
	Record<string, () => Promise<unknown>>
> = Object.fromEntries(
	ALL_NAMESPACES.map((namespace) => [
		namespace,
		Object.fromEntries(
			ALL_LANGUAGES.map((language) => [
				language,
				() => import(`../../messages/${namespace}/${language}.json`),
			]),
		),
	]),
) as Record<Namespace, Record<string, () => Promise<unknown>>>;

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
	const loadPromises = namespaces.map((ns) => {
		const importFn = namespaceImports[ns]?.[lang];
		if (importFn) {
			return importFn()
				.then((mod) => {
					const data =
						(mod as { default?: TreeTranslationsData }).default || (mod as TreeTranslationsData);
					return { ns, data };
				})
				.catch((error) => {
					console.warn(`Failed to load namespace ${ns} for ${lang}:`, error);
					return { ns, data: {} as TreeTranslationsData };
				});
		}
		return Promise.resolve({ ns, data: {} as TreeTranslationsData });
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
	const loaded = (
		await Promise.all(
			ALL_NAMESPACES.map(async (ns) => {
				const importFn = namespaceImports[ns]?.[lang];
				if (!importFn) {
					return null;
				}

				try {
					const mod = await importFn();
					const data =
						(mod as { default?: TreeTranslationsData }).default || (mod as TreeTranslationsData);
					return { ns, data };
				} catch (error) {
					console.warn(`Failed to load namespace ${ns} for ${lang}:`, error);
					return null;
				}
			}),
		)
	).filter((namespace): namespace is { ns: Namespace; data: TreeTranslationsData } =>
		Boolean(namespace),
	);
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
		staticData: Object.fromEntries(
			ALL_LANGUAGES.map((language) => [language, () => loadAllNamespacesForLanguage(language)]),
		),
	});
}
