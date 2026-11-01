import {
	type FeatureFlagState,
	getResolvedSettingsVisibility,
} from "@/components/settings/settings-config";
import type { SettingsAccessTier } from "@/lib/settings-access";
import type { GoLiveFixLinkResolver } from "./types";

/**
 * Fix links gated by the settings visibility the viewer already gets: a link
 * is offered only for a settings entry the viewer's tier, billing and feature
 * flags show. No second permission model.
 */
export function goLiveFixLinks(input: {
	accessTier: SettingsAccessTier;
	billingEnabled?: boolean;
	featureFlags: FeatureFlagState;
}): GoLiveFixLinkResolver {
	const visibleHrefs = new Set(
		getResolvedSettingsVisibility(input).visibleSettings.map((entry) => entry.href),
	);
	return (href, label) => {
		const path = href.split(/[?#]/, 1)[0] ?? href;
		return visibleHrefs.has(path) ? { href, label } : null;
	};
}
