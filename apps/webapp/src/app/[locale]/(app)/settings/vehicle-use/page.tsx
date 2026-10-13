import { Suspense } from "react";
import { VehicleUseSettings } from "@/components/settings/vehicle-use/vehicle-use-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getVehicleUseAdminDataAction } from "./actions";

async function VehicleUseSettingsPageContent() {
	await requireOrgAdminSettingsAccess();
	const [t, result] = await Promise.all([getTranslate(), getVehicleUseAdminDataAction()]);

	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">
						{t("settings.vehicleUse.title", "Vehicle use")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.vehicleUse.description",
							"Who is asked to record the vehicle they drove and its odometer readings",
						)}
					</p>
				</div>
				{result.success ? (
					<VehicleUseSettings data={result.data} />
				) : (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.vehicleUse.loadFailed",
							"The vehicle use settings could not be loaded. Reload the page.",
						)}
					</p>
				)}
			</div>
		</div>
	);
}

function VehicleUseSettingsPageLoading() {
	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-3xl space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<Skeleton className="h-40 w-full" />
				<Skeleton className="h-64 w-full" />
			</div>
		</div>
	);
}

export default function VehicleUseSettingsPage() {
	return (
		<Suspense fallback={<VehicleUseSettingsPageLoading />}>
			<VehicleUseSettingsPageContent />
		</Suspense>
	);
}
