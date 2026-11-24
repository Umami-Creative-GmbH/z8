import type { RefusalMessages } from "@/lib/organization-action/action-error-message";
import type { StatutoryAcknowledgementRefusal } from "@/lib/statutory/acknowledgements";
import type { MinorContractorReviewRefusal } from "@/lib/statutory/youth/minor-contractor-review";

/** Every refusal documenting a minor contractor engagement can return, as admins read it. */
export const minorContractorReviewRefusals = {
	statutory_finding_not_found: [
		"settings.contracts.reviews.minorContractors.refusal.notFound",
		"This engagement no longer needs a review. The list shows the current ones.",
	],
	statutory_finding_changed: [
		"settings.contracts.reviews.minorContractors.refusal.changed",
		"The person's engagements or the birthday changed since this list was loaded, or the person is now on the roster as a contractor after the engagement ends. Review it again.",
	],
	statutory_reason_required: [
		"settings.contracts.reviews.minorContractors.refusal.reasonRequired",
		"Explain why the work does or does not fall under youth protection.",
	],
	statutory_subject_required: [
		"settings.contracts.reviews.minorContractors.refusal.subjectRequired",
		"This engagement cannot be documented. Reload the list and try again.",
	],
} as const satisfies RefusalMessages<
	MinorContractorReviewRefusal | StatutoryAcknowledgementRefusal
>;
