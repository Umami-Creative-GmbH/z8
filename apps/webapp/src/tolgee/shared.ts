import type { TolgeeStaticData } from "@tolgee/react";
import {
	ALL_LANGUAGES,
	type AppNamespace,
	APP_NAMESPACES,
	CATALOG_NAMESPACES,
	DEFAULT_LANGUAGE,
	mergeTreeTranslations,
	type Namespace,
	type TreeTranslationsData,
} from "./catalog-config";
import { createTolgee } from "./tolgee-core";

// Server-side catalog loading. Client code imports `./catalog-config` and `./tolgee-core`
// directly; importing this module puts the import map over every `messages/` file in
// the client bundle (guarded by `client-imports.test.ts`).
export * from "./catalog-config";

/**
 * Dynamic import functions for each namespace and language.
 * Tolgee CLI owns the generated JSON files after this manual split.
 */
const namespaceImports: Record<
	Namespace,
	Record<string, () => Promise<unknown>>
> = Object.fromEntries(
	CATALOG_NAMESPACES.map((namespace) => {
		const settingsNamespace = namespace.startsWith("settings/")
			? namespace.slice("settings/".length)
			: null;

		return [
			namespace,
			Object.fromEntries(
				ALL_LANGUAGES.map((language) => [
					language,
					settingsNamespace
						? () =>
								import(
									`../../messages/settings/${settingsNamespace}/${language}.json`
								)
						: () => import(`../../messages/${namespace}/${language}.json`),
				]),
			),
		];
	}),
) as Record<Namespace, Record<string, () => Promise<unknown>>>;

export type LoadNamespacesOptions = {
	strict?: boolean;
};

export async function loadNamespaceImport(
	ns: Namespace,
	lang: string,
	importFn: () => Promise<unknown>,
	options: LoadNamespacesOptions = {},
): Promise<{ ns: Namespace; data: TreeTranslationsData }> {
	try {
		const mod = await importFn();
		const data =
			(mod as { default?: TreeTranslationsData }).default ||
			(mod as TreeTranslationsData);
		// Merging shares branches within one load, including its aliases.
		// Keep those branches separate from the cached imported JSON module.
		return { ns, data: structuredClone(data) };
	} catch (error) {
		if (options.strict) {
			throw error;
		}

		console.warn(`Failed to load namespace ${ns} for ${lang}:`, error);
		return { ns, data: {} };
	}
}

/**
 * Load specific namespaces for SSR
 * Merges all namespace translations into a single object keyed by locale.
 * This allows t("auth.login") to work without specifying namespace.
 */
export async function loadNamespaces(
	locale: string,
	namespaces: readonly Namespace[],
	options: LoadNamespacesOptions = {},
): Promise<TolgeeStaticData> {
	const lang = ALL_LANGUAGES.includes(locale) ? locale : DEFAULT_LANGUAGE;

	// Load all requested namespaces in parallel
	const loadPromises = namespaces.map((ns) => {
		const importFn = namespaceImports[ns]?.[lang];
		if (importFn) {
			return loadNamespaceImport(ns, lang, importFn, options);
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

// Every namespace, including the default one, needs its `ns:` aliases: the extractor strips the
// prefix from `t("common:user.theme-toggle")`, but Tolgee looks the key up literally (#976).
// Aliases reuse the primary subtrees, so RSC serializes them as references.
function addNamespaceKeyAliases(
	target: TreeTranslationsData,
	namespace: Namespace,
	data: TreeTranslationsData,
) {
	for (const [key, value] of Object.entries(data)) {
		target[`${namespace}:${key}`] = value;
	}
}

/**
 * Load and merge the app's namespaces for a language (never the mailer's)
 */
async function loadAllNamespacesForLanguage(
	lang: string,
): Promise<TreeTranslationsData> {
	const loaded = (
		await Promise.all(
			APP_NAMESPACES.map(async (ns) => {
				const importFn = namespaceImports[ns]?.[lang];
				if (!importFn) {
					return null;
				}

				try {
					const mod = await importFn();
					const data =
						(mod as { default?: TreeTranslationsData }).default ||
						(mod as TreeTranslationsData);
					return { ns, data: structuredClone(data) };
				} catch (error) {
					console.warn(`Failed to load namespace ${ns} for ${lang}:`, error);
					return null;
				}
			}),
		)
	).filter(
		(
			namespace,
		): namespace is { ns: AppNamespace; data: TreeTranslationsData } =>
			Boolean(namespace),
	);
	const merged = mergeTreeTranslations(loaded.map(({ data }) => data));
	for (const { ns, data } of loaded) {
		addNamespaceKeyAliases(merged, ns, data);
	}
	return merged;
}

export function TolgeeBase(
	options: { loadAllLanguageCatalogs?: boolean } = {},
) {
	const tolgee = createTolgee();

	// DevTools' observer adds invisible characters once the provider mounts.
	// Suspense children can hydrate later, so even its SSR adapter's first-render
	// protection cannot keep those labels consistent with the server markup.

	return tolgee.updateDefaults({
		// NOTE: apiKey/apiUrl intentionally removed from config.
		// When set, Tolgee fetches translations from the API backend which only returns
		// the default namespace, overriding the complete staticData (all namespaces merged).
		// This caused non-default-namespace translations (auth, common, etc.) to be lost.
		// Translations are loaded from local JSON files via staticData instead.
		// Server/bot callers retain complete fallback; provider instances disable it.
		staticData:
			options.loadAllLanguageCatalogs === false
				? {}
				: Object.fromEntries(
						ALL_LANGUAGES.map((language) => [
							language,
							() => loadAllNamespacesForLanguage(language),
						]),
					),
	});
}
