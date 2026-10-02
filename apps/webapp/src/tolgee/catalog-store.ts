import type { TolgeeStaticData } from "@tolgee/react";
import {
	CATALOG_SOURCE_METADATA,
	type CatalogSlice,
	type CatalogSourceMask,
	canonicalizeNamespaces,
} from "./catalog-slices";
import {
	ALL_NAMESPACES,
	mergeTreeTranslations,
	type Namespace,
	type TolgeeBase,
	type TreeTranslationsData,
} from "./shared";

export type TolgeeInstance = ReturnType<ReturnType<typeof TolgeeBase>["init"]>;
type InstanceCatalog = {
	slice: CatalogSlice;
	applying: number;
	applied: WeakSet<CatalogSlice>;
	/** All identities added by the active application and its nested calls. */
	applicationJournal: CatalogSlice[];
};
// Tolgee's SSR wrapper spreads the instance but retains these methods. Keying by
// the underlying cache method keeps the wrapper and live instance in one store.
const catalogs = new WeakMap<
	TolgeeInstance["addStaticData"],
	InstanceCatalog
>();

function mergePrimary(
	target: TreeTranslationsData,
	source: TreeTranslationsData,
	owners: Record<string, Namespace>,
	incomingOwners: CatalogSlice["keyOwners"],
	path: string[] = [],
) {
	for (const [key, value] of Object.entries(source)) {
		const next = [...path, key];
		if (typeof value === "object") {
			if (typeof target[key] !== "object") target[key] = {};
			mergePrimary(
				target[key] as TreeTranslationsData,
				value,
				owners,
				incomingOwners,
				next,
			);
		} else {
			const encoded = JSON.stringify(next);
			const before = owners[encoded];
			const after = incomingOwners[encoded];
			if (
				before &&
				after &&
				ALL_NAMESPACES.indexOf(before) > ALL_NAMESPACES.indexOf(after)
			)
				continue;
			target[key] = value;
			if (after) owners[encoded] = after;
		}
	}
}

function intrinsicSource(
	tree: TreeTranslationsData,
	mask: CatalogSourceMask,
	namespace: Namespace,
	owners: CatalogSlice["keyOwners"],
	path: string[] = [],
): TreeTranslationsData {
	const source: TreeTranslationsData = {};
	for (const [key, membership] of Object.entries(mask)) {
		const value = tree[key];
		if (value === undefined) continue;
		const next = [...path, key];
		if (membership === 1) {
			const owner = owners[JSON.stringify(next)];
			if (owner && owner !== namespace) continue;
			source[key] = structuredClone(value);
		} else if (typeof value === "object") {
			const projected = intrinsicSource(
				value,
				membership,
				namespace,
				owners,
				next,
			);
			if (Object.keys(projected).length) source[key] = projected;
		}
	}
	return source;
}

export function mergeCatalogRecords(
	current: CatalogSlice,
	incoming: CatalogSlice,
): CatalogSlice {
	if (current.locale !== incoming.locale)
		throw new Error("Cannot merge different catalog locales");
	for (const slice of [current, incoming]) {
		if (
			slice.namespaces.length &&
			!Object.keys(slice.records[slice.locale] ?? {}).length
		)
			throw new Error("Complete catalog namespaces require locale records");
	}
	const locale = current.locale;
	const namespaces = canonicalizeNamespaces([
		...current.namespaces,
		...incoming.namespaces,
	]);
	const owners = { ...current.keyOwners };
	const tree = structuredClone(
		current.records[locale] ?? {},
	) as TreeTranslationsData;
	mergePrimary(
		tree,
		(incoming.records[locale] ?? {}) as TreeTranslationsData,
		owners,
		incoming.keyOwners,
	);
	const metadata = CATALOG_SOURCE_METADATA[locale];
	if (!metadata) throw new Error(`Unsupported catalog locale: ${locale}`);
	// Recover intrinsic contributions, not the already-unioned alias trees. The
	// masks recurse at shared object paths and stop at source-exclusive subtrees.
	// Partial shell leaves participate here without declaring a namespace loaded.
	const sources = ALL_NAMESPACES.map((namespace) => ({
		namespace,
		data: intrinsicSource(tree, metadata.sources[namespace], namespace, owners),
	}));
	// The predecessor intentionally links/mutates source branches during this
	// merge; those source objects then supply the expanded canonical aliases.
	mergeTreeTranslations(sources.map(({ data }) => data));
	for (const { namespace, data } of sources) {
		if (namespace === "common") continue;
		for (const [key, value] of Object.entries(data))
			tree[`${namespace}:${key}`] = value;
	}
	return { locale, namespaces, records: { [locale]: tree }, keyOwners: owners };
}

export function applyCatalogRecords(
	instance: TolgeeInstance,
	incoming: CatalogSlice,
): TolgeeStaticData {
	if (instance.getLanguage() !== incoming.locale)
		throw new Error("Catalog locale does not match Tolgee instance locale");
	let state = catalogs.get(instance.addStaticData);
	if (!state) {
		state = {
			slice: {
				locale: incoming.locale,
				namespaces: [],
				records: { [incoming.locale]: {} },
				keyOwners: {},
			},
			applying: 0,
			applied: new WeakSet(),
			applicationJournal: [],
		};
		catalogs.set(instance.addStaticData, state);
	}
	if (state.applied.has(incoming)) return state.slice.records;
	const merged = mergeCatalogRecords(state.slice, incoming);
	state.applying++;
	// Commit the cumulative dictionary before emitting cache events, so nested
	// feature injections see every earlier contribution.
	const previous = state.slice;
	const previousSdkData = instance.getRecord({
		language: incoming.locale,
	})?.data;
	const checkpoint = state.applicationJournal.length;
	state.slice = merged;
	state.applied.add(incoming);
	state.applicationJournal.push(incoming);
	try {
		instance.addStaticData(merged.records);
	} catch (error) {
		state.slice = previous;
		for (const slice of state.applicationJournal.splice(checkpoint)) {
			state.applied.delete(slice);
		}
		// Tolgee writes its cache before invoking synchronous listeners. A listener
		// can apply another slice successfully, then throw. Restore both dictionaries
		// without invoking that listener again; every rolled-back identity can retry.
		if (
			instance.getRecord({ language: incoming.locale })?.data !==
			previousSdkData
		) {
			instance.setEmitterActive(false);
			try {
				instance.addStaticData(previous.records);
			} finally {
				instance.setEmitterActive(true);
			}
		}
		throw error;
	} finally {
		state.applying--;
		if (state.applying === 0) state.applicationJournal.length = 0;
	}
	return state.slice.records;
}

export function isApplyingCatalogRecords(instance: TolgeeInstance): boolean {
	return (catalogs.get(instance.addStaticData)?.applying ?? 0) > 0;
}

/** Internal immutable snapshot; consumers must never mutate its records or owners. */
export function getCatalogSlice(
	instance: TolgeeInstance,
): CatalogSlice | undefined {
	return catalogs.get(instance.addStaticData)?.slice;
}

export function hasCatalogNamespaces(
	instance: TolgeeInstance,
	namespaces: readonly Namespace[],
): boolean {
	const slice = catalogs.get(instance.addStaticData)?.slice;
	const loaded = new Set(slice?.namespaces);
	return (
		namespaces.length === 0 ||
		Boolean(
			slice &&
				slice.locale === instance.getLanguage() &&
				namespaces.every((namespace) => loaded.has(namespace)),
		)
	);
}
