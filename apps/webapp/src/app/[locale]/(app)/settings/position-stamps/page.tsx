import { Suspense } from "react";
import { OwnPositionStampsPanel } from "@/components/settings/position-stamps/own-position-stamps-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getOwnPositionCaptureAction } from "./actions";

async function PositionStampsPageContent() {
	await requireUser();
	const [t, result] = await Promise.all([getTranslate(), getOwnPositionCaptureAction()]);

	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">
						{t("settings.positionStamps.title", "Position stamps")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.positionStamps.description",
							"Whether your position is recorded with your clock events, and your consent",
						)}
					</p>
				</div>
				{result.success ? (
					<OwnPositionStampsPanel data={result.data} />
				) : (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.positionStamps.unavailable",
							"Position stamps are available once you have an employee profile in this organization.",
						)}
					</p>
				)}
			</div>
		</div>
	);
}

function PositionStampsPageLoading() {
	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-3xl space-y-6">
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
