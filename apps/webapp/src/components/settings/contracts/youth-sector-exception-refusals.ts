import type { RefusalMessages } from "@/lib/organization-action/action-error-message";
import type { StatutoryAcknowledgementRefusal } from "@/lib/statutory/acknowledgements";
import type { YouthSectorExceptionRefusal } from "@/lib/statutory/youth/sector-exception-review";

/** Every refusal recording a sector exception can return, as admins read it. */
export const youthSectorExceptionRefusals = {
	statutory_finding_not_found: [
		"settings.contracts.reviews.youth.refusal.notFound",
		"This finding is no longer open. The list shows the current findings.",
	],
	statutory_finding_changed: [
		"settings.contracts.reviews.youth.refusal.changed",
		"The shift changed since this list was loaded. Review it again before recording the exception.",
	],
	statutory_reason_required: [
		"settings.contracts.reviews.youth.refusal.reasonRequired",
		"Explain which sector exception applies.",
	],
	statutory_subject_required: [
		"settings.contracts.reviews.youth.refusal.subjectRequired",
		"This finding cannot be acknowledged. Reload the list and try again.",
	],
} as const satisfies RefusalMessages<YouthSectorExceptionRefusal | StatutoryAcknowledgementRefusal>;
