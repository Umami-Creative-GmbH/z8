import { Suspense } from "react";
import { DrivingLicenceSettings } from "@/components/driving-licence/policy-settings";
import { DrivingLicenceRetentionSettings } from "@/components/driving-licence/retention-settings";
import {
	DrivingLicenceIntendedDriversPanel,
	DrivingLicenceSettingsTabs,
} from "@/components/driving-licence/settings-tabs";
import { VerifierSettings } from "@/components/driving-licence/verifier-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { requireDrivingLicenceSettingsPage } from "@/lib/organization/driving-licence/page-guards";
import { getDrivingLicenceAdminDataAction } from "@/lib/organization/driving-licence/policy-actions";
import { getTranslate } from "@/tolgee/server";

/**
 * The visibility reader decides (#1420): not found while it hides the settings, and only
 * Retention & holds while the feature is off but records or legal-case holds remain.
 * The tabs (#1427) are linkable with `?tab=`; the first activation lands on
 * `?tab=intended-drivers`.
 */
async function DrivingLicenceSettingsContent() {
	await requireOrgAdminSettingsAccess();
	const { settings } = await requireDrivingLicenceSettingsPage();
	const retention = <DrivingLicenceRetentionSettings />;
	if (settings === "retention_only")
		return <DrivingLicenceSettingsTabs settings={settings} panels={{ retention }} />;
	const [result, t] = await Promise.all([getDrivingLicenceAdminDataAction(), getTranslate()]);
	const loadError = (
		<p role="alert" className="text-sm text-destructive">
			{t(
				"drivingLicence.loadError",
				"Driving licence control could not be loaded. Check your organization access.",
			)}
		</p>
	);
	return (
		<DrivingLicenceSettingsTabs
			settings={settings}
			panels={{
				policy: result.success ? (
					<DrivingLicenceSettings
						key={`${result.data.policy?.organizationId ?? "new"}:${result.data.policy?.version ?? 0}`}
						data={result.data}
					/>
				) : (
					loadError
				),
				"intended-drivers": result.success ? (
					<DrivingLicenceIntendedDriversPanel data={result.data.intendedDrivers} />
				) : (
					loadError
				),
				verifiers: <VerifierSettings />,
				retention,
			}}
		/>
	);
}
function DrivingLicenceSettingsLoading() {
	return (
		<div className="page-frame" aria-busy="true">
			<div className="page-measure flex min-w-0 flex-col gap-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-64" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<div className="space-y-4">
					<Skeleton className="h-9 w-96 max-w-full" />
					<Skeleton className="h-72 w-full" />
				</div>
			</div>
		</div>
	);
}

export default function DrivingLicenceSettingsPage() {
	return (
		<Suspense fallback={<DrivingLicenceSettingsLoading />}>
			<DrivingLicenceSettingsContent />
		</Suspense>
	);
}
