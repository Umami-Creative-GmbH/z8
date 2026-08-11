import { connection } from "next/server";
import { Suspense } from "react";
import { WellnessSettingsForm } from "@/components/settings/wellness-settings-form";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getWellnessSettings } from "./actions";

async function WellnessPageContent() {
	// The wellness Effect program requires synchronous current-time execution per request.
	await connection();
	const [, settingsResult, t] = await Promise.all([
		requireUser(),
		getWellnessSettings(),
		getTranslate(),
	]);

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
					<h1 className="text-2xl font-semibold">
						{t("settings.wellness.title", "Wellness Settings")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.wellness.description",
							"Configure water reminders and hydration tracking during your work sessions",
						)}
					</p>
				</div>

				<WellnessSettingsForm initialSettings={settings} />
			</div>
		</div>
	);
}

function WellnessPageLoading() {
	return (
		<div className="p-6" role="status" aria-label="Loading wellness settings">
			<div className="mx-auto max-w-2xl space-y-6">
				<div className="space-y-2">
					<Skeleton aria-hidden="true" className="h-8 w-56" />
					<Skeleton aria-hidden="true" className="h-4 w-full max-w-lg" />
				</div>
				<Skeleton aria-hidden="true" className="h-80 w-full" />
			</div>
		</div>
	);
}

export default function WellnessPage() {
	return (
		<Suspense fallback={<WellnessPageLoading />}>
			<WellnessPageContent />
		</Suspense>
	);
}
