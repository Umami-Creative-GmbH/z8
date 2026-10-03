"use client";

import { TolgeeProvider } from "@tolgee/react";
import { createContext, type ReactNode, useContext } from "react";
import type { CatalogSlice } from "./catalog-slices";
import {
	applyCatalogRecords,
	getCatalogSlice,
	type TolgeeInstance,
} from "./catalog-store";

export const FeatureCatalogContext = createContext<{
	locale: string;
	tolgee: TolgeeInstance;
	slice: CatalogSlice;
} | null>(null);

/** Read the cumulative snapshot on every render, including after lazy siblings.
 * Tolgee's SSR adapter also prepares records synchronously with emission muted.
 */
export function prepareCatalogForRender(
	tolgee: TolgeeInstance,
	slice: CatalogSlice,
): CatalogSlice {
	tolgee.setEmitterActive(false);
	try {
		applyCatalogRecords(tolgee, slice);
		const cumulative = getCatalogSlice(tolgee);
		if (!cumulative)
			throw new Error("Catalog application did not create a snapshot");
		return cumulative;
	} finally {
		tolgee.setEmitterActive(true);
	}
}

export function FeatureTranslationProvider({
	slice,
	children,
}: {
	slice: CatalogSlice;
	children: ReactNode;
}) {
	const root = useContext(FeatureCatalogContext);
	if (!root)
		throw new Error(
			"Feature translations require the root translation provider",
		);
	// A streamed old route must never change the destination instance's language.
	if (slice.locale !== root.locale) return null;
	const cumulative = prepareCatalogForRender(root.tolgee, slice);
	return (
		<FeatureCatalogContext.Provider value={{ ...root, slice: cumulative }}>
			<TolgeeProvider
				tolgee={root.tolgee}
				ssr={{ language: root.locale, staticData: cumulative.records }}
			>
				{children}
			</TolgeeProvider>
		</FeatureCatalogContext.Provider>
	);
}
