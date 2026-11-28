"use client";

import { useTolgee, useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type {
	BankAccountView,
	PersonalDetailsEntry,
	PersonalDetailsHistory,
} from "@/lib/organization/personal-details/types";
import { formatIban, maskedIban } from "./personal-details-copy";

function useFormatDay() {
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() ?? "en";
	return (day: string) => formatPlainDate(parsePlainDate(day), locale, "dateMedium");
}

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

function HistoryEntry({
	entry,
	inForce,
	upcoming,
}: {
	entry: PersonalDetailsEntry<BankAccountView>;
	inForce: boolean;
	upcoming: boolean;
}) {
	const { t } = useTranslate();
	const formatDay = useFormatDay();
	return (
		<li className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-baseline sm:gap-4">
			<span className="w-32 shrink-0 tabular-nums text-muted-foreground">
				{t("settings.personalDetails.history.from", "From {date}", {
					date: formatDay(entry.validFrom),
				})}
			</span>
			{entry.value ? (
				<span className="min-w-0 flex-1 break-words">
					{entry.value.accountHolder} ·{" "}
					<span className="font-mono tabular-nums" translate="no">
						{ibanText(entry.value)}
					</span>
					{entry.value.bic ? (
						<>
							{" "}
							·{" "}
							<span className="font-mono" translate="no">
								{entry.value.bic}
							</span>
						</>
					) : null}
				</span>
			) : (
				<span className="flex-1 text-muted-foreground">
					{t("settings.personalDetails.history.ended", "Ended")}
				</span>
			)}
			{inForce ? (
				<Badge variant="secondary">
					{t("settings.personalDetails.history.inForce", "In force")}
				</Badge>
			) : upcoming ? (
				<Badge variant="outline">
					{t("settings.personalDetails.history.upcoming", "Upcoming")}
				</Badge>
			) : null}
		</li>
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
	const { t } = useTranslate();
	if (bankAccount.history.length === 0) return null;
	return (
		<div className="space-y-1">
			<h4 className="text-sm font-medium">
				{t("settings.personalDetails.history.title", "History")}
			</h4>
			<ul className="divide-y">
				{bankAccount.history.map((entry) => (
					<HistoryEntry
						key={entry.validFrom}
						entry={entry}
						inForce={bankAccount.current?.validFrom === entry.validFrom}
						upcoming={entry.validFrom > on}
					/>
				))}
			</ul>
		</div>
	);
}
