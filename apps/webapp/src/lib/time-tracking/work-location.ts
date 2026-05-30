export const WORK_LOCATION_TYPES = ["office", "home", "remote", "other"] as const;

export type WorkLocationType = (typeof WORK_LOCATION_TYPES)[number];

const WORK_LOCATION_TYPE_SET = new Set<string>(WORK_LOCATION_TYPES);

export function isWorkLocationType(value: string | null | undefined): value is WorkLocationType {
	return typeof value === "string" && WORK_LOCATION_TYPE_SET.has(value);
}

export function normalizeWorkLocationType(value: string | null | undefined): WorkLocationType {
	if (value === "field") {
		return "remote";
	}

	if (value && WORK_LOCATION_TYPE_SET.has(value)) {
		return value as WorkLocationType;
	}

	return "office";
}
