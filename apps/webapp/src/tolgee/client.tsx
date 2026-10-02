"use client";

import {
	TolgeeProvider,
	type TolgeeStaticData,
	useTolgee,
} from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
	CATALOG_SOURCE_METADATA,
	type CatalogSlice,
	normalizeCatalogLocale,
} from "./catalog-slices";
import {
	applyCatalogRecords,
	hasCatalogNamespaces,
	isApplyingCatalogRecords,
	type TolgeeInstance,
} from "./catalog-store";
import { loadClientCatalogSlice } from "./client-catalog-loader";
import { type Namespace, TolgeeBase } from "./shared";

type Props = {
	language: string;
	staticData: TolgeeStaticData;
	children: React.ReactNode;
};
const tolgeeCache = new Map<string, TolgeeInstance>();

function createTolgee(language: string) {
	return TolgeeBase({ loadAllLanguageCatalogs: false }).init({
		language,
		staticData: { [language]: {} },
	});
}
function getOrCreateTolgee(language: string) {
	// Every server render owns its mutable instance. Only the browser retains it.
	if (typeof window === "undefined") return createTolgee(language);
	let instance = tolgeeCache.get(language);
	if (!instance) {
		instance = createTolgee(language);
		tolgeeCache.set(language, instance);
	}
	return instance;
}

function transitionalSlice(
	locale: string,
	records: TolgeeStaticData,
): CatalogSlice {
	const keyOwners: Record<string, Namespace> = {};
	const tree = records[locale];
	const read = (path: string[]) =>
		path.reduce<unknown>(
			(value, key) =>
				value && typeof value === "object"
					? (value as Record<string, unknown>)[key]
					: undefined,
			tree,
		);
	for (const [encoded, contributors] of Object.entries(
		CATALOG_SOURCE_METADATA[locale].collisions,
	)) {
		const path = JSON.parse(encoded) as string[];
		const value = read(path);
		if (typeof value !== "string") continue;
		for (const namespace of contributors) {
			const alias =
				namespace === "common"
					? path
					: [`${namespace}:${path[0]}`, ...path.slice(1)];
			if (read(alias) === value) keyOwners[encoded] = namespace;
		}
	}
	return { locale, namespaces: [], records, keyOwners };
}

function applyForRender(tolgee: TolgeeInstance, incoming: CatalogSlice) {
	tolgee.setEmitterActive(false);
	try {
		return applyCatalogRecords(tolgee, incoming);
	} finally {
		tolgee.setEmitterActive(true);
	}
}

export const TolgeeNextProvider = ({
	language,
	staticData,
	children,
}: Props) => {
	const { refresh } = useRouter();
	const locale = normalizeCatalogLocale(language);
	const tolgee = useMemo(() => getOrCreateTolgee(locale), [locale]);
	// Transitional root props still carry the complete dictionary. Task 4 supplies
	// explicit slices; presence of these records alone does not assert readiness.
	const incoming = useMemo(
		() => transitionalSlice(locale, staticData),
		[locale, staticData],
	);
	const records = useMemo(
		() => applyForRender(tolgee, incoming),
		[tolgee, incoming],
	);
	useEffect(() => {
		const subscription = tolgee.on("permanentChange", () => {
			if (!isApplyingCatalogRecords(tolgee)) refresh();
		});
		return () => subscription.unsubscribe();
	}, [refresh, tolgee]);
	return (
		<TolgeeProvider
			key={locale}
			ssr={{ language: locale, staticData: records }}
			tolgee={tolgee}
		>
			{children}
		</TolgeeProvider>
	);
};

/** Acquire only the requested catalogs; expose readiness after cumulative injection. */
export function useNamespaces(namespaces: Namespace[]): {
	isLoading: boolean;
	isLoaded: boolean;
} {
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() ?? "en";
	const namespaceKey = JSON.stringify([...new Set(namespaces)].sort());
	const requestKey = JSON.stringify([locale, namespaceKey]);
	const [loadState, setLoadState] = useState({
		key: requestKey,
		settled: false,
	});
	if (loadState.key !== requestKey)
		setLoadState({ key: requestKey, settled: false });
	const loaded = hasCatalogNamespaces(tolgee, namespaces);
	useEffect(() => {
		let cancelled = false;
		const requested = JSON.parse(namespaceKey) as Namespace[];
		if (hasCatalogNamespaces(tolgee, requested)) return;
		void loadClientCatalogSlice(locale, requested)
			.then((slice) => {
				if (cancelled || tolgee.getLanguage() !== locale) return;
				applyCatalogRecords(tolgee, slice);
				setLoadState({ key: requestKey, settled: true });
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				console.warn("Failed to load namespaces:", requested, error);
				setLoadState({ key: requestKey, settled: true });
			});
		return () => {
			cancelled = true;
		};
	}, [locale, namespaceKey, requestKey, tolgee]);
	return {
		isLoading: !loaded && (loadState.key !== requestKey || !loadState.settled),
		isLoaded: loaded,
	};
}
