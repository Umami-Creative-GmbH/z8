import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LocationManagement } from "@/components/settings/location-management";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

async function LocationSettingsPageContent() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}

	const organizationId =
		settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	return (
		<LocationManagement
			organizationId={organizationId}
			canManageLocations={settingsRouteContext.accessTier === "orgAdmin"}
		/>
	);
}

function LocationSettingsPageLoading() {
	return (
		<div className="space-y-4">
			<Skeleton className="h-8 w-48" />
			<Skeleton className="h-64 w-full" />
		</div>
	);
}

export default function LocationSettingsPage() {
	return (
		<Suspense fallback={<LocationSettingsPageLoading />}>
			<LocationSettingsPageContent />
		</Suspense>
	);
}
