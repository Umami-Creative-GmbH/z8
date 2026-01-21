import { connection } from "next/server";
import { WellnessSettingsForm } from "@/components/settings/wellness-settings-form";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getWellnessSettings } from "./actions";

export default async function WellnessPage() {
	// Signal that this route needs request data (required before Effect runtime uses Date.now())
	await connection();

	// Parallelize auth, settings, and translation fetches
	const [, settingsResult, t] = await Promise.all([requireUser(), getWellnessSettings(), getTranslate()]);

	// Handle error case
	const settings = settingsResult.success
		? settingsResult.data
		: {
				enabled: false,
				preset: "moderate" as const,
				intervalMinutes: 45,
				dailyGoal: 8,
			};

	return (
		<div className="p-6">
			<div className="mx-auto max-w-2xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">{t("settings.wellness.title", "Wellness Settings")}</h1>
					<p className="text-muted-foreground">
						{t("settings.wellness.description", "Configure water reminders and hydration tracking during your work sessions")}
					</p>
				</div>

				<WellnessSettingsForm initialSettings={settings} />
			</div>
		</div>
	);
}
