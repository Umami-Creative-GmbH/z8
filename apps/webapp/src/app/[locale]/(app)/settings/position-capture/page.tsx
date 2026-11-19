import { Suspense } from "react";
import { PositionCaptureSettings } from "@/components/settings/position-capture/position-capture-settings";
import { SettingsLoadError } from "@/components/settings/settings-load-error";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getPositionCaptureAdminDataAction } from "./actions";

async function PositionCaptureSettingsPageContent() {
	await requireOrgAdminSettingsAccess();
	const [t, result] = await Promise.all([
		getTranslate(),
		getPositionCaptureAdminDataAction(),
	]);

	return (
		<div className="page-frame">
			<div className="page-measure min-w-0 space-y-6">
				<PageHeader
					title={t("settings.positionCapture.title", "Position capture")}
					description={t(
						"settings.positionCapture.description",
						"Record positions with employees' own clock events, with their consent",
					)}
				/>
				{result.success ? (
					<PositionCaptureSettings data={result.data} />
				) : (
					<SettingsLoadError
						message={t(
							"settings.positionCapture.loadFailed",
							"Position capture settings could not be loaded",
						)}
					/>
				)}
			</div>
		</div>
	);
}

function PositionCaptureSettingsPageLoading() {
	return (
		<div className="page-frame" aria-busy="true">
			<div className="page-measure min-w-0 space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<Skeleton className="h-9 w-56" />
				<Skeleton className="h-80 w-full" />
				<Skeleton className="h-48 w-full" />
			</div>
		</div>
	);
}

export default function PositionCaptureSettingsPage() {
	return (
		<Suspense fallback={<PositionCaptureSettingsPageLoading />}>
			<PositionCaptureSettingsPageContent />
		</Suspense>
	);
}
