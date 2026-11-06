"use client";

import { useSearchParams } from "next/navigation";
import {
	type OrgExplorerUrlState,
	orgExplorerSearch,
	parseOrgExplorerUrlState,
} from "./org-explorer-url";

/**
 * The view, team filter and selected person, read from the URL. Changes push a
 * history entry without a navigation, so links share the state and the back
 * button restores it; Next keeps `useSearchParams` in step.
 */
export function useOrgExplorerUrlState() {
	const state = parseOrgExplorerUrlState(useSearchParams());

	function update(change: Partial<OrgExplorerUrlState>) {
		const url = new URL(window.location.href);
		const current = parseOrgExplorerUrlState(url.searchParams);
		const search = orgExplorerSearch(
			{ ...current, ...change },
			url.searchParams,
		);
		if (search === url.search) return;
		window.history.pushState(null, "", url.pathname + search + url.hash);
	}

	return [state, update] as const;
}
