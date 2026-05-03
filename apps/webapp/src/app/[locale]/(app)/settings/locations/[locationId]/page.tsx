import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LocationDetail } from "@/components/settings/location-detail";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { canResolvedTierAccessRoute } from "@/lib/settings-access";

const SETTINGS_ROUTE = "/settings/locations";

interface LocationDetailPageProps {
	params: Promise<{ locationId: string }>;
}

export default async function LocationDetailPage({ params }: LocationDetailPageProps) {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const { locationId } = await params;
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (
		!settingsRouteContext ||
		!canResolvedTierAccessRoute(settingsRouteContext.accessTier, SETTINGS_ROUTE)
	) {
		redirect("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	return (
		<LocationDetail
			locationId={locationId}
			organizationId={organizationId}
			canManageLocations={settingsRouteContext.accessTier === "orgAdmin"}
		/>
	);
}
