"use client";

import { IconLoader2, IconTrash } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	removeCardChargeConversionAction,
	saveCardChargeConversionAction,
} from "@/app/[locale]/(app)/travel-expenses/conversion-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import {
	appliedConversion,
	type ConversionRequirement,
	type ItemConversion,
} from "@/lib/travel-expenses/currency-conversion";
import { currencyMinorUnitDigits } from "@/lib/travel-expenses/money";
import type { ReportReceiptView } from "@/lib/travel-expenses/report-store";
import { ConversionSummary } from "./conversion-summary";

type Translate = ReturnType<typeof useTranslate>["t"];

/** What a missing conversion needs, as shown in the expense's "Still needed" list. */
export function conversionRequirementLabel(
	t: Translate,
	requirement: ConversionRequirement,
	currency: string,
): string {
	switch (requirement) {
		case "conversion_missing":
			return t(
				"travelExpenses.report.requirements.conversionMissing",
				"Convert this receipt into {currency}: enter your card charge with the attachment that shows it, or ask an expense administrator for a documented rate.",
				{ currency },
			);
		case "conversion_unsupported":
			return t(
				"travelExpenses.report.requirements.conversionUnsupported",
				"This conversion cannot be used for {currency}. Ask an expense administrator to check it.",
				{ currency },
			);
		case "conversion_evidence":
			return t(
				"travelExpenses.report.requirements.conversionEvidence",
				"Select the attachment that shows the card charge.",
			);
	}
}

/** The item editor's save state, so conversion saves continue from its version. */
export interface ItemVersionHandle {
	/** Saves pending field edits first. */
	flush: () => Promise<void>;
	current: () => number;
	adopt: (version: number) => void;
}

/**
 * Currency conversion of one foreign-currency receipt (#607). The employee
 * records what their card was actually charged in the reimbursement currency
 * and which attachment shows it; the server validates and stores it. A rate
 * can only be documented by an expense administrator, and nothing is guessed.
 */
export function CurrencyConversionField({
	reportId,
	itemId,
	original,
	reimbursementCurrency,
	conversion,
	receipts,
	version,
	onChanged,
}: {
	reportId: string;
	itemId: string;
	/** The entered original amount and currency, as they are on screen. */
	original: { amount: string | null; currency: string | null };
	reimbursementCurrency: string;
	/** The saved conversion, as last loaded. */
	conversion: ItemConversion | null;
	receipts: ReportReceiptView[];
	version: ItemVersionHandle;
	onChanged: () => void | Promise<void>;
}) {
	const { t } = useTranslate();
	const [removing, setRemoving] = useState(false);
	if (!original.currency || original.currency === reimbursementCurrency) return null;
	const applied = appliedConversion(original, reimbursementCurrency, conversion);
	const headingId = `${itemId}-conversion`;

	async function removeCardCharge() {
		setRemoving(true);
		try {
			await version.flush();
			const result = await removeCardChargeConversionAction({
				reportId,
				itemId,
				expectedVersion: version.current(),
			});
			if (!result.success || result.data.kind !== "removed") {
				toast.error(
					t(
						"travelExpenses.report.conversion.removeFailed",
						"The card charge could not be removed. Reload the expense and try again.",
					),
				);
				return;
			}
			version.adopt(result.data.itemVersion);
		} finally {
			setRemoving(false);
			await onChanged();
		}
	}

	return (
		<section aria-labelledby={headingId} className="space-y-3 rounded-lg border p-4">
			<h3 id={headingId} className="text-base font-semibold">
				{t("travelExpenses.report.conversion.title", "Conversion into {currency}", {
					currency: reimbursementCurrency,
				})}
			</h3>
			{applied && original.amount ? (
				<div className="flex flex-wrap items-start justify-between gap-2">
					<ConversionSummary
						original={{ amount: original.amount, currency: original.currency }}
						conversion={applied}
						receipts={receipts}
					/>
					{applied.basis === "card_charge" && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={removing}
							onClick={() => void removeCardCharge()}
						>
							{removing ? (
								<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
							) : (
								<IconTrash aria-hidden="true" className="mr-2 size-4" />
							)}
							{t("travelExpenses.report.conversion.remove", "Remove card charge")}
						</Button>
					)}
				</div>
			) : (
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.report.conversion.none",
						"No exchange rate is guessed. Enter what your card was charged in {currency} and select the attachment that shows it, such as the card statement. Without a card charge, an expense administrator can record a documented rate.",
						{ currency: reimbursementCurrency },
					)}
				</p>
			)}
			<CardChargeForm
				key={`${conversion?.basis ?? "none"}-${receipts.length}`}
				reportId={reportId}
				itemId={itemId}
				reimbursementCurrency={reimbursementCurrency}
				conversion={conversion}
				receipts={receipts}
				version={version}
				onChanged={onChanged}
			/>
		</section>
	);
}

function CardChargeForm({
	reportId,
	itemId,
	reimbursementCurrency,
	conversion,
	receipts,
	version,
	onChanged,
}: {
	reportId: string;
	itemId: string;
	reimbursementCurrency: string;
	conversion: ItemConversion | null;
	receipts: ReportReceiptView[];
	version: ItemVersionHandle;
	onChanged: () => void | Promise<void>;
}) {
	const { t } = useTranslate();
	const [errors, setErrors] = useState<{ chargedAmount?: string; evidenceReceiptId?: string }>({});
	const cardCharge = conversion?.basis === "card_charge" ? conversion : null;
	const digits = currencyMinorUnitDigits(reimbursementCurrency);
	const form = useForm({
		defaultValues: {
			chargedAmount: cardCharge?.chargedAmount ?? "",
			evidenceReceiptId:
				cardCharge?.evidenceReceiptId ?? (receipts.length === 1 ? (receipts[0]?.id ?? "") : ""),
		},
		onSubmit: async ({ value }) => {
			setErrors({});
			const amountError = t(
				"travelExpenses.report.conversion.errors.chargedAmount",
				"Enter the positive amount charged in {currency}, with at most {digits} decimals.",
				{ currency: reimbursementCurrency, digits },
			);
			const evidenceError = t(
				"travelExpenses.report.conversion.errors.evidence",
				"Select the attachment of this expense that shows the charge.",
			);
			if (!value.evidenceReceiptId) {
				setErrors({ evidenceReceiptId: evidenceError });
				return;
			}
			await version.flush();
			const result = await saveCardChargeConversionAction({
				reportId,
				itemId,
				expectedVersion: version.current(),
				chargedAmount: value.chargedAmount,
				evidenceReceiptId: value.evidenceReceiptId,
			});
			if (!result.success) {
				toast.error(
					t(
						"travelExpenses.report.conversion.saveFailed",
						"The card charge could not be saved. Please retry.",
					),
				);
				return;
			}
			switch (result.data.kind) {
				case "saved":
					version.adopt(result.data.itemVersion);
					toast.success(t("travelExpenses.report.conversion.saved", "Card charge saved"));
					break;
				case "invalid":
					setErrors({
						...(result.data.errors.chargedAmount ? { chargedAmount: amountError } : {}),
						...(result.data.errors.evidenceReceiptId ? { evidenceReceiptId: evidenceError } : {}),
					});
					return;
				case "conflict":
					toast.error(
						t(
							"travelExpenses.report.conversion.conflict",
							"This expense changed elsewhere. Check it and save the card charge again.",
						),
					);
					break;
				default:
					toast.error(
						t(
							"travelExpenses.report.conversion.notSaved",
							"The card charge could not be saved for this expense.",
						),
					);
			}
			await onChanged();
		},
	});

	return (
		<form
			noValidate
			className="grid gap-4"
			aria-label={t("travelExpenses.report.conversion.formLabel", "Card charge")}
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field name="chargedAmount">
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={!!errors.chargedAmount}>
							{t("travelExpenses.report.conversion.chargedAmount", "Amount charged in {currency}", {
								currency: reimbursementCurrency,
							})}
						</TFormLabel>
						<TFormControl hasError={!!errors.chargedAmount}>
							<Input
								name="chargedAmount"
								inputMode="decimal"
								autoComplete="off"
								className="sm:w-48"
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormDescription>
							{t(
								"travelExpenses.report.conversion.chargedAmountDescription",
								"The amount on your card or bank statement, including any conversion fee charged with it.",
							)}
						</TFormDescription>
						<TFormMessage>{errors.chargedAmount}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="evidenceReceiptId">
				{(field) => (
					<TFormItem>
						<RadioGroup
							aria-label={t(
								"travelExpenses.report.conversion.evidenceLabel",
								"Attachment showing the charge",
							)}
							value={field.state.value}
							onValueChange={(value) => field.handleChange(value)}
							className="gap-2"
						>
							<p
								className="text-sm font-medium data-[error=true]:text-destructive"
								data-error={!!errors.evidenceReceiptId}
							>
								{t(
									"travelExpenses.report.conversion.evidenceLabel",
									"Attachment showing the charge",
								)}
							</p>
							{receipts.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									{t(
										"travelExpenses.report.conversion.attachFirst",
										"Attach the card statement or receipt that shows the charge above first.",
									)}
								</p>
							) : (
								receipts.map((receipt) => (
									<Label key={receipt.id} className="flex items-center gap-2 font-normal">
										<RadioGroupItem value={receipt.id} />
										{receipt.fileName}
									</Label>
								))
							)}
						</RadioGroup>
						<TFormMessage>{errors.evidenceReceiptId}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<div>
						<Button
							type="submit"
							variant="secondary"
							disabled={isSubmitting || receipts.length === 0}
						>
							{isSubmitting && (
								<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
							)}
							{conversion?.basis === "manual_rate"
								? t(
										"travelExpenses.report.conversion.replaceWithCardCharge",
										"Use my card charge instead",
									)
								: t("travelExpenses.report.conversion.saveCardCharge", "Save card charge")}
						</Button>
					</div>
				)}
			</form.Subscribe>
		</form>
	);
}
