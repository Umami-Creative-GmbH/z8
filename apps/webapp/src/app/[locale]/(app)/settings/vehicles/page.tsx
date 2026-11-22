import { Suspense } from "react";
import { SettingsLoadError } from "@/components/settings/settings-load-error";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
import {
	VehicleUseAssignments,
	VehicleUseSwitch,
} from "@/components/settings/vehicle-use/vehicle-use-settings";
import { VehicleSettings } from "@/components/settings/vehicles/vehicle-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getVehicleSettings } from "./actions";
import { getVehicleUseAdminDataAction } from "./vehicle-use-actions";

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
		<SettingsTabbedPage
			key={organizationId}
			title={t("settings.vehicles.title", "Vehicles")}
			description={t(
				"settings.vehicles.description",
				"Vehicles your employees drive for work, and their assigned drivers",
			)}
			measure
			defaultTab="vehicles"
			tabs={[
				{
					value: "vehicles",
					label: t("settings.vehicles.title", "Vehicles"),
					panel: result.success ? (
						<VehicleSettings initialData={result.data} />
					) : (
						<SettingsLoadError
							message={t("settings.vehicles.loadFailed", "Vehicles could not be loaded.")}
						/>
					),
				},
				{
					value: "use",
					label: t("settings.vehicleUse.title", "Vehicle use"),
					panel: useResult.success ? (
						<VehicleUseSwitch
							key={String(useResult.data.settings.enabled)}
							initialEnabled={useResult.data.settings.enabled}
						/>
					) : (
						useError
					),
				},
				{
					value: "assignments",
					label: t("settings.workPolicies.tab.assignments", "Assignments"),
					panel: useResult.success ? <VehicleUseAssignments data={useResult.data} /> : useError,
				},
			]}
		/>
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
