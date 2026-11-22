import { IconGauge } from "@tabler/icons-react";
import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { VehicleDistanceReportContainer } from "@/components/reports/vehicles/vehicle-distance-report-container";
import { Button } from "@/components/ui/button";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { drivingDetailsTeamScope } from "@/lib/time-tracking/vehicle-use/driving-details-team-store";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";
import { getCurrentEmployee } from "../actions";

async function VehicleDistanceReportPageContent() {
	// Auth is checked in layout; who sees whose driving is decided by the report action.
	const [t, employee, settingsContext] = await Promise.all([
		getTranslate(),
		getCurrentEmployee(),
		getCurrentSettingsRouteContext(),
	]);
	const organizationId = settingsContext?.authContext.session.activeOrganizationId;
	const canViewMissingVehicleLogs = Boolean(
		settingsContext &&
		organizationId &&
		drivingDetailsTeamScope({
			accessTier: settingsContext.accessTier,
			organizationId,
			employee: settingsContext.authContext.employee ?? null,
		}),
	);
	const missingVehicleLogsAction = canViewMissingVehicleLogs ? (
		<Button asChild variant="outline">
			<Link href="/team/driving">
				<IconGauge className="mr-2 size-4" aria-hidden="true" />
				{t("nav.missing-vehicle-logs", "Missing vehicle logs")}
			</Link>
		</Button>
	) : null;

	if (!employee) {
		return (
			<div className="flex min-w-0 flex-1 flex-col gap-6">
				<PageHeader
					title={t("reports.vehicles.title", "Distance per Vehicle")}
					actions={missingVehicleLogsAction}
				/>
				<NoEmployeeError
					feature={t("reports.vehicles.page.feature", "view the distance per vehicle report")}
				/>
			</div>
		);
	}

	return (
		<div className="flex min-w-0 flex-1 flex-col gap-6">
			<PageHeader
				title={t("reports.vehicles.title", "Distance per Vehicle")}
				description={t(
					"reports.vehicles.page.description",
					"Kilometres driven for work per vehicle and employee, by month",
				)}
				actions={missingVehicleLogsAction}
			/>

			<VehicleDistanceReportContainer />
		</div>
	);
}

async function VehicleDistanceReportPageLoading() {
	const t = await getTranslate();
	return (
		<LoadingRegion
			label={{
				labelKey: "common.loadingRegions.vehicleDistanceReport",
				labelDefault: "Loading the distance per vehicle report",
			}}
			className="flex min-w-0 flex-1 flex-col gap-6"
			role="status"
		>
			<div className="space-y-3">
				<PageHeader title={t("reports.vehicles.title", "Distance per Vehicle")} />
				<Skeleton aria-hidden="true" className="h-5 w-full max-w-2xl" />
			</div>
			<Skeleton aria-hidden="true" className="h-96 w-full" />
		</LoadingRegion>
	);
}

export default function VehicleDistanceReportPage() {
	return (
		<Suspense fallback={<VehicleDistanceReportPageLoading />}>
			<VehicleDistanceReportPageContent />
		</Suspense>
	);
}
