"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { organization, user } from "@/db/auth-schema";
import { employee, location, team } from "@/db/schema";
import { organizationAbility } from "@/lib/authorization/organization-ability";
import { systemClock } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import {
	noInput,
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { refuseUnless } from "@/lib/organization-action/refuse-unless";
import {
	type ClosedMonthSettings,
	loadClosedMonthSettings,
	saveClosedMonthSettings,
} from "@/lib/time-tracking/closed-months/automatic-close";
import { parseCloseMonthScope } from "@/lib/time-tracking/closed-months/close-scope";
import {
	type CloseMonthWarning,
	monthCloseWarnings,
} from "@/lib/time-tracking/closed-months/close-warnings";
import { notifyReopening } from "@/lib/time-tracking/closed-months/notifications";
import { canCloseMonths, canReopenMonths } from "@/lib/time-tracking/closed-months/permissions";
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
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";

const SETTINGS_PATH = "/settings/closed-months";

/**
 * What the actor may do with the organization's months. Closing and reopening are
 * separate CASL permissions a custom role can grant (#762), so they stay checks in
 * the handler on top of the module's org-member level.
 */
const monthPermissions = (actor: OrganizationActor, organizationId: string) =>
	Effect.gen(function* () {
		const ability = yield* organizationAbility({ userId: actor.userId, organizationId });
		return {
			canClose: canCloseMonths(ability, organizationId, organizationId),
			canReopen: canReopenMonths(ability, organizationId, organizationId),
		};
	});

type MonthAction = "read" | "close" | "reopen";

/** Reading needs either permission; closing and reopening need their own. */
function permitsMonthAction(
	permissions: { canClose: boolean; canReopen: boolean },
	action: MonthAction,
): boolean {
	if (action === "close") return permissions.canClose;
	if (action === "reopen") return permissions.canReopen;
	return permissions.canClose || permissions.canReopen;
}

const MONTH_REFUSAL_MESSAGES: Record<MonthAction, string> = {
	read: "You are not allowed to see closed months",
	close: "You are not allowed to close months",
	reopen: "You are not allowed to reopen months",
};

/** What `refuseUnless` reports when the actor may not do `action` with months. */
const monthRefusal = (actor: OrganizationActor, action: MonthAction) => ({
	userId: actor.userId,
	message: MONTH_REFUSAL_MESSAGES[action],
	resource: "closedMonth",
	action,
});

const parseMonth = (value: string) =>
	Effect.try({
		try: () => parseClosedMonth(value),
		catch: () => new ValidationError({ message: "Choose a calendar month", field: "month" }),
	});

const monthSchema = z.string({ error: "Choose a calendar month" }).transform((value, context) => {
	try {
		return parseClosedMonth(value);
	} catch {
		context.addIssue({ code: "custom", message: "Choose a calendar month" });
		return z.NEVER;
	}
});

/** The client's close scope, checked for shape; organization membership is the close's check. */
const closeScopeSchema = z.unknown().transform((value, context): CloseMonthScope => {
	const scope = parseCloseMonthScope(value);
	if (scope) return scope;
	context.addIssue({ code: "custom", message: "Choose what to close for" });
	return z.NEVER;
});

const closeMonthSchema = z.strictObject({ month: monthSchema, scope: closeScopeSchema });

const reopenScopeSchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("employees"), employeeIds: z.array(z.string()) }),
	z.strictObject({ kind: z.literal("team"), teamId: z.string() }),
	z.strictObject({ kind: z.literal("all") }),
]) satisfies z.ZodType<ReopenMonthScope>;

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
export const getClosedMonthsOverview = organizationAction(
	{ name: "closedMonths.overview", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const permissions = yield* monthPermissions(actor, organizationId);
			yield* refuseUnless(permitsMonthAction(permissions, "read"), monthRefusal(actor, "read"));
			const dbService = yield* DatabaseService;
			return yield* dbService.query("closedMonths.overview", async () => {
				const database = dbService.db;
				const [org] = await database
					.select({ timezone: organization.timezone })
					.from(organization)
					.where(eq(organization.id, organizationId))
					.limit(1);
				const timezone = resolveOrganizationTimezone(org?.timezone).timezone;
				const [months, history, [teams, locations], employees, settings] = await Promise.all([
					monthClosureStatuses(database, { organizationId, months: recentMonths(timezone) }),
					closedMonthHistory(database, { organizationId }),
					closeScopeOptions(database, organizationId),
					database
						.select({
							id: employee.id,
							userName: user.name,
							teamId: employee.teamId,
						})
						.from(employee)
						.leftJoin(user, eq(user.id, employee.userId))
						.where(eq(employee.organizationId, organizationId)),
					loadClosedMonthSettings(database, organizationId),
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
					canClose: permissions.canClose,
					canReopen: permissions.canReopen,
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
				} satisfies ClosedMonthsOverview;
			});
		}),
);

/**
 * Closes a month for the organization, one team or one location. Refused results carry the
 * blockers.
 */
export const closeMonthAction = organizationAction(
	{ name: "closedMonths.close", requires: "member", schema: closeMonthSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const permissions = yield* monthPermissions(actor, organizationId);
			yield* refuseUnless(permitsMonthAction(permissions, "close"), monthRefusal(actor, "close"));
			const dbService = yield* DatabaseService;
			const result: CloseMonthResult = yield* dbService.query("closedMonths.close", () =>
				closeMonth(dbService.db, {
					organizationId,
					month: input.month,
					scope: input.scope,
					actor: { kind: "user", userId: actor.userId },
					now: systemClock.nowInstant(),
				}),
			);
			if (result.kind === "closed") revalidatePath(SETTINGS_PATH);
			return result;
		}),
);

/**
 * What a close of the month for the scope would warn about without refusing it (#1065):
 * missing or unapproved period submissions. Needs the close permission.
 */
export const getMonthCloseWarningsAction = organizationAction(
	{ name: "closedMonths.closeWarnings", requires: "member", schema: closeMonthSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const permissions = yield* monthPermissions(actor, organizationId);
			yield* refuseUnless(permitsMonthAction(permissions, "close"), monthRefusal(actor, "close"));
			const dbService = yield* DatabaseService;
			const warnings: CloseMonthWarning[] = yield* dbService.query(
				"closedMonths.closeWarnings",
				() =>
					monthCloseWarnings(dbService.db, {
						organizationId,
						month: input.month,
						scope: input.scope,
						now: systemClock.nowInstant(),
					}),
			);
			return warnings;
		}),
);

/** Reopens a closed month for selected employees, a team or everything, with a reason. */
export const reopenMonthAction = organizationAction(
	{
		name: "closedMonths.reopen",
		requires: "member",
		schema: z.strictObject({ month: monthSchema, scope: reopenScopeSchema, reason: z.string() }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const permissions = yield* monthPermissions(actor, organizationId);
			yield* refuseUnless(permitsMonthAction(permissions, "reopen"), monthRefusal(actor, "reopen"));
			const dbService = yield* DatabaseService;
			// Attaches the reopened employees' missing canonical work records after the commit (#1224).
			const result: ReopenMonthResult = yield* dbService.query("closedMonths.reopen", () =>
				reopenMonthAttachingWork(dbService.db, {
					organizationId,
					month: input.month,
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
						organizationId,
						month: input.month,
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

/** The month statuses of a selection, for reports, the calendar and the payroll pages. */
export const getMonthClosureStatuses = organizationAction(
	{
		name: "closedMonths.statuses",
		requires: "member",
		schema: z.strictObject({
			months: z.array(z.string()),
			employeeIds: z.array(z.string()).optional(),
		}),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const months: string[] = [];
			for (const value of input.months.slice(0, 36)) {
				months.push(yield* parseMonth(value));
			}
			const requestedEmployeeIds = input.employeeIds;
			const dbService = yield* DatabaseService;
			const statuses: MonthClosureStatus[] = yield* dbService.query(
				"closedMonths.statuses",
				async () => {
					// Only employees of the active organization count toward the selection.
					const employeeIds = requestedEmployeeIds
						? (
								await dbService.db
									.select({ id: employee.id })
									.from(employee)
									.where(
										and(
											eq(employee.organizationId, organizationId),
											inArray(employee.id, requestedEmployeeIds.slice(0, 5000)),
										),
									)
							).map((row) => row.id)
						: undefined;
					return monthClosureStatuses(dbService.db, { organizationId, months, employeeIds });
				},
			);
			return statuses;
		}),
);

/** Turns automatic close on or off and sets its days; needs the close permission. */
export const saveClosedMonthSettingsAction = organizationAction(
	{
		name: "closedMonths.saveSettings",
		requires: "member",
		schema: z.strictObject({
			autoCloseEnabled: z.boolean(),
			autoCloseAfterDays: z.number(),
		}) satisfies z.ZodType<ClosedMonthSettings>,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const permissions = yield* monthPermissions(actor, organizationId);
			yield* refuseUnless(permitsMonthAction(permissions, "close"), monthRefusal(actor, "close"));
			const dbService = yield* DatabaseService;
			const saved = yield* dbService.query("closedMonths.saveSettings", () =>
				saveClosedMonthSettings(dbService.db, {
					organizationId,
					actorUserId: actor.userId,
					settings: input,
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

export interface MonthCloseContext {
	canClose: boolean;
	teams: Array<{ id: string; name: string }>;
	locations: Array<{ id: string; name: string }>;
}

/**
 * Whether the viewer may close months, and the teams and locations a close may
 * cover: what the payroll export's `Close this month` offer needs. Never fails
 * for a member without the permission; they just get no offer.
 */
export const getMonthCloseContext = organizationAction(
	{ name: "closedMonths.closeContext", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const { canClose } = yield* monthPermissions(actor, organizationId);
			if (!canClose) return { canClose: false, teams: [], locations: [] } as MonthCloseContext;
			const dbService = yield* DatabaseService;
			const [teams, locations] = yield* dbService.query("closedMonths.closeScopes", () =>
				closeScopeOptions(dbService.db, organizationId),
			);
			return { canClose: true, teams, locations } as MonthCloseContext;
		}),
);
