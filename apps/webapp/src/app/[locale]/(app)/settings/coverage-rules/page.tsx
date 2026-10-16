import { Suspense } from "react";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { getSchedulingSettingsAccessContext } from "@/lib/settings-scheduling-access";

async function CoverageRulesSettingsContent() {
	const accessContext = await getSchedulingSettingsAccessContext();

	if (!accessContext?.canAccessCoverageRules) {
		return redirectWithLocale("/settings");
	}

	return redirectWithLocale("/settings/shifts?tab=coverage");
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
