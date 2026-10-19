"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { organization, user } from "@/db/auth-schema";
import { employee, location, team } from "@/db/schema";
import { getAbility } from "@/lib/auth-helpers";
import { systemClock } from "@/lib/datetime/temporal-core";
import { AuthorizationError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import {
	type ClosedMonthSettings,
	loadClosedMonthSettings,
	saveClosedMonthSettings,
} from "@/lib/time-tracking/closed-months/automatic-close";
import {
	type CloseMonthWarning,
	monthCloseWarnings,
} from "@/lib/time-tracking/closed-months/close-warnings";
import { parseCloseMonthScope } from "@/lib/time-tracking/closed-months/close-scope";
import { notifyReopening } from "@/lib/time-tracking/closed-months/notifications";
import { canCloseMonths, canReopenMonths } from "@/lib/time-tracking/closed-months/permissions";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import { reopenMonthAttachingWork } from "@/lib/time-tracking/closed-months/reopen-month";
import { parseClosedMonth } from "@/lib/time-tracking/closed-months/rules";
import {
	type ClosedMonthHistoryEntry,
	type CloseMonthResult,
	type CloseMonthScope,
	closedMonthHistory,
	closeMonth,
	type MonthClosureStatus,
	monthClosureStatuses,
	type ReopenMonthResult,
	type ReopenMonthScope,
} from "@/lib/time-tracking/closed-months/store";

const SETTINGS_PATH = "/settings/closed-months";

/** The session's active organization and what the actor may do with its months. */
const closedMonthsActor = (action: "read" | "close" | "reopen") =>
	Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const organizationId = session.session.activeOrganizationId;
		const refuse = (message: string) =>
			Effect.fail(
				new AuthorizationError({
					message,
					userId: session.user.id,
					resource: "closedMonth",
					action,
				}),
			);
		if (!organizationId) {
			return yield* refuse("Select an organization first");
		}
		const ability = yield* Effect.promise(() => getAbility());
		const canClose = ability ? canCloseMonths(ability, organizationId, organizationId) : false;
		const canReopen = ability ? canReopenMonths(ability, organizationId, organizationId) : false;
		if (action === "close" && !canClose) {
			return yield* refuse("You are not allowed to close months");
		}
		if (action === "reopen" && !canReopen) {
			return yield* refuse("You are not allowed to reopen months");
		}
		if (action === "read" && !canClose && !canReopen) {
			return yield* refuse("You are not allowed to see closed months");
		}
		return { organizationId, userId: session.user.id, canClose, canReopen };
	});

const parseMonth = (value: string) =>
	Effect.try({
		try: () => parseClosedMonth(value),
		catch: () => new ValidationError({ message: "Choose a calendar month", field: "month" }),
	});

/** The client's close scope, checked for shape; organization membership is the close's check. */
const parseScope = (value: unknown) => {
	const scope = parseCloseMonthScope(value);
	return scope
		? Effect.succeed(scope)
		: Effect.fail(new ValidationError({ message: "Choose what to close for", field: "scope" }));
};

/** The organization's teams and locations (#836), the scopes a close may name besides it. */
const closeScopeOptions = (database: DatabaseClient, organizationId: string) =>
	Promise.all([
		database
			.select({ id: team.id, name: team.name })
			.from(team)
			.where(eq(team.organizationId, organizationId))
			.orderBy(asc(team.name)),
		database
			.select({ id: location.id, name: location.name })
			.from(location)
			.where(eq(location.organizationId, organizationId))
			.orderBy(asc(location.name)),
	]);

export interface ClosedMonthsHistoryRow extends ClosedMonthHistoryEntry {
	actorName: string | null;
	teamName: string | null;
}

export interface ClosedMonthsOverview {
	canClose: boolean;
	canReopen: boolean;
	timezone: string;
	months: MonthClosureStatus[];
	history: ClosedMonthsHistoryRow[];
	teams: Array<{ id: string; name: string }>;
	locations: Array<{ id: string; name: string }>;
	employees: Array<{ id: string; name: string; teamId: string | null }>;
	settings: ClosedMonthSettings;
}

/** The last twelve months, newest first, as `YYYY-MM` in the organization's timezone. */
function recentMonths(timezone: string): string[] {
	let month = systemClock
		.nowInstant()
		.toZonedDateTimeISO(timezone)
		.toPlainDate()
		.toPlainYearMonth();
	const months: string[] = [];
	for (let index = 0; index < 12; index++) {
		months.push(month.toString());
		month = month.subtract({ months: 1 });
	}
	return months;
}

/** Statuses, history, teams and employees for the "Closed months" settings page. */
export async function getClosedMonthsOverview(): Promise<ServerActionResult<ClosedMonthsOverview>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* closedMonthsActor("read");
			const dbService = yield* DatabaseService;
			return yield* dbService.query("closedMonths.overview", async () => {
				const database = dbService.db;
				const [org] = await database
					.select({ timezone: organization.timezone })
					.from(organization)
					.where(eq(organization.id, actor.organizationId))
					.limit(1);
				const timezone = resolveOrganizationTimezone(org?.timezone).timezone;
				const [months, history, [teams, locations], employees, settings] = await Promise.all([
					monthClosureStatuses(database, {
						organizationId: actor.organizationId,
						months: recentMonths(timezone),
					}),
					closedMonthHistory(database, { organizationId: actor.organizationId }),
					closeScopeOptions(database, actor.organizationId),
					database
						.select({
							id: employee.id,
							userName: user.name,
							teamId: employee.teamId,
						})
						.from(employee)
						.leftJoin(user, eq(user.id, employee.userId))
						.where(eq(employee.organizationId, actor.organizationId)),
					loadClosedMonthSettings(database, actor.organizationId),
				]);
				const actorIds = [
					...new Set(history.flatMap((row) => (row.actorUserId ? [row.actorUserId] : []))),
				];
				const actors =
					actorIds.length > 0
						? await database
								.select({ id: user.id, name: user.name })
								.from(user)
								.where(inArray(user.id, actorIds))
						: [];
				const actorNames = new Map(actors.map((row) => [row.id, row.name]));
				const teamNames = new Map(teams.map((row) => [row.id, row.name]));
				const locationNames = new Map(locations.map((row) => [row.id, row.name]));
				return {
					canClose: actor.canClose,
					canReopen: actor.canReopen,
					timezone,
					settings,
					months,
					history: history.map((row) => ({
						...row,
						actorName: row.actorUserId ? (actorNames.get(row.actorUserId) ?? null) : null,
						teamName: row.teamId ? (teamNames.get(row.teamId) ?? null) : null,
						// The current name, else the name at close once the location is deleted.
						locationName: row.locationId
							? (locationNames.get(row.locationId) ?? row.locationName)
							: null,
					})),
					teams,
					locations,
					employees: employees
						.map((row) => ({
							id: row.id,
							name: row.userName?.trim() || "—",
							teamId: row.teamId,
						}))
						.sort((left, right) => left.name.localeCompare(right.name)),
				};
			});
		}),
	);
}

/**
 * Closes a month for the organization, one team or one location. Refused results carry the
 * blockers.
 */
export async function closeMonthAction(input: {
	month: string;
	scope: CloseMonthScope;
}): Promise<ServerActionResult<CloseMonthResult>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* closedMonthsActor("close");
			const month = yield* parseMonth(input.month);
			const scope = yield* parseScope(input.scope);
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query("closedMonths.close", () =>
				closeMonth(dbService.db, {
					organizationId: actor.organizationId,
					month,
					scope,
					actor: { kind: "user", userId: actor.userId },
					now: systemClock.nowInstant(),
				}),
			);
			if (result.kind === "closed") revalidatePath(SETTINGS_PATH);
			return result;
		}),
	);
}

/**
 * What a close of the month for the scope would warn about without refusing it (#1065):
 * missing or unapproved period submissions. Needs the close permission.
 */
export async function getMonthCloseWarningsAction(input: {
	month: string;
	scope: CloseMonthScope;
}): Promise<ServerActionResult<CloseMonthWarning[]>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* closedMonthsActor("close");
			const month = yield* parseMonth(input.month);
			const scope = yield* parseScope(input.scope);
			const dbService = yield* DatabaseService;
			return yield* dbService.query("closedMonths.closeWarnings", () =>
				monthCloseWarnings(dbService.db, {
					organizationId: actor.organizationId,
					month,
					scope,
					now: systemClock.nowInstant(),
				}),
			);
		}),
	);
}

/** Reopens a closed month for selected employees, a team or everything, with a reason. */
export async function reopenMonthAction(input: {
	month: string;
	scope: ReopenMonthScope;
	reason: string;
}): Promise<ServerActionResult<ReopenMonthResult>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* closedMonthsActor("reopen");
			const month = yield* parseMonth(input.month);
			const dbService = yield* DatabaseService;
			// Attaches the reopened employees' missing canonical work records after the commit (#1224).
			const result = yield* dbService.query("closedMonths.reopen", () =>
				reopenMonthAttachingWork(dbService.db, {
					organizationId: actor.organizationId,
					month,
					scope: input.scope,
					reason: input.reason,
					actorUserId: actor.userId,
				}),
			);
			if (result.kind === "reopened") {
				revalidatePath(SETTINGS_PATH);
				// After commit and best effort: the reopening stands without its notifications.
				yield* Effect.promise(() =>
					notifyReopening(dbService.db, {
						organizationId: actor.organizationId,
						month,
						reopeningId: result.reopeningId,
						employeeIds: result.employeeIds,
						reason: input.reason.trim(),
						actorUserId: actor.userId,
					}).catch(() => 0),
				);
			}
			return result;
		}),
	);
}

/** The month statuses of a selection, for reports, the calendar and the payroll pages. */
export async function getMonthClosureStatuses(input: {
	months: string[];
	employeeIds?: string[];
}): Promise<ServerActionResult<MonthClosureStatus[]>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const authService = yield* AuthService;
			const session = yield* authService.getSession();
			const organizationId = session.session.activeOrganizationId;
			if (!organizationId) {
				return yield* Effect.fail(
					new AuthorizationError({
						message: "Select an organization first",
						userId: session.user.id,
						resource: "closedMonth",
						action: "read",
					}),
				);
			}
			const months: string[] = [];
			for (const value of input.months.slice(0, 36)) {
				months.push(yield* parseMonth(value));
			}
			const dbService = yield* DatabaseService;
			return yield* dbService.query("closedMonths.statuses", async () => {
				// Only employees of the active organization count toward the selection.
				const employeeIds = input.employeeIds
					? (
							await dbService.db
								.select({ id: employee.id })
								.from(employee)
								.where(
									and(
										eq(employee.organizationId, organizationId),
										inArray(employee.id, input.employeeIds.slice(0, 5000)),
									),
								)
						).map((row) => row.id)
					: undefined;
				return monthClosureStatuses(dbService.db, { organizationId, months, employeeIds });
			});
		}),
	);
}

/** Turns automatic close on or off and sets its days; needs the close permission. */
export async function saveClosedMonthSettingsAction(
	settings: ClosedMonthSettings,
): Promise<ServerActionResult<ClosedMonthSettings>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* closedMonthsActor("close");
			const dbService = yield* DatabaseService;
			const saved = yield* dbService.query("closedMonths.saveSettings", () =>
				saveClosedMonthSettings(dbService.db, {
					organizationId: actor.organizationId,
					actorUserId: actor.userId,
					settings,
				}),
			);
			if ("invalid" in saved) {
				return yield* Effect.fail(
					new ValidationError({
						message: "Choose between 1 and 60 days",
						field: "autoCloseAfterDays",
					}),
				);
			}
			revalidatePath(SETTINGS_PATH);
			return saved;
		}),
	);
}

export interface MonthCloseContext {
	canClose: boolean;
	teams: Array<{ id: string; name: string }>;
	locations: Array<{ id: string; name: string }>;
}

/**
 * Whether the viewer may close months, and the teams and locations a close may
 * cover: what the payroll export's `Close this month` offer needs. Never fails
 * for a viewer without the permission; they just get no offer.
 */
export async function getMonthCloseContext(): Promise<ServerActionResult<MonthCloseContext>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const authService = yield* AuthService;
			const session = yield* authService.getSession();
			const organizationId = session.session.activeOrganizationId;
			const none: MonthCloseContext = { canClose: false, teams: [], locations: [] };
			if (!organizationId) return none;
			const ability = yield* Effect.promise(() => getAbility());
			if (!ability || !canCloseMonths(ability, organizationId, organizationId)) {
				return none;
			}
			const dbService = yield* DatabaseService;
			const [teams, locations] = yield* dbService.query("closedMonths.closeScopes", () =>
				closeScopeOptions(dbService.db, organizationId),
			);
			return { canClose: true, teams, locations };
		}),
	);
}
