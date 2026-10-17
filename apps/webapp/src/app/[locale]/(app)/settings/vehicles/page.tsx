import { Suspense } from "react";
import {
	VehicleUseAssignments,
	VehicleUseSwitch,
} from "@/components/settings/vehicle-use/vehicle-use-settings";
import { VehicleSettings } from "@/components/settings/vehicles/vehicle-settings";
import { VehicleSettingsTabs } from "@/components/settings/vehicles/vehicle-settings-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getVehicleUseAdminDataAction } from "../vehicle-use/actions";
import { getVehicleSettings } from "./actions";

async function VehicleSettingsPageContent() {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const [t, result, useResult] = await Promise.all([
		getTranslate(),
		getVehicleSettings(),
		getVehicleUseAdminDataAction(),
	]);
	const useError = (
		<p className="text-sm text-muted-foreground">
			{t(
				"settings.vehicleUse.loadFailed",
				"The vehicle use settings could not be loaded. Reload the page.",
			)}
		</p>
	);

	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-4xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">
						{t("settings.vehicles.title", "Vehicles")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.vehicles.description",
							"Vehicles your employees drive for work, and their assigned drivers",
						)}
					</p>
				</div>
				<VehicleSettingsTabs
					key={organizationId}
					panels={{
						vehicles: result.success ? (
							<VehicleSettings initialData={result.data} />
						) : (
							<p className="text-sm text-muted-foreground">
								{t(
									"settings.vehicles.loadFailed",
									"Vehicles could not be loaded.",
								)}
							</p>
						),
						use: useResult.success ? (
							<VehicleUseSwitch
								key={String(useResult.data.settings.enabled)}
								initialEnabled={useResult.data.settings.enabled}
							/>
						) : (
							useError
						),
						assignments: useResult.success ? (
							<VehicleUseAssignments data={useResult.data} />
						) : (
							useError
						),
					}}
				/>
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
