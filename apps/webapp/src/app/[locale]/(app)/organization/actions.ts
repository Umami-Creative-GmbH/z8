"use server";

import { Effect } from "effect";
import { getRequestSession } from "@/lib/auth/request-session";
import {
	AuthenticationError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import {
	type DatabaseClient,
	DatabaseService,
} from "@/lib/effect/services/database.service";
import {
	countCurrentRoster,
	countUnplacedPeople,
	findCurrentRosterViewer,
	loadCurrentRosterPeople,
	loadCurrentRosterPeopleWithPaths,
	loadCurrentTeamMemberIds,
	loadOrgExplorerTeams,
	loadReportingLineRootIds,
	loadUnplacedPeopleIds,
	searchCurrentRoster,
} from "./org-explorer-queries";
import {
	ORG_EXPLORER_BATCH_LIMIT,
	type OrgExplorerData,
	type OrgExplorerGroup,
	type OrgExplorerPerson,
	type OrgExplorerSearchResult,
	SMALL_ORG_EMPLOYEE_LIMIT,
} from "./org-explorer-types";

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Org Explorer's first load. A small organization gets its whole current
 * roster. A large one gets the top two levels of reporting lines, the viewer's
 * own path and the team leads, and loads the rest on demand.
 */
export async function getOrgExplorerData(): Promise<
	ServerActionResult<OrgExplorerData>
> {
	const effect = Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const { organizationId, viewerEmployeeId } =
			yield* resolveOrgExplorerViewer(dbService);

		return yield* dbService.query("orgExplorer.loadData", () =>
			loadOrgExplorerData(dbService.db, organizationId, viewerEmployeeId),
		);
	});

	return runServerActionSafe(effect);
}

/** People by id, and with `withPaths` everyone on their reporting lines up to the top. */
export async function getOrgExplorerPeople(
	employeeIds: string[],
	options: { withPaths?: boolean } = {},
): Promise<ServerActionResult<OrgExplorerPerson[]>> {
	const effect = Effect.gen(function* () {
		const ids = yield* validIds(employeeIds);
		const dbService = yield* DatabaseService;
		const { organizationId } = yield* resolveOrgExplorerViewer(dbService);

		return yield* dbService.query("orgExplorer.loadPeople", () =>
			options.withPaths
				? loadCurrentRosterPeopleWithPaths(dbService.db, organizationId, ids)
				: loadCurrentRosterPeople(dbService.db, organizationId, ids),
		);
	});

	return runServerActionSafe(effect);
}

/** The current members of teams, with their paths to the top so the filter can show them. */
export async function getOrgExplorerTeamMembers(
	teamIds: string[],
): Promise<ServerActionResult<OrgExplorerPerson[]>> {
	const effect = Effect.gen(function* () {
		const ids = yield* validIds(teamIds);
		const dbService = yield* DatabaseService;
		const { organizationId } = yield* resolveOrgExplorerViewer(dbService);

		return yield* dbService.query("orgExplorer.loadTeamMembers", async () => {
			const memberIds = await loadCurrentTeamMemberIds(
				dbService.db,
				organizationId,
				ids,
			);
			return loadCurrentRosterPeopleWithPaths(
				dbService.db,
				organizationId,
				memberIds,
			);
		});
	});

	return runServerActionSafe(effect);
}

/**
 * The people with no reporting line, or with no team membership. People without
 * a team can still have managers, so their paths to the top come along.
 */
export async function getOrgExplorerGroup(
	group: OrgExplorerGroup,
): Promise<ServerActionResult<OrgExplorerPerson[]>> {
	const effect = Effect.gen(function* () {
		if (group !== "noReportingLine" && group !== "noTeam") {
			return yield* Effect.fail(
				new ValidationError({
					message: "Unknown people group",
					field: "group",
				}),
			);
		}
		const dbService = yield* DatabaseService;
		const { organizationId } = yield* resolveOrgExplorerViewer(dbService);

		return yield* dbService.query("orgExplorer.loadGroup", async () => {
			const ids = await loadUnplacedPeopleIds(
				dbService.db,
				organizationId,
				group,
			);
			return loadCurrentRosterPeopleWithPaths(
				dbService.db,
				organizationId,
				ids,
			);
		});
	});

	return runServerActionSafe(effect);
}

export async function searchOrgEmployees(
	query: string,
): Promise<ServerActionResult<OrgExplorerSearchResult[]>> {
	const trimmedQuery = typeof query === "string" ? query.trim() : "";
	if (trimmedQuery.length < 2) {
		return { success: true, data: [] };
	}

	const effect = Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const { organizationId } = yield* resolveOrgExplorerViewer(dbService);

		return yield* dbService.query("orgExplorer.search", () =>
			searchCurrentRoster(dbService.db, organizationId, trimmedQuery),
		);
	});

	return runServerActionSafe(effect);
}

async function loadOrgExplorerData(
	db: DatabaseClient,
	organizationId: string,
	viewerEmployeeId: string,
): Promise<OrgExplorerData> {
	const [employeeCount, teams] = await Promise.all([
		countCurrentRoster(db, organizationId),
		loadOrgExplorerTeams(db, organizationId),
	]);

	if (employeeCount < SMALL_ORG_EMPLOYEE_LIMIT) {
		const people = await loadCurrentRosterPeople(db, organizationId, "all");
		return {
			complete: true,
			employeeCount,
			viewerEmployeeId,
			teams,
			people,
			rootIds: people
				.filter(
					(entry) =>
						entry.managerIds.length === 0 && entry.reportIds.length > 0,
				)
				.map((entry) => entry.employeeId),
			noReportingLineCount: people.filter(
				(entry) =>
					entry.managerIds.length === 0 && entry.reportIds.length === 0,
			).length,
			noTeamCount: people.filter((entry) => entry.teamIds.length === 0).length,
		};
	}

	const [rootIds, unplaced, viewerPath] = await Promise.all([
		loadReportingLineRootIds(db, organizationId),
		countUnplacedPeople(db, organizationId),
		loadCurrentRosterPeopleWithPaths(db, organizationId, [viewerEmployeeId]),
	]);
	const loaded = new Map(viewerPath.map((entry) => [entry.employeeId, entry]));
	const load = async (ids: string[]) => {
		const missing = [...new Set(ids)].filter((id) => !loaded.has(id));
		for (const entry of await loadCurrentRosterPeople(
			db,
			organizationId,
			missing,
		)) {
			loaded.set(entry.employeeId, entry);
		}
		return ids.flatMap((id) => loaded.get(id) ?? []);
	};

	// The two levels below the top open by default.
	const roots = await load(rootIds);
	const firstLevel = await load(roots.flatMap((entry) => entry.lineReportIds));
	await load(firstLevel.flatMap((entry) => entry.lineReportIds));
	await load(
		teams.flatMap((entry) =>
			entry.leadEmployeeId ? [entry.leadEmployeeId] : [],
		),
	);

	return {
		complete: false,
		employeeCount,
		viewerEmployeeId,
		teams,
		people: [...loaded.values()],
		rootIds,
		...unplaced,
	};
}

function validIds(ids: unknown) {
	if (!Array.isArray(ids) || ids.length > ORG_EXPLORER_BATCH_LIMIT) {
		return Effect.fail(
			new ValidationError({
				message: `Request at most ${ORG_EXPLORER_BATCH_LIMIT} ids at a time`,
				field: "ids",
			}),
		);
	}
	return Effect.succeed([
		...new Set(
			ids.filter(
				(id): id is string => typeof id === "string" && UUID_PATTERN.test(id),
			),
		),
	]);
}

function resolveOrgExplorerViewer(dbService: typeof DatabaseService.Service) {
	return Effect.gen(function* () {
		const session = yield* Effect.promise(() => getRequestSession());

		if (!session?.user) {
			return yield* Effect.fail(
				new AuthenticationError({
					message: "Authentication required",
				}),
			);
		}

		const organizationId = session.session.activeOrganizationId;
		if (!organizationId) {
			return yield* Effect.fail(
				new AuthenticationError({
					message: "Active organization required",
					userId: session.user.id,
				}),
			);
		}

		const viewerEmployeeId = yield* dbService.query(
			"orgExplorer.findViewer",
			() =>
				findCurrentRosterViewer(dbService.db, organizationId, session.user.id),
		);

		if (!viewerEmployeeId) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Employee profile not found",
					entityType: "employee",
				}),
			);
		}

		return { organizationId, viewerEmployeeId };
	});
}
