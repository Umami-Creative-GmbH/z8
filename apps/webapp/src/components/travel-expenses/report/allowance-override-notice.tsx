"use client";

import { IconAlertTriangle, IconShieldCheck } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type {
	AllowanceOverride,
	AllowanceOverrideStaleReason,
	AllowanceSituation,
} from "@/lib/travel-expenses/allowance-override";
import { formatMoney, formatRecordedInstant } from "./format";

type Translate = ReturnType<typeof useTranslate>["t"];

/** What a notice shows of an override, live (editor) or frozen (submitted). */
export type AllowanceOverrideSummary = Pick<
	AllowanceOverride,
	| "amount"
	| "currency"
	| "reason"
	| "evidence"
	| "calculationBasis"
	| "situation"
	| "authorizedBy"
	| "authorizedAt"
> & {
	/** False when the facts or the situation changed since it was authorized; frozen overrides always apply. */
	applies?: boolean;
	/** Why it no longer applies. */
	staleReason?: AllowanceOverrideStaleReason | null;
};

export function allowanceSituationLabel(t: Translate, situation: AllowanceSituation) {
	switch (situation.kind) {
		case "missing_coverage":
			return t(
				"travelExpenses.allowanceOverride.situation.missingCoverage",
				"No organization policy covers it",
			);
		case "unsupported_case":
			return t(
				"travelExpenses.allowanceOverride.situation.unsupported",
				"Not covered by the supported calculation rules",
			);
		case "official_fallback":
			return t(
				"travelExpenses.allowanceOverride.situation.fallback",
				"Calculated with an official fallback rate",
			);
		case "missing_facts":
			return t(
				"travelExpenses.allowanceOverride.situation.missingFacts",
				"Required travel facts are missing",
			);
		case "calculated":
			return t("travelExpenses.allowanceOverride.situation.calculated", "Calculated by the policy");
	}
}

/**
 * An allowance an expense administrator set manually (#610), shown to the
 * employee and the reviewer wherever the expense appears: the amount, why it
 * was not calculated, the reason, evidence and calculation basis, who
 * authorized it, and the ordinary policy result when one exists. An override
 * for facts that have since changed is shown as no longer applying.
 */
export function AllowanceOverrideNotice({
	override,
	ordinary,
}: {
	override: AllowanceOverrideSummary;
	/** The policy's own result for the same facts, when it can price them. */
	ordinary: { amount: string; currency: string } | null;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const stale = override.applies === false;
	return (
		<Alert
			className="mt-2 border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
			role="note"
		>
			{stale ? (
				<IconAlertTriangle aria-hidden="true" className="size-4" />
			) : (
				<IconShieldCheck aria-hidden="true" className="size-4" />
			)}
			<AlertTitle>
				{t(
					"travelExpenses.allowanceOverride.title",
					"Allowance set manually by an expense administrator",
				)}
			</AlertTitle>
			<AlertDescription>
				{stale && (
					<p className="font-medium text-foreground">
						{override.staleReason === "situation_resolved"
							? t(
									"travelExpenses.allowanceOverride.situationResolved",
									"This manual allowance no longer applies: the reason it was authorized for has changed (for example, a policy now covers these facts). The calculated allowance counts where there is one; otherwise an expense administrator must review it.",
								)
							: t(
									"travelExpenses.allowanceOverride.stale",
									"This manual allowance was authorized for different facts and no longer applies. An expense administrator must review the changed facts.",
								)}
					</p>
				)}
				<dl className="grid gap-x-3 gap-y-0.5 text-sm sm:grid-cols-[auto_1fr]">
					<dt className="text-muted-foreground">
						{t("travelExpenses.allowanceOverride.amount", "Amount")}
					</dt>
					<dd className="font-medium tabular-nums text-foreground">
						{formatMoney(locale, override.amount, override.currency)}
					</dd>
					<dt className="text-muted-foreground">
						{t("travelExpenses.allowanceOverride.situationLabel", "Why not calculated")}
					</dt>
					<dd>{allowanceSituationLabel(t, override.situation)}</dd>
					<dt className="text-muted-foreground">
						{t("travelExpenses.allowanceOverride.reason", "Reason")}
					</dt>
					<dd className="break-words">{override.reason}</dd>
					<dt className="text-muted-foreground">
						{t("travelExpenses.allowanceOverride.evidence", "Evidence")}
					</dt>
					<dd className="break-words">{override.evidence}</dd>
					<dt className="text-muted-foreground">
						{t("travelExpenses.allowanceOverride.basis", "Calculation")}
					</dt>
					<dd className="break-words">{override.calculationBasis}</dd>
					<dt className="text-muted-foreground">
						{t("travelExpenses.allowanceOverride.authorizedBy", "Authorized by")}
					</dt>
					<dd>
						{t("travelExpenses.allowanceOverride.authorizedByValue", "{name}, {date}", {
							name: override.authorizedBy.name,
							date: formatRecordedInstant(locale, override.authorizedAt),
						})}
					</dd>
				</dl>
				<p className="text-muted-foreground">
					{ordinary
						? t(
								"travelExpenses.allowanceOverride.ordinary",
								"The policy would calculate {amount}.",
								{ amount: formatMoney(locale, ordinary.amount, ordinary.currency) },
							)
						: t(
								"travelExpenses.allowanceOverride.noOrdinary",
								"No ordinary calculation exists for these facts.",
							)}
				</p>
			</AlertDescription>
		</Alert>
	);
}
