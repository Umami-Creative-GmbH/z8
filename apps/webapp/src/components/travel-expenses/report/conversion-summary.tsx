"use client";

import { IconArrowsExchange, IconFileText } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { ConversionResult } from "@/lib/travel-expenses/currency-conversion";
import { formatMoney, formatPlainDate } from "./format";

type Translate = ReturnType<typeof useTranslate>["t"];

/** The visible name of a conversion basis; card charges and authorized rates never look alike. */
export function conversionBasisLabel(t: Translate, basis: ConversionResult["basis"]): string {
	switch (basis) {
		case "card_charge":
			return t("travelExpenses.report.conversion.basis.cardCharge", "Card charge");
		case "manual_rate":
			return t("travelExpenses.report.conversion.basis.manualRate", "Authorized rate");
		case "reference_rate":
			return t("travelExpenses.report.conversion.basis.referenceRate", "ECB reference rate");
	}
}

const BADGE_VARIANT = {
	card_charge: "secondary",
	manual_rate: "outline",
	reference_rate: "outline",
} as const satisfies Record<ConversionResult["basis"], "secondary" | "outline">;

/**
 * Read-only conversion of a foreign-currency expense (#607): the result in
 * the reimbursement currency, its basis and the evidence or documentation
 * behind it. Used for drafts, the submission review and frozen submissions.
 */
export function ConversionSummary({
	original,
	conversion,
	receipts,
}: {
	original: { amount: string; currency: string };
	conversion: ConversionResult;
	/** The expense's attachments, to name (and link) the card charge evidence. */
	receipts: { id: string; fileName: string; href?: string }[];
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const { reimbursement } = conversion;
	return (
		<div className="space-y-1 text-sm">
			<p className="flex flex-wrap items-center gap-2">
				<IconArrowsExchange aria-hidden="true" className="size-4 text-muted-foreground" />
				<span>
					{t("travelExpenses.report.conversion.result", "{original} counts as {reimbursement}", {
						original: formatMoney(locale, original.amount, original.currency),
						reimbursement: formatMoney(locale, reimbursement.amount, reimbursement.currency),
					})}
				</span>
				<Badge variant={BADGE_VARIANT[conversion.basis]}>
					{conversionBasisLabel(t, conversion.basis)}
				</Badge>
			</p>
			{conversion.basis === "card_charge" ? (
				<CardChargeEvidence evidenceReceiptId={conversion.evidenceReceiptId} receipts={receipts} />
			) : conversion.basis === "reference_rate" ? (
				<ReferenceRateDetails conversion={conversion} />
			) : (
				<dl className="grid gap-x-3 gap-y-0.5 text-muted-foreground sm:grid-cols-[auto_1fr]">
					<dt>{t("travelExpenses.report.conversion.rate", "Rate")}</dt>
					<dd className="tabular-nums">
						{t("travelExpenses.report.conversion.rateValue", "1 {base} = {value} {quote}", {
							base: conversion.rate.base,
							value: conversion.rate.value,
							quote: conversion.rate.quote,
						})}
					</dd>
					<dt>{t("travelExpenses.report.conversion.rateDate", "Rate date")}</dt>
					<dd>{formatPlainDate(locale, conversion.rateDate)}</dd>
					<dt>{t("travelExpenses.report.conversion.rounding", "Rounding")}</dt>
					<dd>
						{t(
							"travelExpenses.report.conversion.roundingValue",
							"Rounded half up to {digits} decimals",
							{ digits: conversion.rounding.minorUnitDigits },
						)}
					</dd>
					<dt>{t("travelExpenses.report.conversion.authorizedBy", "Authorized by")}</dt>
					<dd>{conversion.authorizedBy.name}</dd>
					<dt>{t("travelExpenses.report.conversion.reason", "Documentation")}</dt>
					<dd className="whitespace-pre-wrap">{conversion.reason}</dd>
					{/* Absent from submissions frozen before facts version 11. */}
					{conversion.evidence && (
						<>
							<dt>{t("travelExpenses.report.conversion.rateEvidence", "Rate evidence")}</dt>
							<dd className="whitespace-pre-wrap break-words">{conversion.evidence}</dd>
						</>
					)}
				</dl>
			)}
		</div>
	);
}

/**
 * An approved reference rate (#608): the source, the pair as published, the
 * publication's real date and, when it stands in for the expense date, why.
 */
function ReferenceRateDetails({
	conversion,
}: {
	conversion: Extract<ConversionResult, { basis: "reference_rate" }>;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const fallback = conversion.rateDate < conversion.expenseDate;
	return (
		<dl className="grid gap-x-3 gap-y-0.5 text-muted-foreground sm:grid-cols-[auto_1fr]">
			<dt>{t("travelExpenses.report.conversion.source", "Source")}</dt>
			<dd>
				{t(
					"travelExpenses.report.conversion.sourceEcb",
					"European Central Bank euro reference rate, approved by your organization",
				)}
			</dd>
			<dt>{t("travelExpenses.report.conversion.rate", "Rate")}</dt>
			<dd className="tabular-nums">
				{t("travelExpenses.report.conversion.rateValue", "1 {base} = {value} {quote}", {
					base: conversion.rate.base,
					value: conversion.rate.value,
					quote: conversion.rate.quote,
				})}
			</dd>
			<dt>{t("travelExpenses.report.conversion.publicationDate", "Published on")}</dt>
			<dd>
				{formatPlainDate(locale, conversion.rateDate)}
				{fallback && (
					<span className="block">
						{t(
							"travelExpenses.report.conversion.publicationFallback",
							"No rate was published on {expenseDate}, so the latest earlier publication applies.",
							{ expenseDate: formatPlainDate(locale, conversion.expenseDate) },
						)}
					</span>
				)}
			</dd>
			<dt>{t("travelExpenses.report.conversion.rounding", "Rounding")}</dt>
			<dd>
				{t(
					"travelExpenses.report.conversion.roundingValue",
					"Rounded half up to {digits} decimals",
					{ digits: conversion.rounding.minorUnitDigits },
				)}
			</dd>
		</dl>
	);
}

function CardChargeEvidence({
	evidenceReceiptId,
	receipts,
}: {
	evidenceReceiptId: string | null;
	receipts: { id: string; fileName: string; href?: string }[];
}) {
	const { t } = useTranslate();
	const evidence = receipts.find((receipt) => receipt.id === evidenceReceiptId);
	if (!evidence) {
		return (
			<p className="text-destructive">
				{t(
					"travelExpenses.report.conversion.evidenceMissing",
					"The attachment showing the card charge is missing.",
				)}
			</p>
		);
	}
	return (
		<p className="flex flex-wrap items-center gap-1 text-muted-foreground">
			{t("travelExpenses.report.conversion.evidence", "Evidence:")}
			<IconFileText aria-hidden="true" className="size-4" />
			{evidence.href ? (
				<a
					href={evidence.href}
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline underline-offset-4 hover:text-primary/80"
				>
					{evidence.fileName}
				</a>
			) : (
				<span>{evidence.fileName}</span>
			)}
		</p>
	);
}
