import { and, asc, eq, ilike, inArray, or, type SQL, sql } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, employeeManagers, team } from "@/db/schema";
import type { SettingsAccessTier } from "@/lib/settings-access";
import type { AppSearchResult, LiveAppSearchResults } from "./types";

const LIVE_RESULT_LIMIT = 6;

export const EMPTY_LIVE_APP_SEARCH_RESULTS: LiveAppSearchResults = {
	employees: [],
	teams: [],
};

export interface EmployeeSearchRow {
	employeeId: string;
	firstName: string | null;
	lastName: string | null;
	name: string | null;
	email: string;
	image: string | null;
	gender: "male" | "female" | "other" | null;
	position: string | null;
	teamName: string | null;
}

export interface TeamSearchRow {
	teamId: string;
	name: string;
	description: string | null;
}

export interface TeamSearchPermission {
	canManageTeamMembers: boolean;
	canManageTeamSettings: boolean;
}

export interface SearchLiveAppResultsInput {
	query: string;
	accessTier: SettingsAccessTier;
	organizationId: string | null;
	currentEmployeeId: string | null;
	permissionsByTeamId: Map<string, TeamSearchPermission>;
}

export function normalizeAppSearchQuery(query: string): string | null {
	const normalizedQuery = query.trim();

	return normalizedQuery.length >= 2 ? normalizedQuery : null;
}

function compactParts(parts: Array<string | null | undefined>): string | undefined {
	const compactedParts = parts
		.map((part) => part?.trim())
		.filter((part): part is string => Boolean(part));

	return compactedParts.length > 0 ? compactedParts.join(" · ") : undefined;
}

function compactName(parts: Array<string | null | undefined>): string | undefined {
	const compactedParts = parts
		.map((part) => part?.trim())
		.filter((part): part is string => Boolean(part));

	return compactedParts.length > 0 ? compactedParts.join(" ") : undefined;
}

export function mapEmployeeSearchRow(row: EmployeeSearchRow): AppSearchResult {
	const fullName = compactName([row.firstName, row.lastName]);
	const title = fullName ?? row.name?.trim() ?? row.email;

	return {
		type: "employee",
		id: `employee-${row.employeeId}`,
		title,
		subtitle: compactParts([row.position, row.teamName, row.email]),
		href: `/settings/employees/${row.employeeId}`,
		image: row.image,
		avatarSeed: row.employeeId,
		gender: row.gender,
	};
}

export function mapTeamSearchRow(row: TeamSearchRow): AppSearchResult {
	return {
		type: "team",
		id: `team-${row.teamId}`,
		title: row.name,
		subtitle: row.description?.trim() || undefined,
		href: `/settings/teams/${row.teamId}`,
	};
}

export function buildEmployeeSearchConditions({
	accessTier,
	organizationId,
	currentEmployeeId,
}: {
	accessTier: SettingsAccessTier;
	organizationId: string;
	currentEmployeeId: string | null;
}): SQL[] | null {
	if (accessTier === "member") {
		return null;
	}

	const organizationCondition = eq(employee.organizationId, organizationId);

	if (accessTier === "orgAdmin") {
		return [organizationCondition];
	}

	if (!currentEmployeeId) {
		return null;
	}

	return [
		organizationCondition,
		sql`exists (select 1 from ${employeeManagers} where ${employeeManagers.employeeId} = ${employee.id} and ${employeeManagers.managerId} = ${currentEmployeeId})`,
	];
}

export function getSearchableTeamIds({
	accessTier,
	teams,
	permissionsByTeamId,
}: {
	accessTier: SettingsAccessTier;
	teams: Array<{ id: string }>;
	permissionsByTeamId: Map<string, TeamSearchPermission>;
}): string[] {
	if (accessTier === "orgAdmin") {
		return teams.map((currentTeam) => currentTeam.id);
	}

	if (accessTier !== "manager") {
		return [];
	}

	return teams.flatMap((currentTeam) => {
		const permission = permissionsByTeamId.get(currentTeam.id);

		return permission?.canManageTeamMembers || permission?.canManageTeamSettings
			? [currentTeam.id]
			: [];
	});
}

export async function searchLiveAppResults(
	input: SearchLiveAppResultsInput,
): Promise<LiveAppSearchResults> {
	const normalizedQuery = normalizeAppSearchQuery(input.query);
	const organizationId = input.organizationId;

	if (!normalizedQuery || !organizationId) {
		return EMPTY_LIVE_APP_SEARCH_RESULTS;
	}

	const searchPattern = `%${normalizedQuery}%`;
	const employeeConditions = buildEmployeeSearchConditions({
		accessTier: input.accessTier,
		organizationId,
		currentEmployeeId: input.currentEmployeeId,
	});
	const searchablePermissionTeamIds = getSearchableTeamIds({
		accessTier: input.accessTier,
		teams: [...input.permissionsByTeamId.keys()].map((id) => ({ id })),
		permissionsByTeamId: input.permissionsByTeamId,
	});
	const canSearchTeams = input.accessTier === "orgAdmin" || searchablePermissionTeamIds.length > 0;

	const [employeeRows, teamRows] = await Promise.all([
		employeeConditions
			? db
					.select({
						employeeId: employee.id,
						firstName: user.firstName,
						lastName: user.lastName,
						name: user.name,
						email: user.email,
						image: user.image,
						gender: employee.gender,
						position: employee.position,
						teamName: team.name,
					})
					.from(employee)
					.innerJoin(user, eq(employee.userId, user.id))
					.leftJoin(team, eq(employee.teamId, team.id))
					.where(
						and(
							...employeeConditions,
							eq(employee.isActive, true),
							or(
								ilike(user.firstName, searchPattern),
								ilike(user.lastName, searchPattern),
								ilike(employee.position, searchPattern),
								ilike(user.name, searchPattern),
								ilike(user.email, searchPattern),
								ilike(team.name, searchPattern),
							),
						),
					)
					.orderBy(asc(user.firstName), asc(user.lastName), asc(user.email))
					.limit(LIVE_RESULT_LIMIT)
			: Promise.resolve([]),
		canSearchTeams
			? db
					.select({
						teamId: team.id,
						name: team.name,
						description: team.description,
					})
					.from(team)
					.where(
						and(
							eq(team.organizationId, organizationId),
							input.accessTier === "manager"
								? inArray(team.id, searchablePermissionTeamIds)
								: undefined,
							or(ilike(team.name, searchPattern), ilike(team.description, searchPattern)),
						),
					)
					.orderBy(asc(team.name))
					.limit(LIVE_RESULT_LIMIT)
			: Promise.resolve([]),
	]);

	const searchableTeamIds = new Set(
		getSearchableTeamIds({
			accessTier: input.accessTier,
			teams: teamRows.map((row) => ({ id: row.teamId })),
			permissionsByTeamId: input.permissionsByTeamId,
		}),
	);

	return {
		employees: employeeRows.map(mapEmployeeSearchRow),
		teams: teamRows.flatMap((row) =>
			input.accessTier === "orgAdmin" || searchableTeamIds.has(row.teamId)
				? [mapTeamSearchRow(row)]
				: [],
		),
	};
}
