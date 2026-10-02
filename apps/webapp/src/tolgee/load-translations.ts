import "server-only";
import type { TolgeeStaticData } from "@tolgee/react";
import { cacheLife } from "next/cache";
import {
	CATALOG_SOURCE_METADATA,
	type CatalogSlice,
	canonicalizeNamespaces,
	normalizeCatalogLocale,
} from "./catalog-slices";
import { ALL_NAMESPACES, loadNamespaces, type Namespace } from "./shared";
import { projectShellCatalog } from "./shell-catalog";

export async function loadCompleteServerTranslations(
	locale: string,
): Promise<TolgeeStaticData> {
	return loadCompleteCatalog(normalizeCatalogLocale(locale));
}

async function loadCompleteCatalog(locale: string): Promise<TolgeeStaticData> {
	"use cache";
	cacheLife("max");
	return loadNamespaces(locale, ALL_NAMESPACES, { strict: true });
}

/** Compatibility for server/bot callers; the root is migrated separately. */
export async function loadRouteTranslations(
	locale: string,
): Promise<TolgeeStaticData> {
	return loadCompleteServerTranslations(locale);
}

export async function loadCatalogSlice(
	locale: string,
	namespaces: readonly Namespace[],
): Promise<CatalogSlice> {
	// Validate and canonicalize before entering the persistent cache.
	return loadCanonicalSlice(
		normalizeCatalogLocale(locale),
		canonicalizeNamespaces(namespaces),
	);
}

async function loadCanonicalSlice(
	locale: string,
	namespaces: readonly Namespace[],
): Promise<CatalogSlice> {
	"use cache";
	cacheLife("max");
	const records = await loadNamespaces(locale, namespaces, { strict: true });
	const keyOwners: Record<string, Namespace> = {};
	const selected = new Set(namespaces);
	for (const [path, contributors] of Object.entries(
		CATALOG_SOURCE_METADATA[locale].collisions,
	)) {
		for (const namespace of contributors)
			if (selected.has(namespace)) keyOwners[path] = namespace;
	}
	return { locale, namespaces, records, keyOwners };
}
export async function loadShellTranslations(
	locale: string,
): Promise<CatalogSlice> {
	return loadShellCatalog(normalizeCatalogLocale(locale));
}

async function loadShellCatalog(locale: string): Promise<CatalogSlice> {
	"use cache";
	cacheLife("max");
	return projectShellCatalog(await loadCanonicalSlice(locale, ALL_NAMESPACES));
}
