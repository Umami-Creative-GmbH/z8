import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CalendarSettingsForm } from "@/components/settings/calendar-settings-form";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getCalendarSettings, getManagerCalendarReadView } from "./actions";

async function CalendarSettingsPageContent() {
	const [settingsRouteContext, t] = await Promise.all([
		getCurrentSettingsRouteContext(),
		getTranslate(),
	]);

	if (!settingsRouteContext) {
		redirect("/settings");
	}

	const { authContext, accessTier } = settingsRouteContext;
	const organizationId = authContext.session.activeOrganizationId;

	if (accessTier === "member" || !organizationId) {
		redirect("/settings");
	}

	const canManageCalendarSettings = accessTier === "orgAdmin";

	const settingsResult = await (canManageCalendarSettings
		? getCalendarSettings()
		: getManagerCalendarReadView());

	if (!settingsResult.success) {
		redirect("/settings");
	}

	const settings = canManageCalendarSettings
		? settingsResult.data
		: {
				relevantConnections: settingsResult.data.relevantConnections,
			};

	return (
		<div className="p-6">
			<div className="mx-auto max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">
						{t("settings.calendar.title", "Calendar Sync")}
					</h1>
					<p className="text-muted-foreground">
						{accessTier === "orgAdmin"
							? t(
									"settings.calendar.description",
									"Configure calendar providers, ICS feeds, and sync settings for your organization",
								)
							: t(
									"settings.calendar.managerDescription",
									"Review calendar integrations that affect your teams, areas, and managed projects.",
								)}
					</p>
				</div>

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
		<div className="p-6">
			<div className="mx-auto max-w-3xl space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-48" />
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
