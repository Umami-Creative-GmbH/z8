import { WellnessSettingsForm } from "@/components/settings/wellness-settings-form";
import { requireUser } from "@/lib/auth-helpers";
import { getWellnessSettings } from "./actions";

export default async function WellnessPage() {
	// Parallelize auth and settings fetches
	const [, settingsResult] = await Promise.all([requireUser(), getWellnessSettings()]);

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
					<h1 className="text-2xl font-semibold">Wellness Settings</h1>
					<p className="text-muted-foreground">
						Configure water reminders and hydration tracking during your work sessions
					</p>
				</div>

				<WellnessSettingsForm initialSettings={settings} />
			</div>
		</div>
	);
}
