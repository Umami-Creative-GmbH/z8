import type { TolgeeStaticData } from "@tolgee/react";
import {
	ALL_LANGUAGES,
	ALL_NAMESPACES,
	DEFAULT_LANGUAGE,
	type Namespace,
} from "./shared";

export type CatalogSlice = {
	locale: string;
	/** Complete namespace loads only. A partial shell projection has no loaded namespaces. */
	namespaces: readonly Namespace[];
	records: TolgeeStaticData;
	/** Only colliding primary leaves, keyed by JSON-encoded path segments (never dotted paths). */
	keyOwners: Readonly<Record<string, Namespace>>;
};

export function normalizeCatalogLocale(locale: string): string {
	return ALL_LANGUAGES.includes(locale) ? locale : DEFAULT_LANGUAGE;
}

export function canonicalizeNamespaces(
	namespaces: readonly Namespace[],
): readonly Namespace[] {
	for (const namespace of namespaces) {
		if (!ALL_NAMESPACES.includes(namespace)) {
			throw new Error(`Unsupported translation namespace: ${namespace}`);
		}
	}
	const selected = new Set(namespaces);
	// The cache identity and merge order both follow the predecessor's explicit priority.
	return ALL_NAMESPACES.filter((namespace) => selected.has(namespace));
}
