import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SkillCatalogManagement } from "@/components/settings/skill-catalog-management";
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
		<div className="space-y-4">
			<Skeleton className="h-8 w-48" />
			<Skeleton className="h-64 w-full" />
		</div>
	);
}

export default function SkillsSettingsPage() {
	return (
		<Suspense fallback={<SkillsSettingsPageLoading />}>
			<SkillsSettingsPageContent />
		</Suspense>
	);
}
