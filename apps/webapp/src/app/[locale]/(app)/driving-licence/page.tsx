import { Suspense } from "react";
import { DrivingLicenceEvidence } from "@/components/driving-licence/check-evidence";
import { DrivingLicenceVerifierWorklist } from "@/components/driving-licence/check-worklist";
import { DrivingLicenceHistoryPanel } from "@/components/driving-licence/history-panel";
import { VerifierResponsibility } from "@/components/driving-licence/verifier-settings";
import { getDrivingLicenceEmployeeRecordAction } from "@/lib/organization/driving-licence/check-actions";
import { requireDrivingLicenceActor } from "@/lib/organization/driving-licence/context";
import { getTranslate } from "@/tolgee/server";

async function OwnDrivingLicenceContent() {
	const [actor, t] = await Promise.all([
		requireDrivingLicenceActor(),
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
				</>
			) : (
				<p role="status">
					{t(
						"drivingLicence.noEmployeeRecord",
						"No employee driving licence record is available in this organization.",
					)}
				</p>
			)}
			<VerifierResponsibility />
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
