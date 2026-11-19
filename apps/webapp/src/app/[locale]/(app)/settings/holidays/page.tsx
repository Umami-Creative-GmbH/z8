import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function HolidaySettingsPageContent() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext) {
		return redirectWithLocale("/settings");
	}

	const { authContext, accessTier } = settingsRouteContext;
	const organizationId = authContext.session.activeOrganizationId;

	if (accessTier === "member" || !organizationId) {
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
