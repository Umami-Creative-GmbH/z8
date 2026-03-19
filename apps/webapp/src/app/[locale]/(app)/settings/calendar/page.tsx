import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { CalendarSettingsForm } from "@/components/settings/calendar-settings-form";
import { getCalendarSettings, getManagerCalendarReadView } from "./actions";

export default async function CalendarSettingsPage() {
	await connection();

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

	const settings =
		canManageCalendarSettings
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
