import { Suspense } from "react";
import { CalendarSettingsForm } from "@/components/settings/calendar-settings-form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { getTranslate } from "@/tolgee/server";
import { getCalendarSettings, getManagerCalendarReadView } from "./actions";

async function CalendarSettingsPageContent() {
	const [settingsRouteContext, t] = await Promise.all([
		getCurrentSettingsRouteContext(),
		getTranslate(),
	]);

	if (!settingsRouteContext) {
		return redirectWithLocale("/settings");
	}

	const { authContext, accessTier } = settingsRouteContext;
	const organizationId = authContext.session.activeOrganizationId;

	if (accessTier === "member" || !organizationId) {
		return redirectWithLocale("/settings");
	}

	const canManageCalendarSettings = accessTier === "orgAdmin";

	const settingsResult = await (canManageCalendarSettings
		? getCalendarSettings()
		: getManagerCalendarReadView());

	if (!settingsResult.success) {
		return redirectWithLocale("/settings");
	}

	const settings = canManageCalendarSettings
		? settingsResult.data
		: {
				relevantConnections: settingsResult.data.relevantConnections,
			};

	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
				<PageHeader
					title={t("settings.calendar.title", "Calendar Sync")}
					description={
						accessTier === "orgAdmin"
							? t(
									"settings.calendar.description",
									"Configure calendar providers, ICS feeds, and sync settings for your organization",
								)
							: t(
									"settings.calendar.managerDescription",
									"Review calendar integrations that affect your teams, areas, and managed projects.",
								)
					}
				/>

				<CalendarSettingsForm
					initialSettings={settings}
					canManage={canManageCalendarSettings}
				/>
			</div>
		</div>
	);
}

function CalendarSettingsPageLoading() {
	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-48 sm:h-9" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<Skeleton className="h-64 w-full" />
			</div>
		</div>
	);
}

export default function CalendarSettingsPage() {
	return (
		<Suspense fallback={<CalendarSettingsPageLoading />}>
			<CalendarSettingsPageContent />
		</Suspense>
	);
}
