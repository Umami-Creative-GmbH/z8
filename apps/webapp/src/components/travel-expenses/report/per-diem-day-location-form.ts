import {
	decodePerDiemLocation,
	encodePerDiemLocation,
	type PerDiemLocation,
} from "@/lib/travel-expenses/per-diem-location";

/** Location answers of one travel day as select values (`encodePerDiemLocation`). */
export interface DayLocationForm {
	night: string;
	activityAbroad: string;
}

export const NO_LOCATION: DayLocationForm = { night: "", activityAbroad: "" };

/** The day's location answers for the draft; unanswered fields are left out. */
export function dayLocationDraft(form: DayLocationForm | undefined): {
	night?: PerDiemLocation;
	activityAbroad?: PerDiemLocation;
} {
	const night = decodePerDiemLocation(form?.night ?? "");
	const activityAbroad = decodePerDiemLocation(form?.activityAbroad ?? "");
	return { ...(night ? { night } : {}), ...(activityAbroad ? { activityAbroad } : {}) };
}

export function dayLocationForm(day: {
	night?: PerDiemLocation | null;
	activityAbroad?: PerDiemLocation | null;
}): DayLocationForm {
	return {
		night: encodePerDiemLocation(day.night),
		activityAbroad: encodePerDiemLocation(day.activityAbroad),
	};
}
