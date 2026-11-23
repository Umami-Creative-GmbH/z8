import { Suspense } from "react";
import { LocationDetail } from "@/components/settings/location-detail";
import { LocationDetailSkeleton } from "@/components/settings/location-detail-skeleton";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";

interface LocationDetailPageProps {
	params: Promise<{ locationId: string }>;
}

async function LocationDetailPageContent({ params }: LocationDetailPageProps) {
	const [{ locationId }, caller] = await Promise.all([params, getCurrentSettingsAccess()]);

	if (!caller?.settingsAccess || !meetsSettingsAccess(caller.settingsAccess, "scopedManager")) {
		return redirectWithLocale("/settings");
	}

	return (
		<LocationDetail
			locationId={locationId}
			organizationId={caller.organizationId}
			canManageLocations={meetsSettingsAccess(caller.settingsAccess, "orgAdmin")}
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
