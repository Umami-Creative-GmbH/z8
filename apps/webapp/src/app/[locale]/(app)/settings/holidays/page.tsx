import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";

async function HolidaySettingsPageContent() {
	const caller = await getCurrentSettingsAccess();

	if (!caller?.settingsAccess || !meetsSettingsAccess(caller.settingsAccess, "scopedManager")) {
		return redirectWithLocale("/settings");
	}

	return redirectWithLocale("/settings/vacation?tab=holidays");
}

/** This route redirects to the Absences holidays tab; load in the settings page frame. */
function HolidaySettingsPageLoading() {
	return (
		<SettingsPageSkeleton
			label={{
				labelKey: "common.loadingRegions.holidaySettings",
				labelDefault: "Loading holiday settings",
			}}
		/>
	);
}

export default function HolidaySettingsPage() {
	return (
		<Suspense fallback={<HolidaySettingsPageLoading />}>
			<HolidaySettingsPageContent />
		</Suspense>
	);
}
