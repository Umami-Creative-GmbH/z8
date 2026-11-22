import type { team } from "@/db/schema";
import type { TeamPermissions } from "@/lib/authorization";
import {
	meetsSettingsAccess,
	type SettingsAccess,
} from "@/lib/organization-action/settings-access-level";

export type ScopedTeam = typeof team.$inferSelect & {
	canManageMembers: boolean;
	canManageSettings: boolean;
};

export interface TeamSettingsSurface {
	canAccessOrganizationAdminSurface: boolean;
	canCreateTeams: boolean;
	teams: ScopedTeam[];
}

export function canUseManagerScopedTeamSettings(settingsAccess: SettingsAccess | null): boolean {
	return meetsSettingsAccess(settingsAccess, "scopedManager");
}

export function getScopedTeamFlags(input: {
	settingsAccess: SettingsAccess | null;
	permissions: TeamPermissions;
	teamId: string;
}): Pick<ScopedTeam, "canManageMembers" | "canManageSettings"> {
	if (meetsSettingsAccess(input.settingsAccess, "orgAdmin")) {
		return {
			canManageMembers: true,
			canManageSettings: true,
		};
	}

	const teamPermissions = input.permissions.byTeamId.get(input.teamId);

	return {
		canManageMembers: Boolean(teamPermissions?.canManageTeamMembers),
		canManageSettings: Boolean(teamPermissions?.canManageTeamSettings),
	};
}

export function buildTeamSettingsSurface(input: {
	settingsAccess: SettingsAccess | null;
	teams: Array<typeof team.$inferSelect>;
	permissions: TeamPermissions;
}): TeamSettingsSurface {
	const canAccessOrganizationAdminSurface = meetsSettingsAccess(input.settingsAccess, "orgAdmin");
	const canCreateTeams = canAccessOrganizationAdminSurface;

	if (!canUseManagerScopedTeamSettings(input.settingsAccess)) {
		return {
			canAccessOrganizationAdminSurface: false,
			canCreateTeams: false,
			teams: [],
		};
	}

	const teams = input.teams.flatMap((currentTeam) => {
		const scopedTeam = {
			...currentTeam,
			...getScopedTeamFlags({
				settingsAccess: input.settingsAccess,
				permissions: input.permissions,
				teamId: currentTeam.id,
			}),
		};

		return canAccessOrganizationAdminSurface ||
			scopedTeam.canManageMembers ||
			scopedTeam.canManageSettings
			? [scopedTeam]
			: [];
	});

	return {
		canAccessOrganizationAdminSurface,
		canCreateTeams,
		teams,
	};
}

export function filterMembersForTeamSettingsSurface<
	T extends {
		employee: { id: string; teamId: string | null } | null;
		teamMemberships?: Array<{ teamId: string }>;
	},
>(input: {
	members: T[];
	manageableTeamIds: Set<string>;
	canAccessOrganizationAdminSurface: boolean;
}): T[] {
	if (input.canAccessOrganizationAdminSurface) {
		return input.members;
	}

	return input.members.filter(
		(entry) =>
			entry.teamMemberships?.some((membership) => input.manageableTeamIds.has(membership.teamId)) ||
			(entry.employee?.teamId && input.manageableTeamIds.has(entry.employee.teamId)),
	);
}

export function canReassignEmployeeWithinScope(input: {
	currentEmployeeTeamId: string | null;
	targetTeamId: string;
	manageableTeamIds: Set<string>;
}): boolean {
	if (input.currentEmployeeTeamId === null) {
		return true;
	}

	if (input.currentEmployeeTeamId === input.targetTeamId) {
		return true;
	}

	return input.manageableTeamIds.has(input.currentEmployeeTeamId);
}
