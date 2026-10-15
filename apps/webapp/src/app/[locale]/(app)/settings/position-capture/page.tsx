import { Suspense } from "react";
import { PositionCaptureSettings } from "@/components/settings/position-capture/position-capture-settings";
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
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="min-w-0 space-y-4">
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.positionCapture.title", "Position capture")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.positionCapture.description",
							"Record positions with employees' own clock events, with their consent",
						)}
					</p>
				</div>
				{result.success ? (
					<PositionCaptureSettings data={result.data} />
				) : (
					<p className="text-sm text-muted-foreground">{result.error}</p>
				)}
			</div>
		</div>
	);
}

function PositionCaptureSettingsPageLoading() {
	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="min-w-0 space-y-4">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
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
