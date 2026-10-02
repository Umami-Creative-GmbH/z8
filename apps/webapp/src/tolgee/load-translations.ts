import "server-only";
import type { TolgeeStaticData } from "@tolgee/react";
import { cacheLife } from "next/cache";
import {
	type CatalogSlice,
	canonicalizeNamespaces,
	normalizeCatalogLocale,
} from "./catalog-slices";
import {
	ALL_NAMESPACES,
	loadNamespaces,
	type Namespace,
	type TreeTranslationsData,
} from "./shared";
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
	const [records, index] = await Promise.all([
		loadNamespaces(locale, namespaces, { strict: true }),
		loadCollisionIndex(locale),
	]);
	const keyOwners: Record<string, Namespace> = {};
	for (const namespace of namespaces) {
		for (const path of index[namespace]) keyOwners[path] = namespace;
	}
	return { locale, namespaces, records, keyOwners };
}

// Transitional server-only discovery. The browser loader uses the generated collision
// registry added with selective client delivery. Only public, code-owned catalogs enter
// this cache; collisions are global even when a slice loads just one contributor.
async function loadCollisionIndex(
	locale: string,
): Promise<Record<Namespace, string[]>> {
	"use cache";
	cacheLife("max");
	const counts = new Map<string, number>();
	const entries = await Promise.all(
		ALL_NAMESPACES.map(async (namespace) => {
			const records = await loadNamespaces(locale, [namespace], {
				strict: true,
			});
			const tree = records[locale] as TreeTranslationsData;
			const paths: string[] = [];
			function visit(value: TreeTranslationsData | string, path: string[]) {
				if (typeof value === "string") {
					paths.push(JSON.stringify(path));
					return;
				}
				for (const [key, child] of Object.entries(value))
					visit(child, [...path, key]);
			}
			for (const [key, value] of Object.entries(tree)) {
				if (!key.startsWith(`${namespace}:`)) visit(value, [key]);
			}
			for (const path of paths) counts.set(path, (counts.get(path) ?? 0) + 1);
			return [namespace, paths] as const;
		}),
	);
	return Object.fromEntries(
		entries.map(([namespace, paths]) => [
			namespace,
			paths.filter((path) => (counts.get(path) ?? 0) > 1),
		]),
	) as Record<Namespace, string[]>;
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
