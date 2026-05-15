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
	"settings",
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
	"/platform-admin/worker-queue": ["common", "admin", "settings"],
	"/setup": ["common", "setup"],
	"/init": ["common", "setup"],
	"/approvals": ["common", "approvals"],
	"/my-requests": ["common", "myRequests"],
	// Main app routes
	"/": ["common", "dashboard"],
	"/calendar": ["common", "calendar"],
	"/absences": ["common", "calendar"],
	"/time-tracking": ["common", "timeTracking", "compliance"],
	"/travel-expenses": ["common", "settings"],
	"/travel-expenses/approvals": ["common", "settings", "approvals"],
	"/reports": ["common", "reports"],
	"/team": ["common", "settings"],
	"/scheduling": ["common", "scheduling", "compliance"],
	"/settings": ["common", "settings"],
	"/settings/compliance": ["common", "settings", "compliance"],
	"/settings/webhooks": ["common", "settings"],
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
 * Dynamic import functions for each namespace and language
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
	settings: {
		en: () => import("../../messages/settings/en.json"),
		de: () => import("../../messages/settings/de.json"),
		fr: () => import("../../messages/settings/fr.json"),
		es: () => import("../../messages/settings/es.json"),
		it: () => import("../../messages/settings/it.json"),
		pt: () => import("../../messages/settings/pt.json"),
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
	namespaces: Namespace[],
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
	const merged: TreeTranslationsData = {};
	for (const { ns, data } of loaded) {
		Object.assign(merged, data);
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
	const merged: TreeTranslationsData = {};
	for (const ns of ALL_NAMESPACES) {
		const importFn = namespaceImports[ns]?.[lang];
		if (importFn) {
			try {
				const mod = await importFn();
				const data =
					(mod as { default?: TreeTranslationsData }).default || (mod as TreeTranslationsData);
				Object.assign(merged, data);
				addNamespaceKeyAliases(merged, ns, data);
			} catch (error) {
				console.warn(`Failed to load namespace ${ns} for ${lang}:`, error);
			}
		}
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
