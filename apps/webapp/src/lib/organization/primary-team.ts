import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { employee, team, teamMembership } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { DatabaseError, ValidationError } from "@/lib/effect/errors";
import { removeTeamMembership, type TeamMembershipTransaction } from "./team-membership-removal";

export type PrimaryTeamWriter = Pick<
	TeamMembershipTransaction,
	"delete" | "insert" | "query" | "update"
>;

/** What setting an employee's Team field to `nextTeamId` changes (Organization ADR 0010). */
export type PrimaryTeamChange = {
	/** The membership to add, when the employee is not yet a member. */
	addTeamId: string | null;
	/** The membership that ends: the old primary team's. */
	endTeamId: string | null;
	/** The employee's primary team afterwards. */
	primaryTeamId: string | null;
};

/**
 * Setting the Team field is a move: the new team becomes a membership and the primary
 * team, and the old primary team's membership ends. Clearing it ends that membership, and
 * the alphabetically first remaining membership (by id) becomes primary, as removing someone
 * from a team does (`removeTeamMembership`). Other memberships stay.
 */
export function planPrimaryTeamChange(input: {
	primaryTeamId: string | null;
	membershipTeamIds: readonly string[];
	nextTeamId: string | null;
}): PrimaryTeamChange {
	const { primaryTeamId, membershipTeamIds, nextTeamId } = input;
	const endTeamId = primaryTeamId && primaryTeamId !== nextTeamId ? primaryTeamId : null;
	if (nextTeamId) {
		return {
			addTeamId: membershipTeamIds.includes(nextTeamId) ? null : nextTeamId,
			endTeamId,
			primaryTeamId: nextTeamId,
		};
	}
	const remaining = membershipTeamIds.filter((teamId) => teamId !== endTeamId);
	return { addTeamId: null, endTeamId, primaryTeamId: remaining.toSorted()[0] ?? null };
}

/** The Team field named a team outside the employee's organization. */
export class PrimaryTeamNotInOrganization extends Error {
	constructor(readonly teamId: string) {
		super("Team not found in this organization");
		this.name = "PrimaryTeamNotInOrganization";
	}
}

/**
 * Turns a `PrimaryTeamNotInOrganization` raised inside a save (a `DatabaseService.query`)
 * into a `ValidationError` on the Team field; other errors pass through.
 */
export function keepPrimaryTeamRefusal<A, E, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | ValidationError, R> {
	return effect.pipe(
		Effect.catch((error: E): Effect.Effect<never, E | ValidationError> => {
			const cause = error instanceof DatabaseError ? error.cause : error;
			return cause instanceof PrimaryTeamNotInOrganization
				? Effect.fail(
						new ValidationError({ message: cause.message, field: "teamId", value: cause.teamId }),
					)
				: Effect.fail(error);
		}),
	);
}

/**
 * Sets the employee's Team field to `teamId` in the caller's transaction, keeping the primary
 * team among the employee's team memberships (Organization ADR 0010). Every write that places
 * an employee in a team uses it: creation, onboarding, reactivation and the employee form.
 * Calling it with the current team only adds a missing membership.
 */
export async function setPrimaryTeam(
	tx: PrimaryTeamWriter,
	input: {
		organizationId: string;
		employeeId: string;
		teamId: string | null;
		createdBy?: string | null;
	},
): Promise<PrimaryTeamChange> {
	const { organizationId, employeeId, teamId } = input;
	if (teamId) {
		const target = await tx.query.team.findFirst({
			where: and(eq(team.id, teamId), eq(team.organizationId, organizationId)),
			columns: { id: true },
		});
		if (!target) throw new PrimaryTeamNotInOrganization(teamId);
	}

	const [current, memberships] = await Promise.all([
		tx.query.employee.findFirst({
			where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
			columns: { teamId: true },
		}),
		tx.query.teamMembership.findMany({
			where: and(
				eq(teamMembership.organizationId, organizationId),
				eq(teamMembership.employeeId, employeeId),
			),
			columns: { teamId: true },
		}),
	]);
	if (!current) throw new Error("Cannot set the primary team of a missing employee");

	const change = planPrimaryTeamChange({
		primaryTeamId: current.teamId,
		membershipTeamIds: memberships.map((membership) => membership.teamId),
		nextTeamId: teamId,
	});

	if (change.addTeamId) {
		await tx
			.insert(teamMembership)
			.values({
				organizationId,
				teamId: change.addTeamId,
				employeeId,
				createdBy: input.createdBy ?? null,
			})
			.onConflictDoNothing();
	}
	// Clearing is removing the primary team's membership: the first remaining one becomes primary.
	if (change.endTeamId && !teamId) {
		await removeTeamMembership(tx, { organizationId, teamId: change.endTeamId, employeeId });
		return change;
	}
	if (change.primaryTeamId !== current.teamId) {
		await tx
			.update(employee)
			.set({ teamId: change.primaryTeamId, updatedAt: currentTimestamp() })
			.where(and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)));
	}
	// After a move the old team is no longer primary, so this only ends its membership.
	if (change.endTeamId) {
		await removeTeamMembership(tx, { organizationId, teamId: change.endTeamId, employeeId });
	}
	return change;
}

/**
 * Places a new or returning employee in `teamId` as `setPrimaryTeam` does, when there
 * is a team. Without one it changes nothing and returns null, where `setPrimaryTeam(null)`
 * would clear the Team field.
 */
export async function placeInTeam(
	tx: PrimaryTeamWriter,
	input: {
		organizationId: string;
		employeeId: string;
		teamId: string | null | undefined;
		createdBy?: string | null;
	},
): Promise<PrimaryTeamChange | null> {
	const { teamId } = input;
	return teamId ? setPrimaryTeam(tx, { ...input, teamId }) : null;
}
