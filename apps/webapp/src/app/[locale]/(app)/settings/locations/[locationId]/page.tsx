import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LocationDetail } from "@/components/settings/location-detail";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

interface LocationDetailPageProps {
	params: Promise<{ locationId: string }>;
}

export default async function LocationDetailPage({ params }: LocationDetailPageProps) {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const { locationId } = await params;
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
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
