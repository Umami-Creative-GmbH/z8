import { ProfileForm } from "@/components/settings/profile-form";
import { TimezoneSettings } from "@/components/settings/timezone-settings";
import { WeekStartSettings } from "@/components/settings/week-start-settings";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getCurrentTimezone, getWeekStartDay, updateTimezone, updateWeekStartDay } from "./actions";

export default async function ProfilePage() {
	// Parallelize auth, timezone, and translation fetches
	const [authContext, currentTimezone, currentWeekStartDay, t] = await Promise.all([
		requireUser(),
		getCurrentTimezone(),
		getWeekStartDay(),
		getTranslate(),
	]);

	return (
		<div className="p-6">
			<div className="mx-auto max-w-2xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">
						{t("settings.profile.title", "Profile Settings")}
					</h1>
					<p className="text-muted-foreground">
						{t("settings.profile.description", "Manage your personal information and preferences")}
					</p>
				</div>

				<ProfileForm user={authContext.user} />

				<TimezoneSettings currentTimezone={currentTimezone} onUpdate={updateTimezone} />
				<WeekStartSettings
					currentWeekStartDay={currentWeekStartDay}
					onUpdate={updateWeekStartDay}
				/>
			</div>
		</div>
	);
}
