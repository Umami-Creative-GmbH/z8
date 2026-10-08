"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { CurrencySettlement, SettlementSummary } from "@/lib/travel-expenses/settlement";
import { formatMoney } from "../report/format";

/** The magnitude of a signed stored amount ("-50.00" → "50.00"). */
function absoluteAmount(amount: string): string {
	return amount.startsWith("-") ? amount.slice(1) : amount;
}

/**
 * Settlement state of an account (#612), in the glossary's words (#751):
 * awaiting reimbursement, overpaid, reimbursed or needing review (mixed).
 */
export function SettlementStateBadge({ state }: { state: SettlementSummary["state"] }) {
	const { t } = useTranslate();
	switch (state) {
		case "outstanding":
			return (
				<Badge variant="outline">
					{t("travelExpenses.settlement.state.awaitingReimbursement", "Awaiting reimbursement")}
				</Badge>
			);
		case "overpaid":
			return (
				<Badge variant="destructive">
					{t("travelExpenses.settlement.state.overpaid", "Overpaid")}
				</Badge>
			);
		case "mixed":
			return (
				<Badge variant="destructive">
					{t("travelExpenses.settlement.state.mixed", "Needs review")}
				</Badge>
			);
		case "settled":
			return <ReimbursedBadge />;
	}
}

/** An approved expense whose employee-paid amount has been paid in full (#751). */
export function ReimbursedBadge() {
	const { t } = useTranslate();
	return (
		<Badge variant="secondary">
			{t("travelExpenses.settlement.state.reimbursed", "Reimbursed")}
		</Badge>
	);
}

/**
 * One currency's balance in words: what is still owed to the employee, what
 * was overpaid (never shown as zero), or that it is reimbursed.
 */
export function BalanceText({ line }: { line: CurrencySettlement }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const amount = formatMoney(locale, absoluteAmount(line.balance), line.currency);
	switch (line.state) {
		case "outstanding":
			return (
				<>
					{t("travelExpenses.settlement.balance.outstanding", "{amount} outstanding", { amount })}
				</>
			);
		case "overpaid":
			return (
				<>{t("travelExpenses.settlement.balance.overpaid", "{amount} overpaid", { amount })}</>
			);
		case "settled":
			return <>{t("travelExpenses.settlement.balance.reimbursed", "Reimbursed")}</>;
	}
}
