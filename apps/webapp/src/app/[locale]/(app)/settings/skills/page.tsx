import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SkillCatalogManagement } from "@/components/settings/skill-catalog-management";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

async function SkillsSettingsPageContent() {
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
		<SkillCatalogManagement
			organizationId={organizationId}
			canManageCatalog={settingsRouteContext.accessTier === "orgAdmin"}
		/>
	);
}

function SkillsSettingsPageLoading() {
	return (
		<LoadingRegion
			className="flex flex-1 flex-col gap-4 p-4"
			role="status"
			label={{
				labelKey: "common.loadingRegions.skillSettings",
				labelDefault: "Loading skill settings",
			}}
		>
			<Skeleton className="h-8 w-48" aria-hidden="true" />
			<Skeleton className="h-64 w-full" aria-hidden="true" />
		</LoadingRegion>
	);
}

export default function SkillsSettingsPage() {
	return (
		<Suspense fallback={<SkillsSettingsPageLoading />}>
			<SkillsSettingsPageContent />
		</Suspense>
	);
}
