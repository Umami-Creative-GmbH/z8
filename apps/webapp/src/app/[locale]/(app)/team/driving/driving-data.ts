import "server-only";

import { db } from "@/db";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import {
	drivingDetailsTeamScope,
	loadTeamDrivingDetails,
	type TeamDrivingDetails,
} from "@/lib/time-tracking/vehicle-use/driving-details-team-store";

export type TeamDrivingDetailsResult =
	| { status: "ok"; scope: "all" | "managed"; details: TeamDrivingDetails }
	| { status: "forbidden" };

/**
 * The work showing "driving details missing" (#1127) for the session's active organization:
 * owners and admins see every employee's, managers the employees they manage; everyone else is
 * refused.
 */
export async function getTeamDrivingDetails(
	filters: {
		teamId: string | null;
		employeeId: string | null;
	},
	expected?: { userId: string; organizationId: string },
): Promise<TeamDrivingDetailsResult> {
	const caller = await getCurrentSettingsAccess();
	if (!caller) return { status: "forbidden" };
	const organizationId = caller.organizationId;
	// Display scope is a consistency check, never an authorization input.
	if (expected && (expected.userId !== caller.userId || expected.organizationId !== organizationId))
		return { status: "forbidden" };
	const scope = drivingDetailsTeamScope({
		settingsAccess: caller.settingsAccess,
		organizationId,
		employee: caller.employee ? { id: caller.employee.id, organizationId } : null,
	});
	if (!scope) return { status: "forbidden" };
	const details = await loadTeamDrivingDetails(db, { organizationId, scope, filters });
	return { status: "ok", scope: scope.kind, details };
}
