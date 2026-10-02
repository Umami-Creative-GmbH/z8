import {
	CATALOG_SOURCE_METADATA,
	type CatalogSlice,
	canonicalizeNamespaces,
	normalizeCatalogLocale,
} from "./catalog-slices";
import { loadNamespaces, type Namespace } from "./shared";

const inFlight = new Map<string, Promise<CatalogSlice>>();

export function loadClientCatalogSlice(
	locale: string,
	namespaces: readonly Namespace[],
): Promise<CatalogSlice> {
	let selected: readonly Namespace[];
	try {
		selected = canonicalizeNamespaces(namespaces);
	} catch (error) {
		return Promise.reject(error);
	}
	const language = normalizeCatalogLocale(locale);
	const selectedSet = new Set(selected);
	const key = JSON.stringify([language, selected]);
	const pending = inFlight.get(key);
	if (pending) return pending;
	const request = loadNamespaces(language, selected, { strict: true })
		.then((records) => {
			const keyOwners: Record<string, Namespace> = {};
			for (const [path, contributors] of Object.entries(
				CATALOG_SOURCE_METADATA[language].collisions,
			)) {
				for (const namespace of contributors)
					if (selectedSet.has(namespace)) keyOwners[path] = namespace;
			}
			return { locale: language, namespaces: selected, records, keyOwners };
		})
		.finally(() => {
			inFlight.delete(key);
		});
	inFlight.set(key, request);
	return request;
}
