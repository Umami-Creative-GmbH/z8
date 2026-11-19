import { Suspense } from "react";
import { OwnPositionStampsPanel } from "@/components/settings/position-stamps/own-position-stamps-panel";
import { SettingsLoadError } from "@/components/settings/settings-load-error";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getOwnPositionCaptureAction, getOwnPositionStampAccessLogAction } from "./actions";

async function PositionStampsPageContent() {
	await requireUser();
	const [t, result, accessLog] = await Promise.all([
		getTranslate(),
		getOwnPositionCaptureAction(),
		getOwnPositionStampAccessLogAction(),
	]);

	return (
		<div className="page-frame">
			<div className="page-measure min-w-0 space-y-6">
				<PageHeader
					title={t("settings.positionStamps.title", "Position stamps")}
					description={t(
						"settings.positionStamps.description",
						"Whether your position is recorded with your clock events, and your consent",
					)}
				/>
				{result.success ? (
					<OwnPositionStampsPanel
						data={result.data}
						accessLog={accessLog.success ? accessLog.data : null}
					/>
				) : result.refusal === "employee_profile_required" ? (
					// Only a missing employee profile is a lasting prerequisite; any
					// other failure is a load error the user can retry.
					<p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
						{t(
							"settings.positionStamps.unavailable",
							"Position stamps are available once you have an employee profile in this organization.",
						)}
					</p>
				) : (
					<SettingsLoadError
						message={t(
							"settings.positionStamps.loadFailed",
							"Your position stamp settings could not be loaded.",
						)}
					/>
				)}
			</div>
		</div>
	);
}

function PositionStampsPageLoading() {
	return (
		<div className="page-frame">
			<div className="page-measure min-w-0 space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<Skeleton className="h-40 w-full" />
				<Skeleton className="h-80 w-full" />
			</div>
		</div>
	);
}

export default function PositionStampsPage() {
	return (
		<Suspense fallback={<PositionStampsPageLoading />}>
			<PositionStampsPageContent />
		</Suspense>
	);
}
