"use server";

import { Effect } from "effect";
import { z } from "zod";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	dismissWageHistoryMergeNote,
	loadWageHistoryMergeNote,
} from "@/lib/employment-history/wage-history-merge-note";
import { organizationAction } from "@/lib/organization-action/organization-action";

const employeeIdSchema = z.uuid("Invalid employee");

/**
 * The one-time note that the employee's wage history was merged from the old rate history
 * (#1176), for org admins only; null when there is none or it was dismissed.
 */
export const getWageHistoryMergeNoteAction = organizationAction(
	{ name: "wageHistoryMergeNote.load", requires: "orgAdmin", schema: employeeIdSchema },
	({ organizationId, input: employeeId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("wageHistoryMergeNote.load", () =>
				loadWageHistoryMergeNote(dbService.db, { organizationId, employeeId }),
			);
		}),
);

/** Dismisses the employee's note for every org admin of the organization, for good. */
export const dismissWageHistoryMergeNoteAction = organizationAction(
	{ name: "wageHistoryMergeNote.dismiss", requires: "orgAdmin", schema: employeeIdSchema },
	({ actor, organizationId, input: employeeId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("wageHistoryMergeNote.dismiss", () =>
				dismissWageHistoryMergeNote(dbService.db, {
					organizationId,
					employeeId,
					actorUserId: actor.userId,
				}),
			);
		}),
);
