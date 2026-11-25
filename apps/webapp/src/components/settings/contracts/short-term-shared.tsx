"use client";

import { useTolgee, type useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import type { StatutoryFindingAcknowledgement } from "@/lib/statutory/finding";

export type Translate = ReturnType<typeof useTranslate>["t"];

/** The UI language, for month and currency formatting. */
export function useFormattingLocale(): string {
	return useTolgee(["language"]).getLanguage() ?? "en";
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
