"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ValidationError } from "@/lib/effect/errors";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { personnelFileStoreWork, whilePersonnelFilesOn } from "@/lib/personnel-file/administration";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/lib/personnel-file/document.types";
import { loadRetentionPeriods, saveRetentionPeriods } from "@/lib/personnel-file/retention-store";
import {
	type RetentionSuggestion,
	SUGGESTED_RETENTION_PERIODS,
} from "@/lib/personnel-file/retention-suggestions";

/**
 * Retention periods per document category (#870), on the Retention tab of
 * Settings → Personnel files. Owners and admins only, while personnel files
 * are on.
 */

export interface PersonnelFileRetentionSettings {
	/** Whole years per category; null means the category has no period. */
	periods: Record<DocumentCategory, number | null>;
	suggestions: Record<DocumentCategory, Pick<RetentionSuggestion, "years">>;
}

const OFF_MESSAGE = "Only owners and admins can manage personnel file officers";
const INVALID_PERIOD_MESSAGE =
	"Enter a retention period in whole years between 1 and 100, or leave it empty.";

/** Periods by category: a number of years, null for none, or absent to leave it. */
const retentionSettingsSchema = z.strictObject({
	periods: z.partialRecord(
		z.enum(DOCUMENT_CATEGORIES),
		z.number(INVALID_PERIOD_MESSAGE).nullable(),
		"Choose a retention period per document category.",
	),
});

export const getPersonnelFileRetentionSettingsAction = organizationAction(
	{ name: "personnelFile.retentionSettings", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		whilePersonnelFilesOn(
			organizationId,
			OFF_MESSAGE,
			personnelFileStoreWork(
				"personnelFile.retentionSettings",
				async (db): Promise<PersonnelFileRetentionSettings> => {
					const stored = await loadRetentionPeriods(db, organizationId);
					const periods = {} as Record<DocumentCategory, number | null>;
					const suggestions = {} as Record<DocumentCategory, Pick<RetentionSuggestion, "years">>;
					for (const category of DOCUMENT_CATEGORIES) {
						periods[category] = stored[category] ?? null;
						suggestions[category] = { years: SUGGESTED_RETENTION_PERIODS[category].years };
					}
					return { periods, suggestions };
				},
			),
		),
);

export const savePersonnelFileRetentionSettingsAction = organizationAction(
	{
		name: "personnelFile.saveRetentionSettings",
		requires: "orgAdmin",
		schema: retentionSettingsSchema,
	},
	({ actor, organizationId, input }) =>
		whilePersonnelFilesOn(
			organizationId,
			OFF_MESSAGE,
			Effect.gen(function* () {
				const result = yield* personnelFileStoreWork("personnelFile.saveRetentionSettings", (db) =>
					saveRetentionPeriods(db, {
						organizationId,
						actorUserId: actor.userId,
						periods: input.periods,
					}),
				);
				if (result.kind === "invalid") {
					return yield* Effect.fail(
						new ValidationError({
							message: INVALID_PERIOD_MESSAGE,
							field: `periods.${result.category}`,
							refusal: `invalid_${result.category}`,
						}),
					);
				}
				revalidatePath("/settings/personnel-files");
				revalidatePath("/personnel-files");
				return { changed: result.changed };
			}),
		),
);
