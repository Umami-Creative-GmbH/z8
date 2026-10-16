import { Suspense } from "react";
import { DrivingLicenceSettings } from "@/components/driving-licence/policy-settings";
import { DrivingLicenceReassignmentTasks } from "@/components/driving-licence/reminder-tasks";
import { VerifierSettings } from "@/components/driving-licence/verifier-settings";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getDrivingLicenceAdminDataAction } from "@/lib/organization/driving-licence/policy-actions";
import { getTranslate } from "@/tolgee/server";

async function DrivingLicenceSettingsContent() {
	await requireOrgAdminSettingsAccess();
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
				<DrivingLicenceSettings
					key={`${result.data.policy?.organizationId ?? "new"}:${result.data.policy?.version ?? 0}:${result.data.participants.map((p) => p.employeeId).join(",")}`}
					data={result.data}
				/>
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
