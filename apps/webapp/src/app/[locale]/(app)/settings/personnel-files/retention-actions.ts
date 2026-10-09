"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { requirePersonnelFileAdministrator } from "@/lib/personnel-file/administrator";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/lib/personnel-file/document.types";
import {
	loadRetentionPeriods,
	type RetentionPeriodsInput,
	saveRetentionPeriods,
} from "@/lib/personnel-file/retention-store";
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

export async function getPersonnelFileRetentionSettingsAction(): Promise<
	ServerActionResult<PersonnelFileRetentionSettings>
> {
	try {
		const access = await requirePersonnelFileAdministrator();
		if ("error" in access) return { success: false, error: access.error };
		const stored = await loadRetentionPeriods(db, access.organizationId);
		const periods = {} as Record<DocumentCategory, number | null>;
		const suggestions = {} as Record<DocumentCategory, Pick<RetentionSuggestion, "years">>;
		for (const category of DOCUMENT_CATEGORIES) {
			periods[category] = stored[category] ?? null;
			suggestions[category] = { years: SUGGESTED_RETENTION_PERIODS[category].years };
		}
		return { success: true, data: { periods, suggestions } };
	} catch (error) {
		logger.error({ error }, "Failed to load the retention periods");
		return { success: false, error: "Failed to load the retention periods" };
	}
}

export async function savePersonnelFileRetentionSettingsAction(input: {
	periods: RetentionPeriodsInput;
}): Promise<ServerActionResult<{ changed: DocumentCategory[] }>> {
	try {
		const access = await requirePersonnelFileAdministrator();
		if ("error" in access) return { success: false, error: access.error };
		const periods: RetentionPeriodsInput = {};
		for (const category of DOCUMENT_CATEGORIES) {
			const value = input?.periods?.[category];
			if (value === undefined) continue;
			periods[category] = value === null ? null : (value as number);
		}
		const result = await saveRetentionPeriods(db, {
			organizationId: access.organizationId,
			actorUserId: access.userId,
			periods,
		});
		if (result.kind === "invalid") {
			return {
				success: false,
				error: "Enter a retention period in whole years between 1 and 100, or leave it empty.",
				code: `invalid_${result.category}`,
			};
		}
		revalidatePath("/settings/personnel-files");
		revalidatePath("/personnel-files");
		return { success: true, data: { changed: result.changed } };
	} catch (error) {
		logger.error({ error }, "Failed to save the retention periods");
		return { success: false, error: "Failed to save the retention periods" };
	}
}
