import { Suspense } from "react";
import { LocationDetail } from "@/components/settings/location-detail";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
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

function LocationDetailPageLoading() {
	return (
		<LoadingRegion
			className="page-frame flex flex-1 flex-col gap-6"
			label={{
				labelKey: "common.loadingRegions.locationSettings",
				labelDefault: "Loading location settings",
			}}
		>
			<div className="space-y-2">
				<Skeleton className="h-5 w-36" aria-hidden="true" />
				<Skeleton className="h-8 w-56" aria-hidden="true" />
				<Skeleton className="h-5 w-full max-w-sm" aria-hidden="true" />
			</div>
			<div className="grid gap-4 lg:grid-cols-2">
				<Skeleton className="h-64" aria-hidden="true" />
				<Skeleton className="h-64" aria-hidden="true" />
			</div>
		</LoadingRegion>
	);
}

export default function LocationDetailPage({ params }: LocationDetailPageProps) {
	return (
		<Suspense fallback={<LocationDetailPageLoading />}>
			<LocationDetailPageContent params={params} />
		</Suspense>
	);
}
