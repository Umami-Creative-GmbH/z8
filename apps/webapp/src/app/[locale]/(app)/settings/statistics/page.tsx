import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function StatisticsContent() {
	return redirectWithLocale("/analytics");
}

/** Legacy `/settings/statistics` route redirects to the unified `/analytics` workspace (#1955). */
function StatisticsLoading() {
	return (
		<SettingsPageSkeleton
			label={{
				labelKey: "common.loadingRegions.statistics",
				labelDefault: "Loading statistics",
			}}
		/>
	);
}

export default function StatisticsPage() {
	return (
		<Suspense fallback={<StatisticsLoading />}>
			<StatisticsContent />
		</Suspense>
	);
}
