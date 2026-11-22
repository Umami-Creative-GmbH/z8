import { Suspense } from "react";
import {
	canReachFeatureSwitches,
	getResolvedSettingsVisibility,
} from "@/components/settings/settings-config";
import { SettingsGrid } from "@/components/settings/settings-grid";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";
import { env } from "@/env";
import {
	getRenderAuthContext,
	getRenderOrganizationSettings,
	getRenderSettingsAccess,
} from "@/lib/auth/render-context";
import { requireUser } from "@/lib/auth-helpers";
import { getRenderSettingsCapabilities } from "@/lib/settings/capabilities.server";

export default function SettingsPage() {
	return (
		<Suspense fallback={<SettingsContentLoading />}>
			<SettingsPageContent />
		</Suspense>
	);
}

async function SettingsPageContent() {
	const authContext = await getRenderAuthContext();

	if (!authContext) {
		await requireUser();
	}

	const [settingsAccess, settingsCapabilities, orgSettings] = await Promise.all([
		getRenderSettingsAccess(),
		getRenderSettingsCapabilities(),
		getRenderOrganizationSettings(),
	]);

	const billingEnabled = env.BILLING_ENABLED === "true";
	const { visibleSettings, visibleGroups } = getResolvedSettingsVisibility({
		settingsAccess,
		billingEnabled,
		featureFlags: orgSettings ?? undefined,
		settingsCapabilities,
	});

	return (
		<div className="page-frame flex-1">
			<div className="page-measure">
				<SettingsGrid
					visibleSettings={visibleSettings}
					visibleGroups={visibleGroups}
					canChangeFeatures={canReachFeatureSwitches(settingsAccess)}
					settingsCapabilities={settingsCapabilities}
				/>
			</div>
		</div>
	);
}
