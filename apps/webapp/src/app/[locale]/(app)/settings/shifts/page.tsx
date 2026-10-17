import { Suspense } from "react";
import { CoverageRulesManagement } from "@/components/settings/coverage-rules-management";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
import { ShiftTemplateManagement } from "@/components/settings/shift-template-management";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import {
	getSchedulingSettingsAccessContext,
	getScopedSchedulingLocationsForSettings,
} from "@/lib/settings-scheduling-access";
import { getTranslate } from "@/tolgee/server";

async function ShiftTemplatesPageContent() {
	const [accessContext, t] = await Promise.all([
		getSchedulingSettingsAccessContext(),
		getTranslate(),
	]);

	if (
		!accessContext ||
		(!accessContext.canAccessShiftTemplates &&
			!accessContext.canAccessCoverageRules)
	) {
		return redirectWithLocale("/settings");
	}

	const [templateLocations, coverageLocations] = await Promise.all([
		accessContext.canAccessShiftTemplates
			? getScopedSchedulingLocationsForSettings({
					organizationId: accessContext.organizationId,
					manageableSubareaIds: accessContext.manageableShiftTemplateSubareaIds,
				})
			: [],
		accessContext.canAccessCoverageRules
			? getScopedSchedulingLocationsForSettings({
					organizationId: accessContext.organizationId,
					manageableSubareaIds: accessContext.manageableSubareaIds,
				})
			: [],
	]);
	return (
		<SettingsTabbedPage
			key={accessContext.organizationId}
			title={t("settings.navigation.shiftPlanning.title", "Shift Planning")}
			defaultTab={
				accessContext.canAccessShiftTemplates ? "templates" : "coverage"
			}
			tabs={[
				...(accessContext.canAccessShiftTemplates
					? [
							{
								value: "templates",
								label: t("settings.shiftTemplates.title", "Shift Templates"),
								description: t(
									"settings.shiftTemplates.description",
									"Create reusable shift templates like Morning Shift, Night Shift, etc. These templates can be quickly applied when scheduling shifts.",
								),
								panel: (
									<ShiftTemplateManagement
										organizationId={accessContext.organizationId}
										locations={templateLocations}
										manageableSubareaIds={
											accessContext.manageableShiftTemplateSubareaIds
												? [...accessContext.manageableShiftTemplateSubareaIds]
												: null
										}
									/>
								),
							},
						]
					: []),
				...(accessContext.canAccessCoverageRules
					? [
							{
								value: "coverage",
								label: t("settings.coverageRules.title", "Coverage Targets"),
								description: t(
									"settings.coverageRules.description",
									"Define minimum staffing requirements per location, day, and time block.",
								),
								panel: (
									<CoverageRulesManagement
										organizationId={accessContext.organizationId}
										locations={coverageLocations}
										manageableSubareaIds={
											accessContext.manageableSubareaIds
												? [...accessContext.manageableSubareaIds]
												: null
										}
										canManageCoverageSettings={
											accessContext.canManageCoverageSettings
										}
									/>
								),
							},
						]
					: []),
			]}
		/>
	);
}

function ShiftTemplatesPageLoading() {
	return (
		<LoadingRegion
			className="flex flex-1 flex-col gap-4 p-4"
			role="status"
			label={{
				labelKey: "common.loadingRegions.shiftTemplateSettings",
				labelDefault: "Loading shift template settings",
			}}
		>
			<Skeleton className="h-8 w-48" aria-hidden="true" />
			<Skeleton className="h-64 w-full" aria-hidden="true" />
		</LoadingRegion>
	);
}

export default function ShiftTemplatesPage() {
	return (
		<Suspense fallback={<ShiftTemplatesPageLoading />}>
			<ShiftTemplatesPageContent />
		</Suspense>
	);
}
