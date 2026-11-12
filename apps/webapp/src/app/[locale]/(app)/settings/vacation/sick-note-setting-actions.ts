"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { saveEmployeeSickNoteUpload } from "@/lib/absences/absence-settings";
import { ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { organizationAction } from "@/lib/organization-action/organization-action";

/** The refusal when sick notes are turned on while personnel files are off. */
const PERSONNEL_FILES_DISABLED_REFUSAL = "personnel_files_disabled";

/**
 * "Employees can attach sick notes" (#982): an absence setting owners and
 * admins change. It can be turned on only while personnel files are on.
 */
export const saveEmployeeSickNoteUploadAction = organizationAction(
	{
		name: "vacation.saveEmployeeSickNoteUpload",
		requires: "orgAdmin",
		schema: z.strictObject({ enabled: z.boolean({ error: "Invalid setting" }) }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query("vacation.saveEmployeeSickNoteUpload", () =>
				saveEmployeeSickNoteUpload(dbService.db, {
					organizationId,
					enabled: input.enabled,
					actorUserId: actor.userId,
				}),
			);
			if (result.kind === "personnel_files_disabled") {
				return yield* Effect.fail(
					new ValidationError({
						message: "Turn on personnel files first: sick notes are stored there.",
						field: "enabled",
						refusal: PERSONNEL_FILES_DISABLED_REFUSAL,
					}),
				);
			}
			revalidatePath("/settings/vacation");
			revalidatePath("/absences");
			return { employeeSickNoteUpload: result.employeeSickNoteUpload };
		}),
);
