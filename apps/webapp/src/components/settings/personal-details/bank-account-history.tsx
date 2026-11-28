"use client";

import { useTranslate } from "@tolgee/react";
import type {
	BankAccountView,
	PersonalDetailsHistory,
} from "@/lib/organization/personal-details/types";
import { PersonalDetailsHistoryList, useFormatDay } from "./history-list";
import { formatIban, maskedIban } from "./personal-details-copy";

function ibanText(value: BankAccountView) {
	return value.iban ? formatIban(value.iban) : maskedIban(value.ibanLastFour);
}

/** The bank account in force, its IBAN masked unless the view reveals it. */
export function CurrentBankAccount({
	bankAccount,
}: {
	bankAccount: PersonalDetailsHistory<BankAccountView>;
}) {
	const { t } = useTranslate();
	const formatDay = useFormatDay();
	const current = bankAccount.current;
	if (!current?.value) {
		return (
			<p className="text-sm text-muted-foreground">
				{t("settings.personalDetails.bankAccount.none", "No bank account on file.")}
			</p>
		);
	}
	return (
		<dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
			<div className="min-w-0">
				<dt className="text-muted-foreground">
					{t("settings.personalDetails.bankAccount.accountHolder", "Account holder")}
				</dt>
				<dd className="break-words font-medium">{current.value.accountHolder}</dd>
			</div>
			<div className="min-w-0">
				<dt className="text-muted-foreground">
					{t("settings.personalDetails.bankAccount.iban", "IBAN")}
				</dt>
				<dd className="break-all font-mono font-medium tabular-nums" translate="no">
					{ibanText(current.value)}
				</dd>
			</div>
			<div className="min-w-0">
				<dt className="text-muted-foreground">
					{t("settings.personalDetails.bankAccount.bic", "BIC")}
				</dt>
				<dd className="font-mono font-medium" translate="no">
					{current.value.bic ?? "—"}
				</dd>
			</div>
			<div className="min-w-0">
				<dt className="text-muted-foreground">
					{t("settings.personalDetails.validFrom", "Valid from")}
				</dt>
				<dd className="font-medium tabular-nums">{formatDay(current.validFrom)}</dd>
			</div>
		</dl>
	);
}

/** Every bank account entry, latest valid-from first. */
export function BankAccountHistoryList({
	bankAccount,
	on,
}: {
	bankAccount: PersonalDetailsHistory<BankAccountView>;
	on: string;
}) {
	return (
		<PersonalDetailsHistoryList
			history={bankAccount}
			on={on}
			describe={(value) => (
				<>
					{value.accountHolder} ·{" "}
					<span className="font-mono tabular-nums" translate="no">
						{ibanText(value)}
					</span>
					{value.bic ? (
						<>
							{" "}
							·{" "}
							<span className="font-mono" translate="no">
								{value.bic}
							</span>
						</>
					) : null}
				</>
			)}
		/>
	);
}
