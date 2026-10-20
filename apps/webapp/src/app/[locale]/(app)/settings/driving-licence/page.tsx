import { IconInfoCircle } from "@tabler/icons-react";
import { Suspense } from "react";
import { IntendedDriverSettings } from "@/components/driving-licence/intended-driver-settings";
import { DrivingLicenceSettings } from "@/components/driving-licence/policy-settings";
import { DrivingLicenceReassignmentTasks } from "@/components/driving-licence/reminder-tasks";
import { DrivingLicenceRetentionSettings } from "@/components/driving-licence/retention-settings";
import { VerifierSettings } from "@/components/driving-licence/verifier-settings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { requireDrivingLicenceSettingsPage } from "@/lib/organization/driving-licence/page-guards";
import { getDrivingLicenceAdminDataAction } from "@/lib/organization/driving-licence/policy-actions";
import { getTranslate } from "@/tolgee/server";

/**
 * The visibility reader decides (#1420): not found while it hides the settings, and only
 * Retention & holds while the feature is off but records or legal-case holds remain.
 */
async function DrivingLicenceSettingsContent() {
	await requireOrgAdminSettingsAccess();
	const { settings } = await requireDrivingLicenceSettingsPage();
	if (settings === "retention_only") return <RetentionOnlySettings />;
	const [result, t] = await Promise.all([
		getDrivingLicenceAdminDataAction(),
		getTranslate(),
	]);
	return (
		<div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
			<div>
				<h1 className="text-2xl font-semibold">
					{t("drivingLicence.title", "Driving licence control")}
				</h1>
				<p className="mt-1 text-muted-foreground">
					{t(
						"drivingLicence.subtitle",
						"Configure original checks and enroll intended drivers. Driving authorization is specific to checked classes and restrictions.",
					)}
				</p>
			</div>
			{result.success ? (
				<>
					<DrivingLicenceSettings
						key={`${result.data.policy?.organizationId ?? "new"}:${result.data.policy?.version ?? 0}`}
						data={result.data}
					/>
					{result.data.policy?.enabled ? (
						<IntendedDriverSettings data={result.data.intendedDrivers} />
					) : null}
				</>
			) : (
				<p role="alert">
					{t(
						"drivingLicence.loadError",
						"Driving licence control could not be loaded. Check your organization access.",
					)}
				</p>
			)}
			<DrivingLicenceReassignmentTasks />
			<div id="driving-verifier-settings" className="scroll-mt-6">
				<VerifierSettings />
			</div>
			<DrivingLicenceRetentionSettings />
		</div>
	);
}
async function RetentionOnlySettings() {
	const t = await getTranslate();
	return (
		<div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
			<h1 className="text-2xl font-semibold">
				{t("drivingLicence.title", "Driving licence control")}
			</h1>
			<Alert role="status">
				<IconInfoCircle aria-hidden="true" />
				<AlertTitle>
					{t("drivingLicence.off.title", "Driving licence control is off")}
				</AlertTitle>
				<AlertDescription>
					{t(
						"drivingLicence.off.description",
						"Nobody sees driving licence control and no reminders are sent. Intended drivers, verifier grants, check records and authorizations are kept, and evidence cleanup continues under the saved retention period. Only Retention & holds is available until it is switched on again.",
					)}
				</AlertDescription>
			</Alert>
			<DrivingLicenceRetentionSettings />
		</div>
	);
}
export default function DrivingLicenceSettingsPage() {
	return (
		<Suspense fallback={<div className="p-6" aria-busy="true" />}>
			<DrivingLicenceSettingsContent />
		</Suspense>
	);
}
