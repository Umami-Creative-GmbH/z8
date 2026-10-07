"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import type { SettlementAccount } from "@/lib/travel-expenses/settlement-store";
import { Link } from "@/navigation";
import { formatSignedMoney as signedMoney } from "../report/format";

/**
 * Approved adjustments (#615) inside a settlement's entitlement list: each
 * signed difference, once, with a link to the adjustment report. The
 * entitlement shown above them already includes them.
 */
export function SettlementAdjustmentLines({
	account,
	currency,
}: {
	account: Pick<SettlementAccount, "adjustments">;
	currency: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<>
			{account.adjustments
				.filter((adjustment) => adjustment.currency === currency)
				.map((adjustment) => (
					<div key={adjustment.reportId} className="contents">
						<dt className="pl-3 text-muted-foreground">
							<Link
								href={`/travel-expenses/reports/${adjustment.reportId}`}
								className="underline underline-offset-4"
							>
								{t("travelExpenses.settlement.adjustment", "Including approved adjustment")}
							</Link>
							<span className="block text-xs break-words">{adjustment.reason}</span>
						</dt>
						<dd className="text-right tabular-nums">
							{signedMoney(locale, adjustment.delta, adjustment.currency)}
						</dd>
					</div>
				))}
		</>
	);
}

/** Tells the employee what an overpayment after an approved adjustment means (#615). */
export function OverpaidOwnerNotice({ account }: { account: Pick<SettlementAccount, "summary"> }) {
	const { t } = useTranslate();
	if (account.summary.state !== "overpaid") return null;
	return (
		<p className="text-sm text-muted-foreground">
			{t(
				"travelExpenses.settlement.ownerOverpaid",
				"More was paid than is now approved. Finance records here when the difference has been returned; Z8 does not move any money.",
			)}
		</p>
	);
}
