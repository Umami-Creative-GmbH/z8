import { eq } from "drizzle-orm";
import { organizationStatutoryPreference } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	DEFAULT_WORKING_STUDENT_DAYTIME_END_MINUTE,
	DEFAULT_WORKING_STUDENT_DAYTIME_START_MINUTE,
	isWorkingStudentDaytimeMinute,
} from "./daytime-band";

/**
 * Organization statutory preferences: warning tiers (percentages of a statutory cap, 1..100,
 * warning < critical), the JArbSchG shift-publish block, whether minor contractors are judged
 * under JArbSchG, and the working-student daytime band.
 */
export interface StatutoryPreferences {
	readonly warningThresholdPercent: number;
	readonly criticalThresholdPercent: number;
	/** When true, JArbSchG hard-limit breaches block shift publication (never clock-in/out). */
	readonly blockJarbschgShiftPublish: boolean;
	/**
	 * When true, External Contractor days of minors are judged by the JArbSchG monitor like
	 * employee days (§ 1 Abs. 1 Nr. 3 JArbSchG); when false (default), each minor contractor
	 * engagement is flagged for review instead (#2022). Other monitors never judge contractors.
	 */
	readonly applyJarbschgToMinorContractors: boolean;
	/**
	 * Weekday daytime that counts against the working students' 20-hour lecture-week rule
	 * (§ 6 Abs. 1 Nr. 3 SGB V), as minutes after local midnight: `[start, end)`, whole quarter
	 * hours, 0 ≤ start < end ≤ 1440. Work outside it (evenings, nights) does not count.
	 */
	readonly workingStudentDaytimeStartMinute: number;
	readonly workingStudentDaytimeEndMinute: number;
}

export interface LoadedStatutoryPreferences extends StatutoryPreferences {
	/** True when the organization never saved preferences and the defaults apply. */
	readonly isDefault: boolean;
}

export const DEFAULT_STATUTORY_PREFERENCES: StatutoryPreferences = Object.freeze({
	warningThresholdPercent: 80,
	criticalThresholdPercent: 95,
	blockJarbschgShiftPublish: false,
	applyJarbschgToMinorContractors: false,
	workingStudentDaytimeStartMinute: DEFAULT_WORKING_STUDENT_DAYTIME_START_MINUTE,
	workingStudentDaytimeEndMinute: DEFAULT_WORKING_STUDENT_DAYTIME_END_MINUTE,
});

export type StatutoryPreferenceRefusal =
	| "statutory_percent_out_of_range"
	| "statutory_warning_not_below_critical"
	| "statutory_daytime_band_out_of_range"
	| "statutory_daytime_band_start_not_before_end";

/**
 * The preference columns, read when a query runs rather than when the module loads: services far
 * from statutory work import this module, and their unit tests mock `@/db/schema` without it.
 */
const preferenceColumns = () => ({
	warningThresholdPercent: organizationStatutoryPreference.warningThresholdPercent,
	criticalThresholdPercent: organizationStatutoryPreference.criticalThresholdPercent,
	blockJarbschgShiftPublish: organizationStatutoryPreference.blockJarbschgShiftPublish,
	applyJarbschgToMinorContractors: organizationStatutoryPreference.applyJarbschgToMinorContractors,
	workingStudentDaytimeStartMinute:
		organizationStatutoryPreference.workingStudentDaytimeStartMinute,
	workingStudentDaytimeEndMinute: organizationStatutoryPreference.workingStudentDaytimeEndMinute,
});

export async function loadOrganizationStatutoryPreferences(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
): Promise<LoadedStatutoryPreferences> {
	const [row] = await db
		.select(preferenceColumns())
		.from(organizationStatutoryPreference)
		.where(eq(organizationStatutoryPreference.organizationId, organizationId))
		.limit(1);
	return row ? { ...row, isDefault: false } : { ...DEFAULT_STATUTORY_PREFERENCES, isDefault: true };
}

/** Validates tiers and the daytime band; throws a `ValidationError` with a `StatutoryPreferenceRefusal`. */
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
	for (const [field, value] of [
		["workingStudentDaytimeStartMinute", input.workingStudentDaytimeStartMinute],
		["workingStudentDaytimeEndMinute", input.workingStudentDaytimeEndMinute],
	] as const) {
		if (!isWorkingStudentDaytimeMinute(value)) {
			throw new ValidationError({
				message: "The daytime band must use whole quarter hours from 00:00 to 24:00",
				field,
				value,
				refusal: "statutory_daytime_band_out_of_range" satisfies StatutoryPreferenceRefusal,
			});
		}
	}
	if (input.workingStudentDaytimeStartMinute >= input.workingStudentDaytimeEndMinute) {
		throw new ValidationError({
			message: "The daytime band must start before it ends",
			field: "workingStudentDaytimeStartMinute",
			value: input.workingStudentDaytimeStartMinute,
			refusal: "statutory_daytime_band_start_not_before_end" satisfies StatutoryPreferenceRefusal,
		});
	}
}

/**
 * Org-admin write; the caller authorizes (`organizationAction` with `requires: "orgAdmin"`).
 * Returns the stored preferences and the ones they replaced (for the audit log).
 */
export async function saveOrganizationStatutoryPreferences(
	db: Pick<DatabaseClient, "insert" | "select">,
	input: StatutoryPreferences & { organizationId: string; actorUserId: string },
): Promise<LoadedStatutoryPreferences & { readonly previous: LoadedStatutoryPreferences }> {
	validateStatutoryPreferences(input);
	const previous = await loadOrganizationStatutoryPreferences(db, input.organizationId);
	const preferences: StatutoryPreferences = {
		warningThresholdPercent: input.warningThresholdPercent,
		criticalThresholdPercent: input.criticalThresholdPercent,
		blockJarbschgShiftPublish: input.blockJarbschgShiftPublish,
		applyJarbschgToMinorContractors: input.applyJarbschgToMinorContractors,
		workingStudentDaytimeStartMinute: input.workingStudentDaytimeStartMinute,
		workingStudentDaytimeEndMinute: input.workingStudentDaytimeEndMinute,
	};
	const values = { ...preferences, updatedBy: input.actorUserId };
	await db
		.insert(organizationStatutoryPreference)
		.values({ organizationId: input.organizationId, ...values })
		.onConflictDoUpdate({
			target: organizationStatutoryPreference.organizationId,
			set: { ...values, updatedAt: currentTimestamp() },
		});
	return { ...preferences, isDefault: false, previous };
}
