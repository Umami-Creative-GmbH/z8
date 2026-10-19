import type { formatDays } from "@/lib/absences/date-utils";

type TranslateFn = Parameters<typeof formatDays>[1];

/** The refusal of vacation that covers no working day, in the viewer's language (#979). */
export function noWorkingDaysMessage(t: TranslateFn) {
	return t("absences.planPreview.noWorkingDays", "This range contains no working days.");
}
