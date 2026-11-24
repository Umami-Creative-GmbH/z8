import type { useTranslate } from "@tolgee/react";
import type { EngagementCategoryRefusal } from "@/lib/absences/category-rules";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";

type Translate = ReturnType<typeof useTranslate>["t"];

/**
 * The absence refusals by engagement (#1996). The forms offer the categories of every stint a
 * person had; the server decides by the stints the chosen dates fall in and refuses the rest.
 */
const ENGAGEMENT_REFUSALS = {
	contractor_records_unavailability_only: [
		"common:engagement.absenceRefusals.contractorRecordsUnavailabilityOnly",
		"On these dates they work as an External Contractor: only unavailability can be recorded.",
	],
	unavailability_is_for_contractors: [
		"common:engagement.absenceRefusals.unavailabilityIsForContractors",
		"On these dates they are employed: unavailability is only for External Contractors.",
	],
	absence_spans_engagement_change: [
		"common:engagement.absenceRefusals.spansEngagementChange",
		"These dates span a change between employment and External Contractor work. Record each part separately.",
	],
} satisfies RefusalMessages<EngagementCategoryRefusal>;

/** The translated text of an engagement refusal (the failed result's `refusal`), or null. */
export function engagementRefusalText(t: Translate, refusal: string | undefined): string | null {
	return refusal !== undefined && Object.hasOwn(ENGAGEMENT_REFUSALS, refusal)
		? actionErrorMessage(t, { refusal }, ENGAGEMENT_REFUSALS)
		: null;
}
