import { and, eq, isNotNull } from "drizzle-orm";
import { Effect } from "effect";
import type { db } from "@/db";
import { employee, team, teamMembership } from "@/db/schema";
import {
	type AuthorizationMutationScope,
	withAuthorizationMutation,
} from "@/lib/authorization/authorization-mutation";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { DatabaseError, ValidationError } from "@/lib/effect/errors";
import type { DrivingLicenceTeamChangeImpact } from "../driving-licence/intended-driver-rules";
import {
	type DrivingLicenceChangeViewer,
	previewDrivingLicenceIntendedDriverWrite,
	runDrivingLicenceIntendedDriverWrite,
} from "../driving-licence/no-longer-intended";
import { keepDrivingLicenceStalePreview } from "../driving-licence/stale-preview";
import {
	planTeamChange,
	type TeamChangeKind,
	type TeamPlacement,
	type TeamPlacementPlan,
} from "./plan";

/**
 * Team placement (Organization glossary): the only writer of team memberships and of the
 * employee's Team field (`employee.teamId`). Every write keeps the primary team among the
 * memberships (Organization ADR 0010), and a change that moves the primary team also ends
 * the driving authorizations of an employee who stops being an intended driver
 * (Organization ADR 0005). Callers decide neither.
 *
 * - `teamChangeScope` / `applyTeamChange` / `previewTeamChange` / `keepTeamChangeRefusals`:
 *   moves and membership changes, with their driving licence warning
 *   (`previewUnchangedTeamPlacement` for a save that keeps the placement).
 * - `placeArrivingEmployee`: a new or returning employee, who holds no driving authorization.
 * - `releaseLeavingEmployee`: a deactivated employee, whose authorizations end elsewhere.
 */

export type { TeamPlacementPlan } from "./plan";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** What a placement write needs of the caller's transaction. */
export type TeamPlacementWriter = Pick<
	Transaction,
	"select" | "insert" | "update" | "delete"
>;
/** What a team change needs: it can also run the driving licence step. */
export type TeamChangeTransaction = TeamPlacementWriter &
	Pick<Transaction, "execute">;

/** The employee whose team placement changes. */
export type TeamPlacementTarget = {
	organizationId: string;
	employeeId: string;
};

/** A move or membership change of one employee. */
export type TeamChange = TeamChangeKind & TeamPlacementTarget;

/** Who asks for a team change: their warning detail, and who ends authorizations. */
export type TeamChangeActor = {
	actorUserId: string;
	viewer: DrivingLicenceChangeViewer;
};

/** The change named a team outside the employee's organization. */
export class TeamNotInOrganization extends Error {
	constructor(readonly teamId: string) {
		super("Team not found in this organization");
		this.name = "TeamNotInOrganization";
	}
}

/** The plan for an employee who is gone: nothing is added or ended, and no team is primary. */
const EMPLOYEE_GONE: TeamPlacementPlan = {
	addTeamId: null,
	endTeamId: null,
	primaryTeamId: null,
};

async function readPlacement(
	tx: TeamPlacementWriter,
	organizationId: string,
	employeeId: string,
): Promise<TeamPlacement | null> {
	const [current] = await tx
		.select({ teamId: employee.teamId })
		.from(employee)
		.where(
			and(
				eq(employee.id, employeeId),
				eq(employee.organizationId, organizationId),
			),
		);
	if (!current) return null;
	const memberships = await tx
		.select({ teamId: teamMembership.teamId })
		.from(teamMembership)
		.where(
			and(
				eq(teamMembership.organizationId, organizationId),
				eq(teamMembership.employeeId, employeeId),
			),
		);
	return {
		primaryTeamId: current.teamId,
		membershipTeamIds: memberships.map((membership) => membership.teamId),
	};
}

type Planned = { placement: TeamPlacement; plan: TeamPlacementPlan };

/** Reads the employee's placement under the caller's protection and plans `change`. */
async function planChange(
	tx: TeamPlacementWriter,
	change: TeamChange,
): Promise<Planned | null> {
	const { organizationId, employeeId, teamId } = change;
	if (teamId && change.kind !== "removeMembership") {
		const [target] = await tx
			.select({ id: team.id })
			.from(team)
			.where(and(eq(team.id, teamId), eq(team.organizationId, organizationId)));
		if (!target) throw new TeamNotInOrganization(teamId);
	}
	const placement = await readPlacement(tx, organizationId, employeeId);
	if (!placement) {
		// Removing someone who is gone changes nothing.
		if (change.kind === "removeMembership") return null;
		throw new Error("Cannot place a missing employee in a team");
	}
	return { placement, plan: planTeamChange(placement, change) };
}

/** Only a new primary team can end intended-driver status (Organization ADR 0005). */
function movesPrimaryTeam({ placement, plan }: Planned) {
	return plan.primaryTeamId !== placement.primaryTeamId;
}

async function writePlan(
	tx: TeamPlacementWriter,
	target: TeamPlacementTarget & { createdBy?: string | null },
	{ placement, plan }: Planned,
): Promise<TeamPlacementPlan> {
	const { organizationId, employeeId } = target;
	// The new primary team is a membership before it becomes primary, and the old one stops
	// being primary before its membership ends.
	if (plan.addTeamId) {
		await tx
			.insert(teamMembership)
			.values({
				organizationId,
				teamId: plan.addTeamId,
				employeeId,
				createdBy: target.createdBy ?? null,
			})
			.onConflictDoNothing();
	}
	if (plan.primaryTeamId !== placement.primaryTeamId) {
		await tx
			.update(employee)
			.set({ teamId: plan.primaryTeamId, updatedAt: currentTimestamp() })
			.where(
				and(
					eq(employee.id, employeeId),
					eq(employee.organizationId, organizationId),
				),
			);
	}
	if (plan.endTeamId) {
		await tx
			.delete(teamMembership)
			.where(
				and(
					eq(teamMembership.organizationId, organizationId),
					eq(teamMembership.teamId, plan.endTeamId),
					eq(teamMembership.employeeId, employeeId),
				),
			);
	}
	return plan;
}

/**
 * The authorization-mutation protection a team change needs: the employee's team feeds
 * creation authority and target checks. The caller opens the transaction with it (merged into
 * its own scope when it writes more) before `applyTeamChange`.
 */
export function teamChangeScope(
	target: TeamPlacementTarget,
): AuthorizationMutationScope {
	return {
		organizationId: target.organizationId,
		employeeIds: [target.employeeId],
	};
}

/**
 * Applies `change` in the caller's transaction, which holds `teamChangeScope(change)`. When
 * the primary team changes, the driving authorizations of an employee who stops being an
 * intended driver end, and the outcome must match the warning the actor confirmed
 * (`previewToken`; without one, nobody may be affected), else `DrivingLicenceStalePreviewError`.
 * A change that keeps the primary team ends nothing, so it ignores the token.
 */
export async function applyTeamChange(
	tx: TeamChangeTransaction,
	change: TeamChange,
	options: TeamChangeActor & { previewToken?: string },
): Promise<TeamPlacementPlan> {
	const planned = await planChange(tx, change);
	if (!planned) return EMPLOYEE_GONE;
	const target = { ...change, createdBy: options.actorUserId };
	if (!movesPrimaryTeam(planned)) return writePlan(tx, target, planned);
	return runDrivingLicenceIntendedDriverWrite(
		tx,
		{
			organizationId: change.organizationId,
			employeeIds: [change.employeeId],
			actorUserId: options.actorUserId,
			viewer: options.viewer,
			previewToken: options.previewToken,
		},
		(write) => writePlan(write, target, planned),
	);
}

/**
 * The warning before `change`: what `viewer` may see of the driving authorizations it would
 * end, and the token `applyTeamChange` takes. Runs the change under its protection in a
 * transaction of `database` and rolls it back; a change that keeps the primary team ends
 * nothing and takes no driving licence lock.
 */
export function previewTeamChange(
	database: Pick<typeof db, "transaction">,
	change: TeamChange,
	viewer: DrivingLicenceChangeViewer,
): Promise<DrivingLicenceTeamChangeImpact> {
	// Planned in `changesIntendedDrivers`, which runs first in the preview transaction, and
	// written by the write that follows it there.
	let planned: Planned | null = null;
	return previewDrivingLicenceIntendedDriverWrite<Transaction>(
		{
			organizationId: change.organizationId,
			employeeIds: [change.employeeId],
			viewer,
			changesIntendedDrivers: async (tx) => {
				planned = await planChange(tx, change);
				return planned !== null && movesPrimaryTeam(planned);
			},
		},
		(work) =>
			withAuthorizationMutation(teamChangeScope(change), work, database),
		async (tx) => {
			if (planned) await writePlan(tx, change, planned);
		},
	);
}

/**
 * The warning for a save that leaves the employee's team placement alone, such as a scoped
 * manager's, who can't change the team: nothing ends, in the detail `viewer` would see.
 */
export function previewUnchangedTeamPlacement(
	database: Pick<typeof db, "transaction">,
	target: TeamPlacementTarget,
	viewer: DrivingLicenceChangeViewer,
): Promise<DrivingLicenceTeamChangeImpact> {
	return previewDrivingLicenceIntendedDriverWrite<Transaction>(
		{
			organizationId: target.organizationId,
			employeeIds: [target.employeeId],
			viewer,
			changesIntendedDrivers: async () => false,
		},
		(work) =>
			withAuthorizationMutation(teamChangeScope(target), work, database),
		async () => {},
	);
}

/**
 * The refusals of a team change, for the user: a team outside the organization becomes a
 * `ValidationError` on `teamId`, a stale driving licence warning the `stale_preview` refusal.
 */
export function keepTeamChangeRefusals<A, E, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | ValidationError, R> {
	return keepDrivingLicenceStalePreview(effect).pipe(
		Effect.catch(
			(
				error: E | ValidationError,
			): Effect.Effect<never, E | ValidationError> => {
				const cause = error instanceof DatabaseError ? error.cause : error;
				return cause instanceof TeamNotInOrganization
					? Effect.fail(
							new ValidationError({
								message: cause.message,
								field: "teamId",
								value: cause.teamId,
							}),
						)
					: Effect.fail(error);
			},
		),
	);
}

/**
 * Places a new or returning employee in `teamId` in the caller's transaction, as a move: the
 * team becomes a membership and the primary team, and `null` (a rehire into no team) ends the
 * old primary membership. A caller with no team to place skips the call, since `null` is not
 * "leave it". An arriving employee holds no driving authorization (departure and deactivation
 * end them, and they belong to an employment period), so nothing ends.
 */
export async function placeArrivingEmployee(
	tx: TeamPlacementWriter,
	input: {
		organizationId: string;
		employeeId: string;
		teamId: string | null;
		createdBy?: string | null;
	},
): Promise<TeamPlacementPlan> {
	const planned = await planChange(tx, { ...input, kind: "move" });
	return planned ? writePlan(tx, input, planned) : EMPLOYEE_GONE;
}

/**
 * Ends every team membership of a leaving employee in the caller's transaction and leaves no
 * primary team. Their driving authorizations end with the deactivation itself. Returns the
 * teams whose membership ended.
 */
export async function releaseLeavingEmployee(
	tx: TeamPlacementWriter,
	input: TeamPlacementTarget,
): Promise<{ endedTeamIds: string[] }> {
	const { organizationId, employeeId } = input;
	await tx
		.update(employee)
		.set({ teamId: null, updatedAt: currentTimestamp() })
		.where(
			and(
				eq(employee.id, employeeId),
				eq(employee.organizationId, organizationId),
				isNotNull(employee.teamId),
			),
		);
	const ended = await tx
		.delete(teamMembership)
		.where(
			and(
				eq(teamMembership.organizationId, organizationId),
				eq(teamMembership.employeeId, employeeId),
			),
		)
		.returning({ teamId: teamMembership.teamId });
	return { endedTeamIds: ended.map((row) => row.teamId) };
}
