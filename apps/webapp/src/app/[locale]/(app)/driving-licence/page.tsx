import { Suspense } from "react";
import { DrivingLicenceEvidence } from "@/components/driving-licence/check-evidence";
import { DrivingLicenceVerifierWorklist } from "@/components/driving-licence/check-worklist";
import { DrivingLicenceHistoryPanel } from "@/components/driving-licence/history-panel";
import { OperationalDrivingStatusPanel } from "@/components/driving-licence/operational-status";
import { DrivingLicencePersonalReminderTasks } from "@/components/driving-licence/reminder-tasks";
import { ReportDrivingImpediment } from "@/components/driving-licence/report-impediment";
import { VerifierResponsibility } from "@/components/driving-licence/verifier-settings";
import { getDrivingLicenceEmployeeRecordAction } from "@/lib/organization/driving-licence/check-actions";
import { requireDrivingLicencePage } from "@/lib/organization/driving-licence/page-guards";
import { getTranslate } from "@/tolgee/server";

/** Not found while the feature is off or the viewer holds no driving licence role (#1420). */
async function OwnDrivingLicenceContent() {
	const [{ actor }, t] = await Promise.all([
		requireDrivingLicencePage(),
		getTranslate(),
	]);
	const record = actor.employeeId
		? await getDrivingLicenceEmployeeRecordAction({
				employeeId: actor.employeeId,
			})
		: null;
	return (
		<div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
			<h1 className="text-2xl font-semibold">
				{t("drivingLicence.myTitle", "My driving authorization")}
			</h1>
			{record?.success ? (
				<>
					<DrivingLicenceEvidence record={record.data} />
					{actor.employeeId && (
						<DrivingLicenceHistoryPanel
							key={`${actor.organizationId}:${actor.userId}:${actor.employeeId}`}
							employeeId={actor.employeeId}
						/>
					)}
					{record.data.enrolled && (
						<ReportDrivingImpediment
							key={`${actor.organizationId}:${actor.userId}`}
						/>
					)}
				</>
			) : (
				<p role="status">
					{t(
						"drivingLicence.noEmployeeRecord",
						"No employee driving licence record is available in this organization.",
					)}
				</p>
			)}
			<OperationalDrivingStatusPanel />
			<VerifierResponsibility />
			<DrivingLicencePersonalReminderTasks
				key={`tasks:${actor.organizationId}:${actor.userId}`}
			/>
			<DrivingLicenceVerifierWorklist
				key={`${actor.organizationId}:${actor.userId}`}
			/>
		</div>
	);
}
export default function OwnDrivingLicencePage() {
	return (
		<Suspense fallback={<div className="p-6" aria-busy="true" />}>
			<OwnDrivingLicenceContent />
		</Suspense>
	);
}
