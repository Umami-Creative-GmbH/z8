import { Suspense } from "react";
import { VehicleSettings } from "@/components/settings/vehicles/vehicle-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getVehicleSettings } from "./actions";

async function VehicleSettingsPageContent() {
	await requireOrgAdminSettingsAccess();
	const [t, result] = await Promise.all([getTranslate(), getVehicleSettings()]);

	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-4xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">{t("settings.vehicles.title", "Vehicles")}</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.vehicles.description",
							"Vehicles your employees drive for work, and their assigned drivers",
						)}
					</p>
				</div>
				{result.success ? (
					<VehicleSettings initialData={result.data} />
				) : (
					<p className="text-sm text-muted-foreground">
						{t("settings.vehicles.loadFailed", "Vehicles could not be loaded.")}
					</p>
				)}
			</div>
		</div>
	);
}

function VehicleSettingsPageLoading() {
	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-4xl space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-40" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-72 w-full" />
			</div>
		</div>
	);
}

export default function VehicleSettingsPage() {
	return (
		<Suspense fallback={<VehicleSettingsPageLoading />}>
			<VehicleSettingsPageContent />
		</Suspense>
	);
}
