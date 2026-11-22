import {
	type FeatureFlagState,
	getResolvedSettingsVisibility,
} from "@/components/settings/settings-config";
import type { SettingsAccess } from "@/lib/organization-action/settings-access-level";
import type { SettingsCapabilities } from "@/lib/settings/capabilities";
import type { GoLiveFixLinkResolver } from "./types";

/**
 * Fix links gated by the settings visibility the viewer already gets: a link
 * is offered only for a settings entry the viewer's settings access, capabilities,
 * billing and feature flags show. A detail page (`/settings/teams/<id>`) is gated
 * by its entry. No second permission model.
 */
export function goLiveFixLinks(input: {
	settingsAccess: SettingsAccess | null;
	billingEnabled?: boolean;
	featureFlags: FeatureFlagState;
	settingsCapabilities?: Partial<SettingsCapabilities>;
}): GoLiveFixLinkResolver {
	const visibleHrefs = getResolvedSettingsVisibility(input).visibleSettings.map(
		(entry) => entry.href,
	);
	return (href, label) => {
		const path = href.split(/[?#]/, 1)[0] ?? href;
		return visibleHrefs.some((entry) => path === entry || path.startsWith(`${entry}/`))
			? { href, label }
			: null;
	};
}
