import { Suspense } from "react";
import { SettingsLoadError } from "@/components/settings/settings-load-error";
import {
	VehicleUseAssignments,
	VehicleUseSwitch,
} from "@/components/settings/vehicle-use/vehicle-use-settings";
import { VehicleSettings } from "@/components/settings/vehicles/vehicle-settings";
import { VehicleSettingsTabs } from "@/components/settings/vehicles/vehicle-settings-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getVehicleUseAdminDataAction } from "./vehicle-use-actions";
import { getVehicleSettings } from "./actions";

async function VehicleSettingsPageContent() {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const [t, result, useResult] = await Promise.all([
		getTranslate(),
		getVehicleSettings(),
		getVehicleUseAdminDataAction(),
	]);
	const useError = (
		<SettingsLoadError
			message={t(
				"settings.vehicleUse.loadFailedRetry",
				"The vehicle use settings could not be loaded.",
			)}
		/>
	);

	return (
		<div className="page-frame">
			<div className="page-measure min-w-0 space-y-6">
				<PageHeader
					title={t("settings.vehicles.title", "Vehicles")}
					description={t(
						"settings.vehicles.description",
						"Vehicles your employees drive for work, and their assigned drivers",
					)}
				/>
				<VehicleSettingsTabs
					key={organizationId}
					panels={{
						vehicles: result.success ? (
							<VehicleSettings initialData={result.data} />
						) : (
							<SettingsLoadError
								message={t(
									"settings.vehicles.loadFailed",
									"Vehicles could not be loaded.",
								)}
							/>
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
		<div className="page-frame">
			<div className="page-measure min-w-0 space-y-6">
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
