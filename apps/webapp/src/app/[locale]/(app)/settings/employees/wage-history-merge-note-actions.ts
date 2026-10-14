"use server";

import { Effect } from "effect";
import { z } from "zod";
import { ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	dismissWageHistoryMergeNote,
	loadWageHistoryMergeNote,
	type WageHistoryMergeNote,
} from "@/lib/employment-history/wage-history-merge-note";
import {
	getEmployeeSettingsActorContext,
	requireOrgAdminEmployeeSettingsAccess,
} from "./employee-action-utils";

const employeeIdSchema = z.uuid();

/** The org admin of the employee's organization; managers and employees are refused. */
function orgAdminFor(employeeId: string, action: "read" | "dismiss") {
	return Effect.gen(function* () {
		if (!employeeIdSchema.safeParse(employeeId).success) {
			return yield* Effect.fail(
				new ValidationError({ message: "Invalid employee", field: "employeeId" }),
			);
		}
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: `wageHistoryMergeNote.${action}:actor`,
		});
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only owners and admins can see the wage history merge note",
			resource: "wage_history_merge_note",
			action,
		});
		return actor;
	});
}

/**
 * The one-time note that the employee's wage history was merged from the old rate history
 * (#1176), for org admins only; null when there is none or it was dismissed.
 */
export async function getWageHistoryMergeNoteAction(
	employeeId: string,
): Promise<ServerActionResult<WageHistoryMergeNote | null>> {
	const effect = Effect.gen(function* () {
		const actor = yield* orgAdminFor(employeeId, "read");
		const dbService = yield* DatabaseService;
		return yield* dbService.query("wageHistoryMergeNote.load", () =>
			loadWageHistoryMergeNote(dbService.db, {
				organizationId: actor.organizationId,
				employeeId,
			}),
		);
	});

	return runServerActionSafe(effect);
}

/** Dismisses the employee's note for every org admin of the organization, for good. */
export async function dismissWageHistoryMergeNoteAction(
	employeeId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const actor = yield* orgAdminFor(employeeId, "dismiss");
		const dbService = yield* DatabaseService;
		yield* dbService.query("wageHistoryMergeNote.dismiss", () =>
			dismissWageHistoryMergeNote(dbService.db, {
				organizationId: actor.organizationId,
				employeeId,
				actorUserId: actor.session.user.id,
			}),
		);
	});

	return runServerActionSafe(effect);
}
