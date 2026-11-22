import { Suspense } from "react";
import { LocationManagement } from "@/components/settings/location-management";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";

async function LocationSettingsPageContent() {
	const caller = await getCurrentSettingsAccess();

	if (!caller?.settingsAccess || !meetsSettingsAccess(caller.settingsAccess, "scopedManager")) {
		return redirectWithLocale("/settings");
	}

	return (
		<LocationManagement
			organizationId={caller.organizationId}
			canManageLocations={meetsSettingsAccess(caller.settingsAccess, "orgAdmin")}
		/>
	);
}

function LocationSettingsPageLoading() {
	return (
		<LoadingRegion
			className="page-frame flex flex-1 flex-col gap-4"
			role="status"
			label={{
				labelKey: "common.loadingRegions.locationSettings",
				labelDefault: "Loading location settings",
			}}
		>
			<div className="space-y-2">
				<Skeleton className="h-8 w-48" aria-hidden="true" />
				<Skeleton className="h-5 w-full max-w-sm" aria-hidden="true" />
			</div>
			<Skeleton className="h-64 w-full" aria-hidden="true" />
		</LoadingRegion>
	);
}

export default function LocationSettingsPage() {
	return (
		<Suspense fallback={<LocationSettingsPageLoading />}>
			<LocationSettingsPageContent />
		</Suspense>
	);
}
