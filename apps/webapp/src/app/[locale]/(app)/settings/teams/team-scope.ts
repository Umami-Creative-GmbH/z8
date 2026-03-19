import type { TeamPermissions } from "@/lib/authorization";
import type { team } from "@/db/schema";
import type { SettingsAccessTier } from "@/lib/settings-access";

export type ScopedTeam = typeof team.$inferSelect & {
	canManageMembers: boolean;
	canManageSettings: boolean;
};

export interface TeamSettingsSurface {
	canAccessOrganizationAdminSurface: boolean;
	canCreateTeams: boolean;
	teams: ScopedTeam[];
}

export function canUseManagerScopedTeamSettings(accessTier: SettingsAccessTier): boolean {
	return accessTier === "manager" || accessTier === "orgAdmin";
}

export function getScopedTeamFlags(input: {
	accessTier: SettingsAccessTier;
	permissions: TeamPermissions;
	teamId: string;
}): Pick<ScopedTeam, "canManageMembers" | "canManageSettings"> {
	if (input.accessTier === "orgAdmin") {
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
	accessTier: SettingsAccessTier;
	teams: Array<typeof team.$inferSelect>;
	permissions: TeamPermissions;
}): TeamSettingsSurface {
	const canAccessOrganizationAdminSurface = input.accessTier === "orgAdmin";
	const canCreateTeams = canAccessOrganizationAdminSurface;

	if (!canUseManagerScopedTeamSettings(input.accessTier)) {
		return {
			canAccessOrganizationAdminSurface: false,
			canCreateTeams: false,
			teams: [],
		};
	}

	const teams = input.teams
		.map((currentTeam) => ({
			...currentTeam,
			...getScopedTeamFlags({
				accessTier: input.accessTier,
				permissions: input.permissions,
				teamId: currentTeam.id,
			}),
		}))
		.filter(
			(currentTeam) =>
				canAccessOrganizationAdminSurface ||
				currentTeam.canManageMembers ||
				currentTeam.canManageSettings,
		);

	return {
		canAccessOrganizationAdminSurface,
		canCreateTeams,
		teams,
	};
}

export function filterMembersForTeamSettingsSurface<T extends { employee: { teamId: string | null } | null }>(
	input: {
		members: T[];
		manageableTeamIds: Set<string>;
		canAccessOrganizationAdminSurface: boolean;
	},
): T[] {
	if (input.canAccessOrganizationAdminSurface) {
		return input.members;
	}

	return input.members.filter(
		(entry) => entry.employee?.teamId && input.manageableTeamIds.has(entry.employee.teamId),
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
