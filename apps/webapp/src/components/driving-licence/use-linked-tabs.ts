"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

// Module-level so the default parameter is an identifier: React Compiler cannot lower an inline
// arrow-function default.
function tabValue(tab: string) {
	return tab;
}

/**
 * Tabs whose selection is linkable through `?tab=` (replaced in place, no navigation), with
 * panels that mount on first visit and then stay mounted so unsaved input survives switching.
 * An unknown or unavailable `?tab=` falls back to the first tab.
 */
export function useLinkedTabs<Tab extends string>(
	tabs: readonly Tab[],
	param: (tab: Tab) => string = tabValue,
) {
	const searchParams = useSearchParams();
	const requested = searchParams.get("tab");
	const active = tabs.find((tab) => param(tab) === requested) ?? tabs[0];
	const [visited, setVisited] = useState(() => new Set<Tab>(active ? [active] : []));

	function select(value: unknown) {
		const selected = tabs.find((tab) => tab === value);
		if (!selected) return;
		setVisited((previous) => new Set([...previous, active, selected]));
		const url = new URL(window.location.href);
		url.searchParams.set("tab", param(selected));
		window.history.replaceState(null, "", url.pathname + url.search + url.hash);
	}

	return {
		active,
		select,
		/** Whether a panel has been shown, so it renders (and keeps its state) from then on. */
		mounted: (tab: Tab) => tab === active || visited.has(tab),
	};
}
