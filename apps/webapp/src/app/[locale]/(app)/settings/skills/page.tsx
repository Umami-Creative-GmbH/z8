import { Suspense } from "react";
import { SkillCatalogManagement } from "@/components/settings/skill-catalog-management";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { loadSkillReminderLeadDays } from "@/lib/scheduling/skill-reminder-store";

async function SkillsSettingsPageContent() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		return redirectWithLocale("/settings");
	}

	const organizationId =
		settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		return redirectWithLocale("/settings");
	}

	const canManageCatalog = settingsRouteContext.accessTier === "orgAdmin";
	// Owners and admins edit the skill reminder lead time next to the catalog (#1143).
	const reminderLeadDays = canManageCatalog
		? await loadSkillReminderLeadDays(db, organizationId)
		: undefined;

	return (
		<SkillCatalogManagement
			organizationId={organizationId}
			canManageCatalog={canManageCatalog}
			reminderLeadDays={reminderLeadDays}
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
