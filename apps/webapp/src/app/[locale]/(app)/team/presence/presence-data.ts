import "server-only";

import { db } from "@/db";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import {
	findWhoIsInLocation,
	listManagedEmployeeIds,
	listWhoIsInLocations,
	readLocationPresence,
	type WhoIsInLocation,
} from "@/lib/time-tracking/who-is-in/queries";
import {
	type LocationPresenceEntry,
	type WhoIsInScope,
	whoIsInScopeFor,
} from "@/lib/time-tracking/who-is-in/shape";

/**
 * The manager view of the who-is-in board (#863). Owners and admins see every
 * assigned employee of a location; managers only the employees they manage;
 * everyone else is refused. Always the session's active organization.
 */
export type WhoIsInViewer = { organizationId: string; userId: string; scope: WhoIsInScope };

export async function getWhoIsInViewer(): Promise<WhoIsInViewer | null> {
	const context = await getCurrentSettingsRouteContext();
	const organizationId = context?.authContext.session.activeOrganizationId;
	if (!context || !organizationId) return null;
	const currentEmployee = context.authContext.employee;
	const managedEmployeeIds =
		context.accessTier === "manager" && currentEmployee?.organizationId === organizationId
			? await listManagedEmployeeIds(db, {
					organizationId,
					managerEmployeeId: currentEmployee.id,
				})
			: [];
	const scope = whoIsInScopeFor({ accessTier: context.accessTier, managedEmployeeIds });
	if (scope.kind === "none") return null;
	return { organizationId, userId: context.authContext.user.id, scope };
}

export type WhoIsInLocationsResult =
	| { status: "ok"; viewer: WhoIsInViewer; locations: WhoIsInLocation[] }
	| { status: "forbidden" };

export async function getWhoIsInLocations(): Promise<WhoIsInLocationsResult> {
	const viewer = await getWhoIsInViewer();
	if (!viewer) return { status: "forbidden" };
	const locations = await listWhoIsInLocations(db, { organizationId: viewer.organizationId });
	return { status: "ok", viewer, locations };
}

export type LocationPresenceResult =
	| {
			status: "ok";
			viewer: WhoIsInViewer;
			location: WhoIsInLocation;
			entries: LocationPresenceEntry[];
	  }
	| { status: "forbidden" }
	| { status: "not_found" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getLocationPresence(locationId: string): Promise<LocationPresenceResult> {
	const viewer = await getWhoIsInViewer();
	if (!viewer) return { status: "forbidden" };
	if (!UUID.test(locationId)) return { status: "not_found" };
	const location = await findWhoIsInLocation(db, {
		organizationId: viewer.organizationId,
		locationId,
	});
	if (!location) return { status: "not_found" };
	const entries = await readLocationPresence(db, {
		organizationId: viewer.organizationId,
		locationId: location.id,
		scope: viewer.scope,
	});
	return { status: "ok", viewer, location, entries };
}
