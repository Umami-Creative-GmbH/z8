import "server-only";

import { db } from "@/db";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
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
export async function getTeamDrivingDetails(filters: {
	teamId: string | null;
	employeeId: string | null;
}): Promise<TeamDrivingDetailsResult> {
	const context = await getCurrentSettingsRouteContext();
	const organizationId = context?.authContext.session.activeOrganizationId;
	if (!context || !organizationId) return { status: "forbidden" };
	const scope = drivingDetailsTeamScope({
		accessTier: context.accessTier,
		organizationId,
		employee: context.authContext.employee ?? null,
	});
	if (!scope) return { status: "forbidden" };
	const details = await loadTeamDrivingDetails(db, { organizationId, scope, filters });
	return { status: "ok", scope: scope.kind, details };
}
