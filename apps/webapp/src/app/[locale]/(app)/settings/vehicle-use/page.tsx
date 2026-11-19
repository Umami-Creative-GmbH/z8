import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function VehicleUseSettingsPageContent() {
	await requireOrgAdminSettingsAccess();
	return redirectWithLocale("/settings/vehicles?tab=use");
}

/** This route redirects to the Vehicles use tab; load in that page's measured frame. */
function VehicleUseSettingsPageLoading() {
	return (
		<SettingsPageSkeleton
			measure
			label={{
				labelKey: "settings.loading",
				labelDefault: "Loading settings",
			}}
		/>
	);
}

export default function VehicleUseSettingsPage() {
	return (
		<Suspense fallback={<VehicleUseSettingsPageLoading />}>
			<VehicleUseSettingsPageContent />
		</Suspense>
	);
}
