"use client";

import { useTolgee, type useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type { RefusalMessages } from "@/lib/organization-action/action-error-message";
import type { StatutoryAcknowledgementRefusal } from "@/lib/statutory/acknowledgements";
import type { EmployeeContextRefusal } from "@/lib/statutory/employee-context";
import type { StatutoryFindingAcknowledgement } from "@/lib/statutory/finding";
import type { ShortTermAcknowledgementRefusal } from "@/lib/statutory/short-term/monitor";

export type Translate = ReturnType<typeof useTranslate>["t"];

/** Texts for every refusal the short-term actions can return (#1990). */
export const SHORT_TERM_REFUSALS = {
	short_term_no_verification_prompt: [
		"settings.contracts.shortTerm.refusal.noPrompt",
		"This month's earnings no longer exceed the Minijob limit. Reload to see the current state.",
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

/** The UI language, for month and currency formatting. */
export function useFormattingLocale(): string {
	return useTolgee(["language"]).getLanguage() ?? "en";
}

export function formatMonth(month: string, locale: string): string {
	return formatPlainDate(parsePlainDate(`${month}-01`), locale, "monthYear");
}

export function formatCents(cents: number | undefined, currency: string, locale: string): string {
	return new Intl.NumberFormat(locale, { style: "currency", currency }).format((cents ?? 0) / 100);
}

/** Where a Berufsmäßigkeit prompt stands. */
export function VerificationStatusBadge({
	acknowledgement,
	t,
}: {
	acknowledgement: StatutoryFindingAcknowledgement | undefined;
	t: Translate;
}) {
	switch (acknowledgement?.status) {
		case "current":
			return (
				<Badge variant="secondary">
					{t("settings.contracts.shortTerm.verification.verified", "Verified")}
				</Badge>
			);
		case "stale":
			return (
				<Badge variant="destructive">
					{t(
						"settings.contracts.shortTerm.verification.stale",
						"Verify again: work or shifts changed",
					)}
				</Badge>
			);
		default:
			return (
				<Badge variant="destructive">
					{t("settings.contracts.shortTerm.verification.needed", "Verification needed")}
				</Badge>
			);
	}
}
