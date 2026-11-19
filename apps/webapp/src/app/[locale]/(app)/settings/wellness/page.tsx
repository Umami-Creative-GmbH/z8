import { connection } from "next/server";
import { Suspense } from "react";
import { SettingsLoadError } from "@/components/settings/settings-load-error";
import { WellnessSettingsForm } from "@/components/settings/wellness-settings-form";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
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

	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
				<PageHeader
					title={t("settings.wellness.title", "Wellness Settings")}
					description={t(
						"settings.wellness.description",
						"Configure water reminders and hydration tracking during your work sessions",
					)}
				/>

				{settingsResult.success ? (
					<WellnessSettingsForm initialSettings={settingsResult.data} />
				) : (
					// Editing defaults here would overwrite the saved reminders on save.
					<SettingsLoadError
						message={t(
							"settings.wellness.loadFailed",
							"Your water reminder settings could not be loaded. Try again.",
						)}
					/>
				)}
			</div>
		</div>
	);
}

function WellnessPageLoading() {
	return (
		<LoadingRegion
			className="page-frame"
			role="status"
			label={{
				labelKey: "common.loadingRegions.wellnessSettings",
				labelDefault: "Loading wellness settings",
			}}
		>
			<div className="page-measure space-y-6">
				<div className="space-y-2">
					<Skeleton aria-hidden="true" className="h-8 w-56 sm:h-9" />
					<Skeleton aria-hidden="true" className="h-4 w-full max-w-lg" />
				</div>
				<Skeleton aria-hidden="true" className="h-80 w-full" />
			</div>
		</LoadingRegion>
	);
}

export default function WellnessPage() {
	return (
		<Suspense fallback={<WellnessPageLoading />}>
			<WellnessPageContent />
		</Suspense>
	);
}
