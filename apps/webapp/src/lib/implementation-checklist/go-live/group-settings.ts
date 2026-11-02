import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { user } from "@/db/auth-schema";
import { employee, goLiveExclusion, goLiveGroupTeam, team } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { withAuditTrail } from "@/lib/audit-trail";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { isUuid } from "@/lib/validations/uuid";
import {
	GO_LIVE_EXCLUSION_REASON_MAX_LENGTH,
	type GoLiveGroupCommandResult,
	type GoLiveGroupRefusal,
	type GoLiveGroupSettings,
} from "./group-types";
import type { GoLiveAsOf } from "./types";

export type {
	GoLiveExclusionView,
	GoLiveGroupCommandResult,
	GoLiveGroupRefusal,
	GoLiveGroupSettings,
} from "./group-types";

type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

const refused = (refusal: GoLiveGroupRefusal): GoLiveGroupCommandResult => ({
	ok: false,
	refusal,
});

/**
 * Serializes the organization's go-live group writes. Taken first, before any
 * row lock, and by nothing else, so it can't take part in a lock cycle.
 */
async function lockGoLiveGroup(tx: Transaction, organizationId: string) {
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`go_live_group:${organizationId}`}, 0))`,
	);
}

/**
 * Narrows the go-live group to the chosen teams of the organization, or widens
 * it to the whole roster with none. Refuses a team that isn't the organization's.
 * Audited as `go_live.group_teams_changed` with the teams before and after.
 */
export async function chooseGoLiveGroupTeams(
	database: DatabaseClient,
	input: { organizationId: string; actorUserId: string; teamIds: readonly string[] },
): Promise<GoLiveGroupCommandResult> {
	const teamIds = [...new Set(input.teamIds)];
	if (!teamIds.every(isUuid)) return refused("team_not_found");
	return withAuditTrail((audit) =>
		database.transaction(async (tx) => {
			await lockGoLiveGroup(tx, input.organizationId);
			const chosen = teamIds.length
				? await tx
						.select({ id: team.id, name: team.name })
						.from(team)
						.where(and(eq(team.organizationId, input.organizationId), inArray(team.id, teamIds)))
						.orderBy(asc(team.name), asc(team.id))
				: [];
			if (chosen.length !== teamIds.length) return refused("team_not_found");

			const before = await tx
				.select({ id: team.id, name: team.name })
				.from(goLiveGroupTeam)
				.innerJoin(
					team,
					and(eq(team.id, goLiveGroupTeam.teamId), eq(team.organizationId, input.organizationId)),
				)
				.where(eq(goLiveGroupTeam.organizationId, input.organizationId))
				.orderBy(asc(team.name), asc(team.id));
			if (sameTeams(before, chosen)) return { ok: true };

			await tx
				.delete(goLiveGroupTeam)
				.where(eq(goLiveGroupTeam.organizationId, input.organizationId));
			if (chosen.length) {
				await tx.insert(goLiveGroupTeam).values(
					chosen.map((row) => ({
						organizationId: input.organizationId,
						teamId: row.id,
						createdBy: input.actorUserId,
					})),
				);
			}
			await audit.record(tx, {
				organizationId: input.organizationId,
				action: AuditAction.GO_LIVE_GROUP_TEAMS_CHANGED,
				actorUserId: input.actorUserId,
				targetType: "organization",
				targetId: input.organizationId,
				changes: { teams: { from: before, to: chosen } },
			});
			return { ok: true };
		}),
	);
}

function sameTeams(left: { id: string }[], right: { id: string }[]) {
	const ids = new Set(left.map((row) => row.id));
	return left.length === right.length && right.every((row) => ids.has(row.id));
}

/**
 * Leaves one current-roster employee of the organization out of the go-live
 * group, for a required reason. Audited as `go_live.exclusion_created` with the
 * reason. The employee row is share-locked, so a concurrent deactivation either
 * commits first (and the employee is refused) or ends this exclusion after.
 */
export async function createGoLiveExclusion(
	database: DatabaseClient,
	input: { organizationId: string; actorUserId: string; employeeId: string; reason: string },
): Promise<GoLiveGroupCommandResult> {
	const reason = input.reason.trim();
	if (!reason) return refused("reason_required");
	if (reason.length > GO_LIVE_EXCLUSION_REASON_MAX_LENGTH) return refused("reason_too_long");
	if (!isUuid(input.employeeId)) return refused("employee_not_found");
	return withAuditTrail((audit) =>
		database.transaction(async (tx) => {
			await lockGoLiveGroup(tx, input.organizationId);
			const [subject] = await tx
				.select({ id: employee.id })
				.from(employee)
				.where(and(eq(employee.id, input.employeeId), onCurrentRoster(input.organizationId)))
				.for("share");
			if (!subject) return refused("employee_not_found");

			const [open] = await tx
				.select({ id: goLiveExclusion.id })
				.from(goLiveExclusion)
				.where(openExclusionOf(input.organizationId, subject.id));
			if (open) return refused("already_excluded");

			const [created] = await tx
				.insert(goLiveExclusion)
				.values({
					organizationId: input.organizationId,
					employeeId: subject.id,
					reason,
					createdBy: input.actorUserId,
				})
				.returning({ id: goLiveExclusion.id });
			if (!created) throw new Error("Go-live exclusion insert returned no row");
			await audit.record(tx, {
				organizationId: input.organizationId,
				action: AuditAction.GO_LIVE_EXCLUSION_CREATED,
				actorUserId: input.actorUserId,
				targetType: "go_live_exclusion",
				targetId: created.id,
				employeeId: subject.id,
				metadata: { reason },
			});
			return { ok: true };
		}),
	);
}

/**
 * Lifts an open go-live exclusion of the organization, bringing the employee
 * back into the checks. Audited as `go_live.exclusion_lifted` with its reason.
 */
export async function liftGoLiveExclusion(
	database: DatabaseClient,
	input: { organizationId: string; actorUserId: string; exclusionId: string },
): Promise<GoLiveGroupCommandResult> {
	if (!isUuid(input.exclusionId)) return refused("exclusion_not_found");
	return withAuditTrail((audit) =>
		database.transaction(async (tx) => {
			await lockGoLiveGroup(tx, input.organizationId);
			const [lifted] = await tx
				.update(goLiveExclusion)
				.set({ liftedAt: sql`now()`, liftedBy: input.actorUserId })
				.where(
					and(
						eq(goLiveExclusion.id, input.exclusionId),
						eq(goLiveExclusion.organizationId, input.organizationId),
						isNull(goLiveExclusion.liftedAt),
						isNull(goLiveExclusion.endedAt),
					),
				)
				.returning({
					id: goLiveExclusion.id,
					employeeId: goLiveExclusion.employeeId,
					reason: goLiveExclusion.reason,
				});
			if (!lifted) return refused("exclusion_not_found");
			await audit.record(tx, {
				organizationId: input.organizationId,
				action: AuditAction.GO_LIVE_EXCLUSION_LIFTED,
				actorUserId: input.actorUserId,
				targetType: "go_live_exclusion",
				targetId: lifted.id,
				employeeId: lifted.employeeId,
				metadata: { reason: lifted.reason },
			});
			return { ok: true };
		}),
	);
}

/** An exclusion that is neither lifted nor ended. */
function openExclusionOf(organizationId: string, employeeId: string) {
	return and(
		eq(goLiveExclusion.organizationId, organizationId),
		eq(goLiveExclusion.employeeId, employeeId),
		isNull(goLiveExclusion.liftedAt),
		isNull(goLiveExclusion.endedAt),
	);
}

/** The organization's teams and the go-live group's chosen teams and exclusions. */
export async function loadGoLiveGroupSettings(
	db: DatabaseClient,
	organizationId: string,
	asOf: GoLiveAsOf,
): Promise<GoLiveGroupSettings> {
	const creator = alias(user, "go_live_exclusion_creator");
	const [teams, chosenTeamIds, exclusions] = await Promise.all([
		db
			.select({ id: team.id, name: team.name })
			.from(team)
			.where(eq(team.organizationId, organizationId))
			.orderBy(asc(team.name), asc(team.id)),
		loadChosenTeamIds(db, organizationId),
		// A former employee's exclusion has ended, or ends once their departure is
		// processed: either way it is no longer listed.
		db
			.select({
				id: goLiveExclusion.id,
				employeeId: goLiveExclusion.employeeId,
				name: user.name,
				email: user.email,
				reason: goLiveExclusion.reason,
				createdByName: creator.name,
				createdAt: goLiveExclusion.createdAt,
			})
			.from(goLiveExclusion)
			.innerJoin(
				employee,
				and(
					eq(employee.id, goLiveExclusion.employeeId),
					onCurrentRoster(organizationId, employee, asOf.instant),
				),
			)
			.innerJoin(user, eq(user.id, employee.userId))
			.leftJoin(creator, eq(creator.id, goLiveExclusion.createdBy))
			.where(
				and(
					eq(goLiveExclusion.organizationId, organizationId),
					isNull(goLiveExclusion.liftedAt),
					isNull(goLiveExclusion.endedAt),
				),
			)
			.orderBy(asc(user.name), asc(goLiveExclusion.id)),
	]);
	return {
		teams,
		chosenTeamIds,
		exclusions: exclusions.map((row) => ({
			id: row.id,
			employeeId: row.employeeId,
			displayName: row.name || row.email,
			reason: row.reason,
			createdByName: row.createdByName,
			createdAt: instantFromDate(row.createdAt).toString(),
		})),
	};
}

/** The teams the go-live group is narrowed to; empty for the whole roster. */
async function loadChosenTeamIds(db: DatabaseClient, organizationId: string): Promise<string[]> {
	const rows = await db
		.select({ teamId: goLiveGroupTeam.teamId })
		.from(goLiveGroupTeam)
		.innerJoin(
			team,
			and(eq(team.id, goLiveGroupTeam.teamId), eq(team.organizationId, organizationId)),
		)
		.where(eq(goLiveGroupTeam.organizationId, organizationId))
		.orderBy(asc(team.name), asc(team.id));
	return rows.map((row) => row.teamId);
}
