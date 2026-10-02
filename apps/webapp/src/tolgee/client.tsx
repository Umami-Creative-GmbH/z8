"use client";

import { TolgeeProvider, useTolgee } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { type CatalogSlice, normalizeCatalogLocale } from "./catalog-slices";
import {
	applyCatalogRecords,
	hasCatalogNamespaces,
	isApplyingCatalogRecords,
	type TolgeeInstance,
} from "./catalog-store";
import { loadClientCatalogSlice } from "./client-catalog-loader";
import {
	FeatureCatalogContext,
	prepareCatalogForRender,
} from "./feature-provider";
import { type Namespace, TolgeeBase } from "./shared";

type Props = {
	slice: CatalogSlice;
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

export const TolgeeNextProvider = ({ slice, children }: Props) => {
	const { refresh } = useRouter();
	const locale = normalizeCatalogLocale(slice.locale);
	const tolgee = useMemo(() => getOrCreateTolgee(locale), [locale]);
	const cumulative = prepareCatalogForRender(tolgee, slice);
	useEffect(() => {
		const subscription = tolgee.on("permanentChange", () => {
			if (!isApplyingCatalogRecords(tolgee)) refresh();
		});
		return () => subscription.unsubscribe();
	}, [refresh, tolgee]);
	return (
		<FeatureCatalogContext.Provider
			value={{ locale, tolgee, slice: cumulative }}
		>
			<TolgeeProvider
				key={locale}
				ssr={{ language: locale, staticData: cumulative.records }}
				tolgee={tolgee}
			>
				{children}
			</TolgeeProvider>
		</FeatureCatalogContext.Provider>
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
