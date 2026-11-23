import { eq } from "drizzle-orm";
import { organizationStatutoryPreference } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";

/** Organization statutory warning tiers; percentages of a statutory cap (1..100, warning < critical). */
export interface StatutoryPreferences {
	readonly warningThresholdPercent: number;
	readonly criticalThresholdPercent: number;
	/** When true, JArbSchG hard-limit breaches block shift publication (never clock-in/out). */
	readonly blockJarbschgShiftPublish: boolean;
}

export interface LoadedStatutoryPreferences extends StatutoryPreferences {
	/** True when the organization never saved preferences and the defaults apply. */
	readonly isDefault: boolean;
}

export const DEFAULT_STATUTORY_PREFERENCES: StatutoryPreferences = Object.freeze({
	warningThresholdPercent: 80,
	criticalThresholdPercent: 95,
	blockJarbschgShiftPublish: false,
});

export type StatutoryPreferenceRefusal =
	| "statutory_percent_out_of_range"
	| "statutory_warning_not_below_critical";

export async function loadOrganizationStatutoryPreferences(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
): Promise<LoadedStatutoryPreferences> {
	const [row] = await db
		.select({
			warningThresholdPercent: organizationStatutoryPreference.warningThresholdPercent,
			criticalThresholdPercent: organizationStatutoryPreference.criticalThresholdPercent,
			blockJarbschgShiftPublish: organizationStatutoryPreference.blockJarbschgShiftPublish,
		})
		.from(organizationStatutoryPreference)
		.where(eq(organizationStatutoryPreference.organizationId, organizationId))
		.limit(1);
	return row ? { ...row, isDefault: false } : { ...DEFAULT_STATUTORY_PREFERENCES, isDefault: true };
}

/** Validates tiers; throws a `ValidationError` with a `StatutoryPreferenceRefusal`. */
export function validateStatutoryPreferences(input: StatutoryPreferences): void {
	for (const [field, value] of [
		["warningThresholdPercent", input.warningThresholdPercent],
		["criticalThresholdPercent", input.criticalThresholdPercent],
	] as const) {
		if (!Number.isInteger(value) || value < 1 || value > 100) {
			throw new ValidationError({
				message: "Warning percentages must be whole numbers from 1 to 100",
				field,
				value,
				refusal: "statutory_percent_out_of_range" satisfies StatutoryPreferenceRefusal,
			});
		}
	}
	if (input.warningThresholdPercent >= input.criticalThresholdPercent) {
		throw new ValidationError({
			message: "The warning percentage must be below the critical percentage",
			field: "warningThresholdPercent",
			value: input.warningThresholdPercent,
			refusal: "statutory_warning_not_below_critical" satisfies StatutoryPreferenceRefusal,
		});
	}
}

/** Org-admin write; the caller authorizes (`organizationAction` with `requires: "orgAdmin"`). */
export async function saveOrganizationStatutoryPreferences(
	db: Pick<DatabaseClient, "insert">,
	input: StatutoryPreferences & { organizationId: string; actorUserId: string },
): Promise<LoadedStatutoryPreferences> {
	validateStatutoryPreferences(input);
	const values = {
		warningThresholdPercent: input.warningThresholdPercent,
		criticalThresholdPercent: input.criticalThresholdPercent,
		blockJarbschgShiftPublish: input.blockJarbschgShiftPublish,
		updatedBy: input.actorUserId,
	};
	await db
		.insert(organizationStatutoryPreference)
		.values({ organizationId: input.organizationId, ...values })
		.onConflictDoUpdate({
			target: organizationStatutoryPreference.organizationId,
			set: { ...values, updatedAt: currentTimestamp() },
		});
	return {
		warningThresholdPercent: input.warningThresholdPercent,
		criticalThresholdPercent: input.criticalThresholdPercent,
		blockJarbschgShiftPublish: input.blockJarbschgShiftPublish,
		isDefault: false,
	};
}
