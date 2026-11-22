import { Suspense } from "react";
import { DrivingLicenceVerifierWorklist } from "@/components/driving-licence/check-worklist";
import { OperationalDrivingStatusPanel } from "@/components/driving-licence/operational-status";
import {
	DrivingLicencePageLoading,
	DrivingLicencePageScope,
} from "@/components/driving-licence/page-scope";
import { DrivingLicencePersonalReminderTasks } from "@/components/driving-licence/reminder-tasks";
import { DrivingLicenceTeamTabs } from "@/components/driving-licence/role-tabs";
import { VerifierResponsibility } from "@/components/driving-licence/verifier-settings";
import { requireTeamDrivingLicencePage } from "@/lib/organization/driving-licence/page-guards";

/**
 * Team & organization → Driving licences (#1937): the verifier's Checks and the planner's
 * Planning, one tab per role held. Not found while the feature is off or without either role;
 * administering the settings grants neither.
 */
async function TeamDrivingLicenceContent() {
	const { actor, visibility, roles } = await requireTeamDrivingLicencePage();
	const identity = `${actor.organizationId}:${actor.userId}`;
	return (
		<DrivingLicencePageScope
			kind="team"
			organizationId={actor.organizationId}
			userId={actor.userId}
		>
			<DrivingLicenceTeamTabs
				key={identity}
				roles={roles}
				panels={{
					checks: roles.checks && (
						<div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
							<DrivingLicenceVerifierWorklist
								key={identity}
								emptyGuidance={{
									canAssignIntendedDrivers: visibility.settings === "full",
									selfIsIntendedDriver: visibility.intendedDriver,
								}}
							/>
							<div className="min-w-0 space-y-6">
								<DrivingLicencePersonalReminderTasks key={`tasks:${identity}`} />
								<VerifierResponsibility />
							</div>
						</div>
					),
					planning: roles.planning && <OperationalDrivingStatusPanel />,
				}}
			/>
		</DrivingLicencePageScope>
	);
}

export default function TeamDrivingLicencePage() {
	return (
		<Suspense fallback={<DrivingLicencePageLoading kind="team" />}>
			<TeamDrivingLicenceContent />
		</Suspense>
	);
}
