"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { DatabaseError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	confirmImplementationChecklistItem,
	unconfirmImplementationChecklistItem,
} from "@/lib/implementation-checklist/confirmation/store";
import {
	IMPLEMENTATION_CHECKLIST_ITEMS,
	IMPLEMENTATION_CHECKLIST_PATH,
	type ImplementationChecklistItemId,
	isImplementationChecklistItemId,
} from "@/lib/implementation-checklist/definition";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { loadImplementationChecklistForContext } from "./queries";

export type { ImplementationChecklistViewModel } from "./queries";

const IMPLEMENTATION_CHECKLIST_MUTATION_ERROR = "Failed to update checklist item.";

/** An item an org admin may confirm or unconfirm by hand. */
const manualItemId = z
	.custom<ImplementationChecklistItemId>(
		(value) => typeof value === "string" && isImplementationChecklistItemId(value),
		"Unknown implementation checklist item",
	)
	.refine(
		(itemId) =>
			IMPLEMENTATION_CHECKLIST_ITEMS.find((item) => item.id === itemId)?.canManualComplete === true,
		"Implementation checklist item cannot be manually completed",
	);

/** A failed write, with a message safe to show the admin. */
function mutationFailure(operation: string) {
	return (error: DatabaseError) =>
		new DatabaseError({
			message: IMPLEMENTATION_CHECKLIST_MUTATION_ERROR,
			operation,
			cause: error.cause,
		});
}

export const getImplementationChecklist = organizationAction(
	{ name: "implementationChecklist.load", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("implementationChecklist.load", () =>
				loadImplementationChecklistForContext({ organizationId, userId: actor.userId }),
			);
		}),
);

export const markImplementationChecklistItemComplete = organizationAction(
	{ name: "implementationChecklist.confirmItem", requires: "orgAdmin", schema: manualItemId },
	({ actor, organizationId, input: itemId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService
				.query("implementationChecklist.confirmItem", () =>
					confirmImplementationChecklistItem(dbService.db, {
						organizationId,
						itemId,
						actorUserId: actor.userId,
						confirmedAt: dateFromInstant(systemClock.nowInstant()),
					}),
				)
				.pipe(Effect.mapError(mutationFailure("implementationChecklist.confirmItem")));
			revalidatePath(IMPLEMENTATION_CHECKLIST_PATH);
		}),
);

export const markImplementationChecklistItemIncomplete = organizationAction(
	{ name: "implementationChecklist.unconfirmItem", requires: "orgAdmin", schema: manualItemId },
	({ actor, organizationId, input: itemId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService
				.query("implementationChecklist.unconfirmItem", () =>
					unconfirmImplementationChecklistItem(dbService.db, {
						organizationId,
						itemId,
						actorUserId: actor.userId,
					}),
				)
				.pipe(Effect.mapError(mutationFailure("implementationChecklist.unconfirmItem")));
			revalidatePath(IMPLEMENTATION_CHECKLIST_PATH);
		}),
);
