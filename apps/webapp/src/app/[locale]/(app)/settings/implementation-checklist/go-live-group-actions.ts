"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DatabaseError, ValidationError } from "@/lib/effect/errors";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import { IMPLEMENTATION_CHECKLIST_PATH } from "@/lib/implementation-checklist/definition";
import {
	chooseGoLiveGroupTeams,
	createGoLiveExclusion,
	type GoLiveGroupCommandResult,
	type GoLiveGroupRefusal,
	liftGoLiveExclusion,
} from "@/lib/implementation-checklist/go-live/group-settings";
import { organizationAction } from "@/lib/organization-action/organization-action";

const REFUSAL_MESSAGES: Record<GoLiveGroupRefusal, string> = {
	team_not_found: "One of the chosen teams no longer exists.",
	employee_not_found: "This employee is not on the current roster.",
	reason_required: "Give a reason for the exclusion.",
	reason_too_long: "The reason is too long.",
	already_excluded: "This employee is already excluded.",
	exclusion_not_found: "This exclusion has already ended.",
};

const UPDATE_FAILED = "Failed to update the go-live group.";

/**
 * Runs one go-live group command for the caller's active organization, as the
 * caller. A refusal fails as a `ValidationError` whose `refusal` the client
 * translates; a failed write keeps its cause out of the message.
 */
function runGoLiveGroupCommand(
	name: string,
	command: (db: DatabaseClient) => Promise<GoLiveGroupCommandResult>,
) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const result = yield* dbService
			.query(name, () => command(dbService.db))
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({ message: UPDATE_FAILED, operation: name, cause: error.cause }),
				),
			);
		if (!result.ok) {
			return yield* Effect.fail(
				new ValidationError({ message: REFUSAL_MESSAGES[result.refusal], refusal: result.refusal }),
			);
		}
		revalidatePath(IMPLEMENTATION_CHECKLIST_PATH);
	});
}

/** Narrows the go-live group to the chosen teams, or to the whole roster with none. */
export const chooseGoLiveGroupTeamsAction = organizationAction(
	{
		name: "goLiveGroup.chooseTeams",
		requires: "orgAdmin",
		schema: z.array(z.string(REFUSAL_MESSAGES.team_not_found), REFUSAL_MESSAGES.team_not_found),
	},
	({ actor, organizationId, input: teamIds }) =>
		runGoLiveGroupCommand("goLiveGroup.chooseTeams", (db) =>
			chooseGoLiveGroupTeams(db, { organizationId, actorUserId: actor.userId, teamIds }),
		),
);

/** Leaves one employee out of the go-live group, for a required reason. */
export const createGoLiveExclusionAction = organizationAction(
	{
		name: "goLiveGroup.createExclusion",
		requires: "orgAdmin",
		schema: z.object({
			employeeId: z.string(REFUSAL_MESSAGES.employee_not_found),
			reason: z.string(REFUSAL_MESSAGES.reason_required),
		}),
	},
	({ actor, organizationId, input }) =>
		runGoLiveGroupCommand("goLiveGroup.createExclusion", (db) =>
			createGoLiveExclusion(db, {
				organizationId,
				actorUserId: actor.userId,
				employeeId: input.employeeId,
				reason: input.reason,
			}),
		),
);

/** Lifts a go-live exclusion, bringing the employee back into the checks. */
export const liftGoLiveExclusionAction = organizationAction(
	{
		name: "goLiveGroup.liftExclusion",
		requires: "orgAdmin",
		schema: z.string(REFUSAL_MESSAGES.exclusion_not_found),
	},
	({ actor, organizationId, input: exclusionId }) =>
		runGoLiveGroupCommand("goLiveGroup.liftExclusion", (db) =>
			liftGoLiveExclusion(db, { organizationId, actorUserId: actor.userId, exclusionId }),
		),
);
