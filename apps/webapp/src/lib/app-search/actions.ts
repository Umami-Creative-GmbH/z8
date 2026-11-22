"use server";

import {
	EMPTY_LIVE_APP_SEARCH_RESULTS,
	searchLiveAppResults,
	type TeamSearchPermission,
} from "@/lib/app-search/live-results";
import type { LiveAppSearchResults } from "@/lib/app-search/types";
import { getCurrentSettingsAccess, getPrincipalContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";

const EMPTY_RESULTS: LiveAppSearchResults = EMPTY_LIVE_APP_SEARCH_RESULTS;

export async function searchAppRecordsAction(
	query: string,
): Promise<ServerActionResult<LiveAppSearchResults>> {
	try {
		const [principal, settingsAccessCaller] = await Promise.all([
			getPrincipalContext(),
			getCurrentSettingsAccess(),
		]);
		const settingsAccess = settingsAccessCaller?.settingsAccess ?? null;

		if (!principal?.activeOrganizationId || !settingsAccess) {
			return { success: true, data: EMPTY_RESULTS };
		}

		const permissionsByTeamId = new Map<string, TeamSearchPermission>();

		for (const [teamId, permission] of principal.permissions.byTeamId.entries()) {
			permissionsByTeamId.set(teamId, {
				canManageTeamMembers: Boolean(permission.canManageTeamMembers),
				canManageTeamSettings: Boolean(permission.canManageTeamSettings),
			});
		}

		const data = await searchLiveAppResults({
			query,
			settingsAccess,
			organizationId: principal.activeOrganizationId,
			currentEmployeeId: principal.employee?.id ?? null,
			permissionsByTeamId,
		});

		return { success: true, data };
	} catch {
		return {
			success: false,
			error: "Could not load people or teams",
			data: EMPTY_RESULTS,
		} as ServerActionResult<LiveAppSearchResults>;
	}
}
