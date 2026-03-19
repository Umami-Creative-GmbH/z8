import { describe, expect, it } from "vitest";
import {
	buildTeamSettingsSurface,
	canReassignEmployeeWithinScope,
	filterMembersForTeamSettingsSurface,
} from "./team-scope";

const TEAM_ALPHA = {
	id: "team-alpha",
	organizationId: "org-1",
	name: "Alpha",
	description: null,
	createdAt: new Date(),
	updatedAt: new Date(),
};

const TEAM_BRAVO = {
	id: "team-bravo",
	organizationId: "org-1",
	name: "Bravo",
	description: null,
	createdAt: new Date(),
	updatedAt: new Date(),
};

describe("team scope helpers", () => {
	it("limits manager surfaces to teams covered by scoped team permissions", () => {
		const surface = buildTeamSettingsSurface({
			accessTier: "manager",
			teams: [TEAM_ALPHA, TEAM_BRAVO],
			permissions: {
				orgWide: null,
				byTeamId: new Map([
					[
						TEAM_ALPHA.id,
						{
							canCreateTeams: false,
							canManageTeamMembers: true,
							canManageTeamSettings: false,
							canApproveTeamRequests: false,
						},
					],
				]),
			},
		});

		expect(surface.canAccessOrganizationAdminSurface).toBe(false);
		expect(surface.canCreateTeams).toBe(false);
		expect(surface.teams).toEqual([
			expect.objectContaining({
				id: TEAM_ALPHA.id,
				canManageMembers: true,
				canManageSettings: false,
			}),
		]);
	});

	it("keeps org admins fully enabled across all teams", () => {
		const surface = buildTeamSettingsSurface({
			accessTier: "orgAdmin",
			teams: [TEAM_ALPHA, TEAM_BRAVO],
			permissions: {
				orgWide: null,
				byTeamId: new Map(),
			},
		});

		expect(surface.canAccessOrganizationAdminSurface).toBe(true);
		expect(surface.canCreateTeams).toBe(true);
		expect(surface.teams).toEqual([
			expect.objectContaining({ id: TEAM_ALPHA.id, canManageMembers: true, canManageSettings: true }),
			expect.objectContaining({ id: TEAM_BRAVO.id, canManageMembers: true, canManageSettings: true }),
		]);
	});

	it("blocks moving employees out of teams the manager cannot manage", () => {
		expect(
			canReassignEmployeeWithinScope({
				currentEmployeeTeamId: TEAM_BRAVO.id,
				targetTeamId: TEAM_ALPHA.id,
				manageableTeamIds: new Set([TEAM_ALPHA.id]),
			}),
		).toBe(false);

		expect(
			canReassignEmployeeWithinScope({
				currentEmployeeTeamId: TEAM_ALPHA.id,
				targetTeamId: TEAM_ALPHA.id,
				manageableTeamIds: new Set([TEAM_ALPHA.id]),
			}),
		).toBe(true);

		expect(
			canReassignEmployeeWithinScope({
				currentEmployeeTeamId: null,
				targetTeamId: TEAM_ALPHA.id,
				manageableTeamIds: new Set([TEAM_ALPHA.id]),
			}),
		).toBe(true);
	});

	it("does not let managers create teams even with org-wide create permissions", () => {
		const surface = buildTeamSettingsSurface({
			accessTier: "manager",
			teams: [TEAM_ALPHA],
			permissions: {
				orgWide: {
					canCreateTeams: true,
					canManageTeamMembers: false,
					canManageTeamSettings: false,
					canApproveTeamRequests: false,
				},
				byTeamId: new Map(),
			},
		});

		expect(surface.canCreateTeams).toBe(false);
	});

	it("ignores org-wide team permissions for managers and keeps them scoped to explicit teams", () => {
		const surface = buildTeamSettingsSurface({
			accessTier: "manager",
			teams: [TEAM_ALPHA, TEAM_BRAVO],
			permissions: {
				orgWide: {
					canCreateTeams: false,
					canManageTeamMembers: true,
					canManageTeamSettings: true,
					canApproveTeamRequests: false,
				},
				byTeamId: new Map([
					[
						TEAM_ALPHA.id,
						{
							canCreateTeams: false,
							canManageTeamMembers: true,
							canManageTeamSettings: false,
							canApproveTeamRequests: false,
						},
					],
				]),
			},
		});

		expect(surface.teams).toEqual([
			expect.objectContaining({
				id: TEAM_ALPHA.id,
				canManageMembers: true,
				canManageSettings: false,
			}),
		]);
	});

	it("keeps non-manager employees out of the scoped team surface even with granted team permissions", () => {
		const surface = buildTeamSettingsSurface({
			accessTier: "member",
			teams: [TEAM_ALPHA],
			permissions: {
				orgWide: null,
				byTeamId: new Map([
					[
						TEAM_ALPHA.id,
						{
							canCreateTeams: false,
							canManageTeamMembers: true,
							canManageTeamSettings: true,
							canApproveTeamRequests: false,
						},
					],
				]),
			},
		});

		expect(surface.canAccessOrganizationAdminSurface).toBe(false);
		expect(surface.canCreateTeams).toBe(false);
		expect(surface.teams).toEqual([]);
	});

	it("filters loaded members down to scoped teams for managers", () => {
		const allMembers = [
			{ user: { id: "u-1" }, employee: { id: "e-1", teamId: TEAM_ALPHA.id } },
			{ user: { id: "u-2" }, employee: { id: "e-2", teamId: TEAM_BRAVO.id } },
			{ user: { id: "u-3" }, employee: null },
		] as Array<{ user: { id: string }; employee: { id: string; teamId: string | null } | null }>;

		expect(
			filterMembersForTeamSettingsSurface({
				members: allMembers,
				manageableTeamIds: new Set([TEAM_ALPHA.id]),
				canAccessOrganizationAdminSurface: false,
			}),
		).toEqual([allMembers[0]]);

		expect(
			filterMembersForTeamSettingsSurface({
				members: allMembers,
				manageableTeamIds: new Set([TEAM_ALPHA.id]),
				canAccessOrganizationAdminSurface: true,
			}),
		).toEqual(allMembers);
	});
});
