import { Suspense } from "react";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { PermissionsPageClient } from "./permissions-page-client";

async function PermissionsPageContent() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		return redirectWithLocale("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		return redirectWithLocale("/settings");
	}

	return (
		<PermissionsPageClient
			organizationId={organizationId}
			isOrgAdmin={settingsRouteContext.accessTier === "orgAdmin"}
		/>
	);
}

function PermissionsPageLoading() {
	return (
		<LoadingRegion
			className="page-frame flex flex-1 flex-col gap-6"
			label={{ labelKey: "settings.loading", labelDefault: "Loading settings" }}
		>
			<div className="space-y-2">
				<Skeleton aria-hidden="true" className="h-8 w-56 max-w-full sm:h-9" />
				<Skeleton aria-hidden="true" className="h-5 w-72 max-w-full" />
			</div>
			<Skeleton aria-hidden="true" className="h-[420px] w-full" />
		</LoadingRegion>
	);
}

export default function PermissionsPage() {
	return (
		<Suspense fallback={<PermissionsPageLoading />}>
			<PermissionsPageContent />
		</Suspense>
	);
}
