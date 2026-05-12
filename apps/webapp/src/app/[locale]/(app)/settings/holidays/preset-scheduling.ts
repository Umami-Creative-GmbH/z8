import { eq, isNull, ne, type SQL } from "drizzle-orm";
import { holidayPreset } from "@/db/schema";

type PresetLocationConflictInput = {
	countryCode?: string | null;
	stateCode?: string | null;
	regionCode?: string | null;
	year?: number | null;
};

type PresetLocationConflictOptions = {
	excludePresetId?: string;
};

export function assignmentRangesOverlap(
	leftFrom: Date | null | undefined,
	leftUntil: Date | null | undefined,
	rightFrom: Date | null | undefined,
	rightUntil: Date | null | undefined,
) {
	const minTime = Number.NEGATIVE_INFINITY;
	const maxTime = Number.POSITIVE_INFINITY;
	const leftStart = leftFrom?.getTime() ?? minTime;
	const leftEnd = leftUntil?.getTime() ?? maxTime;
	const rightStart = rightFrom?.getTime() ?? minTime;
	const rightEnd = rightUntil?.getTime() ?? maxTime;

	return leftStart <= rightEnd && rightStart <= leftEnd;
}

export function buildPresetLocationConflictConditions(
	organizationId: string,
	data: PresetLocationConflictInput,
	options: PresetLocationConflictOptions = {},
): SQL[] {
	const conditions: SQL[] = [eq(holidayPreset.organizationId, organizationId)];

	if (options.excludePresetId) {
		conditions.push(ne(holidayPreset.id, options.excludePresetId));
	}

	if (data.countryCode) {
		conditions.push(eq(holidayPreset.countryCode, data.countryCode));
	} else {
		conditions.push(isNull(holidayPreset.countryCode));
	}

	if (data.stateCode) {
		conditions.push(eq(holidayPreset.stateCode, data.stateCode));
	} else {
		conditions.push(isNull(holidayPreset.stateCode));
	}

	if (data.regionCode) {
		conditions.push(eq(holidayPreset.regionCode, data.regionCode));
	} else {
		conditions.push(isNull(holidayPreset.regionCode));
	}

	if (data.year) {
		conditions.push(eq(holidayPreset.year, data.year));
	} else {
		conditions.push(isNull(holidayPreset.year));
	}

	return conditions;
}
