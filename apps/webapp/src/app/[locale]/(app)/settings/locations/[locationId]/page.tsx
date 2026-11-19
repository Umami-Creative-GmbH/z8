import { Suspense } from "react";
import { LocationDetail } from "@/components/settings/location-detail";
import { LocationDetailSkeleton } from "@/components/settings/location-detail-skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

interface LocationDetailPageProps {
	params: Promise<{ locationId: string }>;
}

async function LocationDetailPageContent({ params }: LocationDetailPageProps) {
	const [{ locationId }, settingsRouteContext] = await Promise.all([
		params,
		getCurrentSettingsRouteContext(),
	]);

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		return redirectWithLocale("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		return redirectWithLocale("/settings");
	}

	return (
		<LocationDetail
			locationId={locationId}
			organizationId={organizationId}
			canManageLocations={settingsRouteContext.accessTier === "orgAdmin"}
		/>
	);
}

export default function LocationDetailPage({ params }: LocationDetailPageProps) {
	return (
		<Suspense fallback={<LocationDetailSkeleton />}>
			<LocationDetailPageContent params={params} />
		</Suspense>
	);
}
