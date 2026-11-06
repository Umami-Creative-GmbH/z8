"use server";

import { Effect } from "effect";
import {
	AuthenticationError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import {
	type DatabaseClient,
	DatabaseService,
} from "@/lib/effect/services/database.service";
import {
	countCurrentRoster,
	countUnplacedPeople,
	findCurrentRosterViewer,
	type IdPage,
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
	type OrgExplorerPage,
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
		const ids = yield* parseIdBatch(employeeIds);
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

/**
 * A page of a team's current members, by name, with their paths to the top so
 * the filter can show them. `offset` is the previous page's `nextOffset`.
 */
export async function getOrgExplorerTeamMembers(
	teamId: string,
	offset = 0,
): Promise<ServerActionResult<OrgExplorerPage>> {
	const effect = Effect.gen(function* () {
		if (typeof teamId !== "string" || !UUID_PATTERN.test(teamId)) {
			return yield* Effect.fail(
				new ValidationError({ message: "Unknown team", field: "teamId" }),
			);
		}
		const page = yield* parsePageRequest(offset);
		const dbService = yield* DatabaseService;
		const { organizationId } = yield* resolveOrgExplorerViewer(dbService);

		return yield* dbService.query("orgExplorer.loadTeamMembers", async () =>
			withPaths(
				dbService.db,
				organizationId,
				await loadCurrentTeamMemberIds(
					dbService.db,
					organizationId,
					teamId,
					page,
				),
			),
		);
	});

	return runServerActionSafe(effect);
}

/**
 * A page of the people with no reporting line, or with no team membership, by
 * name. People without a team can still have managers, so their paths to the
 * top come along. `offset` is the previous page's `nextOffset`.
 */
export async function getOrgExplorerGroup(
	group: OrgExplorerGroup,
	offset = 0,
): Promise<ServerActionResult<OrgExplorerPage>> {
	const effect = Effect.gen(function* () {
		if (group !== "noReportingLine" && group !== "noTeam") {
			return yield* Effect.fail(
				new ValidationError({
					message: "Unknown people group",
					field: "group",
				}),
			);
		}
		const page = yield* parsePageRequest(offset);
		const dbService = yield* DatabaseService;
		const { organizationId } = yield* resolveOrgExplorerViewer(dbService);

		return yield* dbService.query("orgExplorer.loadGroup", async () =>
			withPaths(
				dbService.db,
				organizationId,
				await loadUnplacedPeopleIds(dbService.db, organizationId, group, page),
			),
		);
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
	// The top and the unplaced groups come from the same queries at every size.
	const [employeeCount, teams, rootIds, unplaced] = await Promise.all([
		countCurrentRoster(db, organizationId),
		loadOrgExplorerTeams(db, organizationId),
		loadReportingLineRootIds(db, organizationId),
		countUnplacedPeople(db, organizationId),
	]);

	if (employeeCount < SMALL_ORG_EMPLOYEE_LIMIT) {
		return {
			complete: true,
			employeeCount,
			viewerEmployeeId,
			teams,
			people: await loadCurrentRosterPeople(db, organizationId, "all"),
			rootIds,
			...unplaced,
		};
	}

	const viewerPath = await loadCurrentRosterPeopleWithPaths(
		db,
		organizationId,
		[viewerEmployeeId],
	);
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

async function withPaths(
	db: DatabaseClient,
	organizationId: string,
	page: IdPage,
): Promise<OrgExplorerPage> {
	return {
		people: await loadCurrentRosterPeopleWithPaths(
			db,
			organizationId,
			page.ids,
		),
		nextOffset: page.nextOffset,
	};
}

/** A batch-sized page starting at `offset`, which must be a whole number from 0. */
function parsePageRequest(offset: unknown) {
	if (
		typeof offset !== "number" ||
		!Number.isSafeInteger(offset) ||
		offset < 0
	) {
		return Effect.fail(
			new ValidationError({ message: "Invalid page", field: "offset" }),
		);
	}
	return Effect.succeed({ offset, limit: ORG_EXPLORER_BATCH_LIMIT });
}

/**
 * The distinct UUIDs among `ids`, dropping anything else; fails when more than a
 * batch is requested at once.
 */
function parseIdBatch(ids: unknown) {
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
		const authService = yield* AuthService;
		const session = yield* authService.getSession();

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
