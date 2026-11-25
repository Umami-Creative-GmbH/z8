import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type { RefusalMessages } from "@/lib/organization-action/action-error-message";
import type { StatutoryAcknowledgementRefusal } from "@/lib/statutory/acknowledgements";
import type { EmployeeContextRefusal } from "@/lib/statutory/employee-context";
import type { ShortTermAcknowledgementRefusal } from "@/lib/statutory/short-term/monitor";

// Shared short-term employment texts and formatting (#1990); components live in ./short-term-shared.

/** Texts for every refusal the short-term actions can return (#1990). */
export const SHORT_TERM_REFUSALS = {
	short_term_no_verification_prompt: [
		"settings.contracts.shortTerm.refusal.noPrompt",
		"This month's earnings no longer exceed the Minijob limit. Reload to see the current state.",
	],
	short_term_figures_changed: [
		"settings.contracts.shortTerm.refusal.figuresChanged",
		"This month's work, shifts or earnings changed since you opened it. Review the current figures and verify again.",
	],
	statutory_reason_required: [
		"settings.contracts.shortTerm.refusal.reasonRequired",
		"Explain how Berufsmäßigkeit was verified.",
	],
	statutory_subject_required: [
		"settings.contracts.shortTerm.refusal.subjectRequired",
		"This verification could not be recorded. Reload and try again.",
	],
	statutory_note_required: [
		"settings.contracts.shortTerm.refusal.noteRequired",
		"Add a note or reason.",
	],
	statutory_invalid_value: [
		"settings.contracts.shortTerm.refusal.invalidValue",
		"Enter whole working days (1–366) or months (1–12).",
	],
	statutory_invalid_range: [
		"settings.contracts.shortTerm.refusal.invalidRange",
		"Choose a valid calendar year.",
	],
	statutory_period_overlap: [
		"settings.contracts.shortTerm.refusal.overlap",
		"This entry overlaps an existing one.",
	],
	statutory_release_single_day: [
		"settings.contracts.shortTerm.refusal.invalidRange",
		"Choose a valid calendar year.",
	],
} satisfies RefusalMessages<
	ShortTermAcknowledgementRefusal | StatutoryAcknowledgementRefusal | EmployeeContextRefusal
>;

export function formatMonth(month: string, locale: string): string {
	return formatPlainDate(parsePlainDate(`${month}-01`), locale, "monthYear");
}

export function formatCents(cents: number | undefined, currency: string, locale: string): string {
	return new Intl.NumberFormat(locale, { style: "currency", currency }).format((cents ?? 0) / 100);
}
