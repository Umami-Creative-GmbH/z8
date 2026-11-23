import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function ClosedMonthsRedirect() {
	return redirectWithLocale("/payroll?tab=closed-months");
}

function ClosedMonthsLoading() {
	return (
		<SettingsPageSkeleton
			label={{
				labelKey: "common.loadingRegions.settings",
				labelDefault: "Loading settings",
			}}
		/>
	);
}

/** Legacy `/settings/closed-months` route redirects to `/payroll?tab=closed-months` (#1957). */
export default function ClosedMonthsSettingsPage() {
	return (
		<Suspense fallback={<ClosedMonthsLoading />}>
			<ClosedMonthsRedirect />
		</Suspense>
	);
}
