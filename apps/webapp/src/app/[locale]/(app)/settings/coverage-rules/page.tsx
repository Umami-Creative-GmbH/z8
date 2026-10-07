import { Suspense } from "react";
import { CoverageRulesManagement } from "@/components/settings/coverage-rules-management";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import {
	getSchedulingSettingsAccessContext,
	getScopedSchedulingLocationsForSettings,
} from "@/lib/settings-scheduling-access";

async function CoverageRulesSettingsContent() {
	const accessContext = await getSchedulingSettingsAccessContext();

	if (!accessContext?.canAccessCoverageRules) {
		return redirectWithLocale("/settings");
	}

	const locations = await getScopedSchedulingLocationsForSettings({
		organizationId: accessContext.organizationId,
		manageableSubareaIds: accessContext.manageableSubareaIds,
	});

	return (
		<CoverageRulesManagement
			organizationId={accessContext.organizationId}
			locations={locations}
			manageableSubareaIds={
				accessContext.manageableSubareaIds
					? [...accessContext.manageableSubareaIds]
					: null
			}
			canManageCoverageSettings={accessContext.canManageCoverageSettings}
		/>
	);
}

function CoverageRulesSettingsLoading() {
	return (
		<LoadingRegion
			className="flex flex-1 flex-col gap-4 p-4"
			role="status"
			label={{
				labelKey: "common.loadingRegions.coverageRuleSettings",
				labelDefault: "Loading coverage rule settings",
			}}
		>
			<div className="space-y-2">
				<Skeleton aria-hidden="true" className="h-8 w-56" />
				<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
			</div>
			<Skeleton aria-hidden="true" className="h-40 w-full" />
			<Skeleton aria-hidden="true" className="h-64 w-full" />
		</LoadingRegion>
	);
}

export default function CoverageRulesSettingsPage() {
	return (
		<Suspense fallback={<CoverageRulesSettingsLoading />}>
			<CoverageRulesSettingsContent />
		</Suspense>
	);
}
