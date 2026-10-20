import { Suspense } from "react";
import { DrivingLicenceVerifierWorklist } from "@/components/driving-licence/check-worklist";
import { MyDrivingLicence } from "@/components/driving-licence/my-licence";
import { OperationalDrivingStatusPanel } from "@/components/driving-licence/operational-status";
import { DrivingLicencePersonalReminderTasks } from "@/components/driving-licence/reminder-tasks";
import { DrivingLicenceRoleTabs } from "@/components/driving-licence/role-tabs";
import { VerifierResponsibility } from "@/components/driving-licence/verifier-settings";
import { getDrivingLicenceEmployeeRecordAction } from "@/lib/organization/driving-licence/check-actions";
import { requireDrivingLicencePage } from "@/lib/organization/driving-licence/page-guards";
import { getTranslate } from "@/tolgee/server";

/**
 * Not found while the feature is off or the viewer holds no driving licence role (#1420).
 * One tab per role the visibility reader grants (#1428); only held roles are rendered.
 */
async function DrivingLicenceContent() {
	const [{ actor, visibility, roles }, t] = await Promise.all([
		requireDrivingLicencePage(),
		getTranslate(),
	]);
	const record =
		roles.myLicence && actor.employeeId
			? await getDrivingLicenceEmployeeRecordAction({
					employeeId: actor.employeeId,
				})
			: null;
	const identity = `${actor.organizationId}:${actor.userId}`;
	return (
		<DrivingLicenceRoleTabs
			roles={roles}
			panels={{
				myLicence:
					roles.myLicence &&
					(record?.success && actor.employeeId ? (
						<MyDrivingLicence
							key={`${identity}:${actor.employeeId}`}
							record={record.data}
							employeeId={actor.employeeId}
							intendedDriver={visibility.intendedDriver}
						/>
					) : (
						<p role="status">
							{t(
								"drivingLicence.noEmployeeRecord",
								"No employee driving licence record is available in this organization.",
							)}
						</p>
					)),
				checks: roles.checks && (
					<div className="space-y-6">
						<VerifierResponsibility />
						<DrivingLicencePersonalReminderTasks key={`tasks:${identity}`} />
						<DrivingLicenceVerifierWorklist key={identity} />
					</div>
				),
				planning: roles.planning && <OperationalDrivingStatusPanel />,
			}}
		/>
	);
}
export default function DrivingLicencePage() {
	return (
		<Suspense fallback={<div className="p-6" aria-busy="true" />}>
			<DrivingLicenceContent />
		</Suspense>
	);
}
