import { Suspense } from "react";
import { MyDrivingLicence } from "@/components/driving-licence/my-licence";
import {
	DrivingLicencePageLoading,
	DrivingLicencePageScope,
	DrivingLicencePageTitle,
} from "@/components/driving-licence/page-scope";
import { PageHeader } from "@/components/ui/page-header";
import { getDrivingLicenceEmployeeRecordAction } from "@/lib/organization/driving-licence/check-actions";
import { requireMyDrivingLicencePage } from "@/lib/organization/driving-licence/page-guards";
import { getTranslate } from "@/tolgee/server";

/**
 * My driving licence (#1428, #1937): the viewer's own class status, evidence, history and
 * *Unable to drive?*. Not found while the feature is off, or unless the viewer is an intended
 * driver or still has their own retained check records. Verifiers and planners work under
 * Team & organization → Driving licences.
 */
async function MyDrivingLicenceContent() {
	const [{ actor, visibility, employeeId }, t] = await Promise.all([
		requireMyDrivingLicencePage(),
		getTranslate(),
	]);
	const record = await getDrivingLicenceEmployeeRecordAction({ employeeId });
	const identity = `${actor.organizationId}:${actor.userId}`;
	return (
		<DrivingLicencePageScope
			kind="my"
			organizationId={actor.organizationId}
			userId={actor.userId}
		>
			<div className="page-frame flex min-w-0 flex-col gap-6">
				<PageHeader title={<DrivingLicencePageTitle kind="my" />} />
				{record.success ? (
					<MyDrivingLicence
						key={`${identity}:${employeeId}`}
						record={record.data}
						employeeId={employeeId}
						intendedDriver={visibility.intendedDriver}
					/>
				) : (
					<p role="status">
						{t(
							"drivingLicence.noEmployeeRecord",
							"No employee driving licence record is available in this organization.",
						)}
					</p>
				)}
			</div>
		</DrivingLicencePageScope>
	);
}

export default function MyDrivingLicencePage() {
	return (
		<Suspense fallback={<DrivingLicencePageLoading kind="my" />}>
			<MyDrivingLicenceContent />
		</Suspense>
	);
}
