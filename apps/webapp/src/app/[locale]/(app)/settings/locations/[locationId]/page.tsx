import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { LocationDetail } from "@/components/settings/location-detail";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

interface LocationDetailPageProps {
	params: Promise<{ locationId: string }>;
}

async function LocationDetailPageContent({ params }: LocationDetailPageProps) {
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

function LocationDetailPageLoading() {
	return (
		<div className="p-6">
			<div className="mx-auto max-w-4xl space-y-4">
				<Skeleton className="h-8 w-56" />
				<Skeleton className="h-5 w-80" />
				<Skeleton className="h-[420px] w-full" />
			</div>
		</div>
	);
}

export default function LocationDetailPage({ params }: LocationDetailPageProps) {
	return (
		<Suspense fallback={<LocationDetailPageLoading />}>
			<LocationDetailPageContent params={params} />
		</Suspense>
	);
}
