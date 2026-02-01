import { and, eq } from "drizzle-orm";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { CalendarSettingsForm } from "@/components/settings/calendar-settings-form";
import { getCalendarSettings } from "./actions";

export default async function CalendarSettingsPage() {
	await connection();

	const [authContext, t] = await Promise.all([requireUser(), getTranslate()]);

	const organizationId = authContext.session.activeOrganizationId;
	if (!organizationId) {
		redirect("/");
	}

	// Parallelize member check and settings fetch (async-parallel)
	const [memberRecord, settingsResult] = await Promise.all([
		db.query.member.findFirst({
			where: and(
				eq(authSchema.member.userId, authContext.user.id),
				eq(authSchema.member.organizationId, organizationId),
			),
		}),
		getCalendarSettings(),
	]);

	// Check if user is admin/owner
	if (!memberRecord || (memberRecord.role !== "owner" && memberRecord.role !== "admin")) {
		redirect("/settings");
	}

	const settings = settingsResult.success
		? settingsResult.data
		: {
				googleEnabled: true,
				microsoft365Enabled: true,
				icsFeedsEnabled: true,
				teamIcsFeedsEnabled: true,
				autoSyncOnApproval: true,
				conflictDetectionRequired: false,
				eventTitleTemplate: "Out of Office - {categoryName}",
				eventDescriptionTemplate: null,
				googleAvailable: false,
				microsoft365Available: false,
			};

	return (
		<div className="p-6">
			<div className="mx-auto max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">
						{t("settings.calendar.title", "Calendar Sync")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.calendar.description",
							"Configure calendar providers, ICS feeds, and sync settings for your organization",
						)}
					</p>
				</div>

				<CalendarSettingsForm initialSettings={settings} />
			</div>
		</div>
	);
}
