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
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import {
	appliedConversion,
	type ItemConversion,
	parseCardChargeAmount,
} from "@/lib/travel-expenses/currency-conversion";
import { currencyMinorUnitDigits } from "@/lib/travel-expenses/money";
import type { ReferenceRateItemStatus } from "@/lib/travel-expenses/reference-rate-conversion";
import type { ReportReceiptView } from "@/lib/travel-expenses/report-store";
import { ConversionSummary } from "./conversion-summary";

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
	expenseDate,
	reimbursementCurrency,
	conversion: loaded,
	referenceRate,
	receipts,
	version,
	onChanged,
}: {
	reportId: string;
	itemId: string;
	/** The entered original amount and currency, as they are on screen. */
	original: { amount: string | null; currency: string | null };
	/** The entered expense date, as it is on screen (#608). */
	expenseDate?: string | null;
	reimbursementCurrency: string;
	/** The saved conversion, as last loaded. */
	conversion: ItemConversion | null;
	/** Why the approved reference rate does or does not convert the item (#608). */
	referenceRate?: ReferenceRateItemStatus | null;
	receipts: ReportReceiptView[];
	version: ItemVersionHandle;
	onChanged: () => void | Promise<void>;
}) {
	const { t } = useTranslate();
	const [removing, setRemoving] = useState(false);
	if (!original.currency || original.currency === reimbursementCurrency) return null;
	// A reference rate belongs to the date it was looked up for; a new date is looked up on save.
	const staleReference =
		loaded?.basis === "reference_rate" &&
		expenseDate !== undefined &&
		expenseDate !== loaded.expenseDate;
	const conversion = staleReference ? null : loaded;
	const applied = appliedConversion(original, reimbursementCurrency, conversion);
	const headingId = `${itemId}-conversion`;

	async function removeCardCharge() {
		setRemoving(true);
		// Promise#finally rather than try/finally: the React Compiler cannot
		// compile try statements without a catch clause.
		await removeAndAdopt().finally(() => {
			setRemoving(false);
			return onChanged();
		});
	}

	async function removeAndAdopt() {
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
			) : staleReference ? (
				<p role="status" className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.report.conversion.referencePending",
						"The reference rate is looked up again for the new date once your change is saved.",
					)}
				</p>
			) : referenceRate?.status === "unavailable" ? (
				<ReferenceRateGuidance
					reason={referenceRate.reason}
					currency={original.currency}
					reimbursementCurrency={reimbursementCurrency}
				/>
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

/**
 * Why the organization's approved reference rate cannot convert this expense
 * (#608), and what still can: an evidenced card charge or a documented rate.
 */
function ReferenceRateGuidance({
	reason,
	currency,
	reimbursementCurrency,
}: {
	reason: Extract<ReferenceRateItemStatus, { status: "unavailable" }>["reason"];
	currency: string;
	reimbursementCurrency: string;
}) {
	const { t } = useTranslate();
	const why = {
		pair_unsupported: t(
			"travelExpenses.report.conversion.reference.pairUnsupported",
			"The European Central Bank publishes rates against the euro only, so none applies between {currency} and {reimbursementCurrency}.",
			{ currency, reimbursementCurrency },
		),
		currency_unavailable: t(
			"travelExpenses.report.conversion.reference.currencyUnavailable",
			"The European Central Bank does not publish a rate for {currency} on this date.",
			{ currency },
		),
		not_yet_published: t(
			"travelExpenses.report.conversion.reference.notYetPublished",
			"The reference rate for this date has not been published yet. It usually appears after 16:00 Frankfurt time on working days.",
		),
		provider_unavailable: t(
			"travelExpenses.report.conversion.reference.providerUnavailable",
			"The reference rate for this date could not be retrieved yet. Try again later.",
		),
		history_unavailable: t(
			"travelExpenses.report.conversion.reference.historyUnavailable",
			"There is no reference rate for this date.",
		),
		rate_stale: t(
			"travelExpenses.report.conversion.reference.rateStale",
			"No current reference rate is available for this date.",
		),
		expense_date_missing: t(
			"travelExpenses.report.conversion.reference.expenseDateMissing",
			"Enter the expense date to look up the reference rate.",
		),
	}[reason];
	return (
		<p role="status" className="text-sm text-muted-foreground">
			{why}{" "}
			{t(
				"travelExpenses.report.conversion.reference.alternatives",
				"Your report stays a draft until you enter your card charge in {reimbursementCurrency} with the attachment that shows it, or an expense administrator records a documented rate.",
				{ reimbursementCurrency },
			)}
		</p>
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
	const cardCharge = conversion?.basis === "card_charge" ? conversion : null;
	const digits = currencyMinorUnitDigits(reimbursementCurrency);
	const amountError = t(
		"travelExpenses.report.conversion.errors.chargedAmount",
		"Enter the positive amount charged in {currency}, with at most {digits} decimals.",
		{ currency: reimbursementCurrency, digits },
	);
	const evidenceError = t(
		"travelExpenses.report.conversion.errors.evidence",
		"Select the attachment of this expense that shows the charge.",
	);
	const form = useForm({
		defaultValues: {
			chargedAmount: cardCharge?.chargedAmount ?? "",
			evidenceReceiptId:
				cardCharge?.evidenceReceiptId ?? (receipts.length === 1 ? (receipts[0]?.id ?? "") : ""),
		},
		onSubmit: async ({ value, formApi }) => {
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
				case "invalid": {
					// The server's refusal stays on its field until that field changes.
					const refused = [
						["chargedAmount", result.data.errors.chargedAmount ? amountError : undefined],
						["evidenceReceiptId", result.data.errors.evidenceReceiptId ? evidenceError : undefined],
					] as const;
					for (const [name, message] of refused) {
						if (!message) continue;
						formApi.setFieldMeta(name, (meta) => ({
							...meta,
							errorMap: { ...meta.errorMap, onSubmit: message },
						}));
					}
					return;
				}
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
			<form.Field
				name="chargedAmount"
				validators={{
					// The server's rule for the charge, so the error clears once the amount is valid.
					onChange: ({ value }) =>
						parseCardChargeAmount(value, reimbursementCurrency) === null ? amountError : undefined,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("travelExpenses.report.conversion.chargedAmount", "Amount charged in {currency}", {
								currency: reimbursementCurrency,
							})}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
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
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Field
				name="evidenceReceiptId"
				validators={{ onChange: ({ value }) => (value ? undefined : evidenceError) }}
			>
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
								data-error={fieldHasError(field)}
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
						<TFormMessage field={field} />
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
							{conversion?.basis === "manual_rate" || conversion?.basis === "reference_rate"
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
