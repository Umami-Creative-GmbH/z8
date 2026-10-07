"use client";

import { IconLoader2, IconTrash } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
	authorizeManualConversionRateAction,
	clearItemConversionAction,
} from "@/app/[locale]/(app)/settings/travel-expenses/conversion-actions";
import { ConversionSummary } from "@/components/travel-expenses/report/conversion-summary";
import { formatMoney, formatPlainDate } from "@/components/travel-expenses/report/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import type { ForeignDraftItem } from "@/lib/travel-expenses/conversion-store";
import {
	appliedConversion,
	MAX_CONVERSION_REASON_LENGTH,
	MAX_MANUAL_RATE_AGE_DAYS,
	MAX_RATE_EVIDENCE_LENGTH,
	type ManualRateFieldError,
	parseManualRateInput,
} from "@/lib/travel-expenses/currency-conversion";
import { foreignDraftExpensesQuery } from "./pending-exceptions";

type Translate = ReturnType<typeof useTranslate>["t"];
const queryKey = foreignDraftExpensesQuery.queryKey;

function rateErrorMessage(t: Translate, code: ManualRateFieldError | undefined) {
	switch (code) {
		case undefined:
			return undefined;
		case "invalid_pair":
			return t(
				"settings.travelExpenses.rates.errors.pair",
				"Quote the rate for this expense's currencies.",
			);
		case "invalid_rate":
			return t(
				"settings.travelExpenses.rates.errors.rate",
				"Enter a positive rate with at most 10 decimals, e.g. 0.9215.",
			);
		case "invalid_date":
			return t("settings.travelExpenses.rates.errors.date", "Enter the date of the rate.");
		case "after_expense_date":
			return t(
				"settings.travelExpenses.rates.errors.afterExpenseDate",
				"The rate cannot be dated after the expense.",
			);
		case "too_early":
			return t(
				"settings.travelExpenses.rates.errors.tooEarly",
				"Use a rate dated at most {days} days before the expense.",
				{ days: MAX_MANUAL_RATE_AGE_DAYS },
			);
		case "expense_date_missing":
			return t(
				"settings.travelExpenses.rates.errors.expenseDateMissing",
				"The expense has no date yet. Ask the employee to add it first.",
			);
		case "required":
			return t(
				"settings.travelExpenses.rates.errors.reasonRequired",
				"Document where the rate comes from.",
			);
		case "too_long":
			return t("settings.travelExpenses.rates.errors.tooLong", "This text is too long.");
	}
}

function evidenceErrorMessage(t: Translate, code: ManualRateFieldError | undefined) {
	return code === "required"
		? t(
				"settings.travelExpenses.rates.errors.evidenceRequired",
				"Name the document or statement line that shows the rate.",
			)
		: rateErrorMessage(t, code);
}

type CurrencyPair = { sourceCurrency: string; targetCurrency: string };

interface ManualRateValues {
	direction: string;
	rate: string;
	rateDate: string;
	reason: string;
	evidence: string;
}

type ManualRateField = "rate" | "rateDate" | "reason" | "evidence";

/** The rate as the server receives it: quoted in the chosen direction. */
function manualRateInput(pair: CurrencyPair, value: ManualRateValues) {
	const forward = value.direction === "source";
	return {
		base: forward ? pair.sourceCurrency : pair.targetCurrency,
		quote: forward ? pair.targetCurrency : pair.sourceCurrency,
		rate: value.rate,
		rateDate: value.rateDate,
		reason: value.reason,
		evidence: value.evidence,
	};
}

function manualRateFieldMessage(
	t: Translate,
	field: ManualRateField | "pair",
	code: ManualRateFieldError | undefined,
) {
	return field === "evidence" ? evidenceErrorMessage(t, code) : rateErrorMessage(t, code);
}

/**
 * The manual-rate form: checks each field with the server's parser, keeps the
 * field errors the server returned until the field changes, and closes the
 * dialog once the list is refreshed.
 */
function useManualRateForm(expense: ForeignDraftItem, pair: CurrencyPair, onClose: () => void) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const form = useForm({
		defaultValues: {
			direction: "source",
			rate: "",
			rateDate: expense.expenseDate ?? "",
			reason: "",
			evidence: "",
		} satisfies ManualRateValues,
		onSubmit: async ({ value, formApi }) => {
			const result = await authorizeManualConversionRateAction({
				reportId: expense.reportId,
				itemId: expense.itemId,
				expectedVersion: expense.itemVersion,
				rate: manualRateInput(pair, value),
			});
			if (!result.success) {
				toast.error(
					t(
						"settings.travelExpenses.rates.saveFailed",
						"The rate could not be saved. Please retry.",
					),
				);
				return;
			}
			switch (result.data.kind) {
				case "saved":
					toast.success(t("settings.travelExpenses.rates.saved", "Documented rate saved"));
					break;
				case "invalid":
					// The server's refusal stays on its field until that field changes.
					for (const [key, code] of Object.entries(result.data.errors)) {
						const name = key === "pair" ? "direction" : (key as ManualRateField);
						const message = manualRateFieldMessage(t, key as ManualRateField | "pair", code);
						formApi.setFieldMeta(name, (meta) => ({
							...meta,
							errorMap: { ...meta.errorMap, onSubmit: message },
						}));
					}
					return;
				case "out_of_range":
					toast.error(
						t(
							"settings.travelExpenses.rates.outOfRange",
							"With this rate the expense would round to nothing or exceed the allowed amount.",
						),
					);
					return;
				case "self_authorization":
					toast.error(
						t(
							"settings.travelExpenses.rates.self",
							"You cannot authorize a rate on your own report. Ask another expense administrator.",
						),
					);
					return;
				default:
					toast.error(
						t(
							"settings.travelExpenses.rates.stale",
							"This expense changed or was submitted meanwhile. The list was refreshed.",
						),
					);
			}
			await queryClient.invalidateQueries({ queryKey });
			onClose();
		},
	});
	// The server's parser over the whole entry, so a field's error clears once it is valid.
	const validators = (name: ManualRateField) => ({
		onChange: ({ fieldApi }: { fieldApi: { form: { state: { values: ManualRateValues } } } }) => {
			const parsed = parseManualRateInput(
				manualRateInput(pair, fieldApi.form.state.values),
				pair,
				expense.expenseDate,
			);
			return parsed.ok ? undefined : manualRateFieldMessage(t, name, parsed.errors[name]);
		},
	});
	return { form, validators };
}

/** Records a documented rate for one foreign-currency expense. */
function ManualRateDialog({
	expense,
	onClose,
}: {
	expense: ForeignDraftItem;
	onClose: () => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const pair = { sourceCurrency: expense.currency, targetCurrency: expense.reimbursementCurrency };
	const { form, validators } = useManualRateForm(expense, pair, onClose);

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{t("settings.travelExpenses.rates.dialogTitle", "Document a conversion rate")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.travelExpenses.rates.dialogDescription",
							"{employee}: {amount} on {date}. The result is rounded half up to {currency} and shown to the employee and the reviewer as an authorized rate.",
							{
								employee: expense.employeeName,
								amount: expense.amount
									? formatMoney(locale, expense.amount, expense.currency)
									: expense.currency,
								date: expense.expenseDate ? formatPlainDate(locale, expense.expenseDate) : "—",
								currency: expense.reimbursementCurrency,
							},
						)}
					</DialogDescription>
				</DialogHeader>
				<form
					noValidate
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<div className="grid gap-4 sm:grid-cols-[1fr_1fr]">
						<form.Field name="direction">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.travelExpenses.rates.direction", "Quoted as")}
									</TFormLabel>
									<Select
										value={field.state.value}
										onValueChange={(value) => field.handleChange(value ?? "source")}
									>
										<TFormControl hasError={fieldHasError(field)}>
											<SelectTrigger className="w-full">
												<SelectValue />
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											<SelectItem value="source">{`1 ${pair.sourceCurrency} = x ${pair.targetCurrency}`}</SelectItem>
											<SelectItem value="target">{`1 ${pair.targetCurrency} = x ${pair.sourceCurrency}`}</SelectItem>
										</SelectContent>
									</Select>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
						<form.Field name="rate" validators={validators("rate")}>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.travelExpenses.rates.rate", "Rate (x)")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											name="rate"
											inputMode="decimal"
											autoComplete="off"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					</div>
					<form.Field name="rateDate" validators={validators("rateDate")}>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.travelExpenses.rates.rateDate", "Rate date")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<DatePicker
										name="rateDate"
										value={field.state.value}
										onChange={field.handleChange}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
					<form.Field name="reason" validators={validators("reason")}>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.travelExpenses.rates.reason", "Documentation")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Textarea
										name="reason"
										rows={3}
										maxLength={MAX_CONVERSION_REASON_LENGTH}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.travelExpenses.rates.reasonDescription",
										"Where the rate comes from and why no card charge is used, e.g. the bank statement rate of the travel card.",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
					<form.Field name="evidence" validators={validators("evidence")}>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.travelExpenses.rates.evidence", "Rate evidence")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Input
										name="evidence"
										autoComplete="off"
										maxLength={MAX_RATE_EVIDENCE_LENGTH}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.travelExpenses.rates.evidenceDescription",
										"Where the rate can be verified, e.g. the card statement and line, or the document number of the published rate.",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
					<form.Subscribe selector={(state) => state.values}>
						{(values) => {
							const parsed = parseManualRateInput(
								manualRateInput(pair, values),
								pair,
								expense.expenseDate,
							);
							const preview =
								parsed.ok && expense.amount
									? appliedConversion(
											{ amount: expense.amount, currency: expense.currency },
											pair.targetCurrency,
											{
												basis: "manual_rate",
												...pair,
												...parsed.value,
												authorizedBy: { employeeId: "", name: "" },
												authorizedAt: "",
											},
										)
									: null;
							return (
								<p className="text-sm" aria-live="polite">
									{preview
										? t("settings.travelExpenses.rates.preview", "Counts as {amount}.", {
												amount: formatMoney(
													locale,
													preview.reimbursement.amount,
													preview.reimbursement.currency,
												),
											})
										: t(
												"settings.travelExpenses.rates.noPreview",
												"Enter a valid rate, date, documentation and evidence to see the result.",
											)}
								</p>
							);
						}}
					</form.Subscribe>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting && (
										<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
									)}
									{t("settings.travelExpenses.rates.save", "Authorize rate")}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function ForeignExpenseRow({
	expense,
	onRecordRate,
}: {
	expense: ForeignDraftItem;
	onRecordRate: () => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const queryClient = useQueryClient();
	const [removing, setRemoving] = useState(false);
	const applied =
		expense.amount && expense.conversion
			? appliedConversion(
					{ amount: expense.amount, currency: expense.currency },
					expense.reimbursementCurrency,
					expense.conversion,
				)
			: null;

	async function clear() {
		setRemoving(true);
		// Promise#finally rather than try/finally: the React Compiler cannot
		// compile try statements without a catch clause.
		await clearAndRefresh().finally(() => setRemoving(false));
	}

	async function clearAndRefresh() {
		const result = await clearItemConversionAction({
			reportId: expense.reportId,
			itemId: expense.itemId,
			expectedVersion: expense.itemVersion,
		});
		if (!result.success || result.data.kind !== "removed") {
			toast.error(
				t(
					"settings.travelExpenses.rates.removeFailed",
					"The conversion could not be removed. The list was refreshed.",
				),
			);
		}
		await queryClient.invalidateQueries({ queryKey });
	}

	return (
		<li className="space-y-2 rounded-lg border p-3">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<p className="font-medium">
					{expense.employeeName}
					<span className="text-muted-foreground">
						{" · "}
						{[
							expense.expenseDate && formatPlainDate(locale, expense.expenseDate),
							expense.description,
						]
							.filter(Boolean)
							.join(" · ")}
					</span>
				</p>
				<p className="tabular-nums font-medium">
					{expense.amount
						? formatMoney(locale, expense.amount, expense.currency)
						: expense.currency}
				</p>
			</div>
			{applied && expense.amount ? (
				<ConversionSummary
					original={{ amount: expense.amount, currency: expense.currency }}
					conversion={applied}
					receipts={[]}
				/>
			) : (
				<Badge variant="outline">
					{t("settings.travelExpenses.rates.unconverted", "No conversion yet")}
				</Badge>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					size="sm"
					variant="secondary"
					onClick={onRecordRate}
					disabled={!expense.amount}
				>
					{applied?.basis === "manual_rate"
						? t("settings.travelExpenses.rates.replace", "Replace rate")
						: t("settings.travelExpenses.rates.record", "Document rate")}
				</Button>
				{/* A reference rate (#608) is derived from the approved source, not recorded. */}
				{applied && applied.basis !== "reference_rate" && (
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={() => void clear()}
						disabled={removing}
					>
						{removing ? (
							<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
						) : (
							<IconTrash aria-hidden="true" className="mr-2 size-4" />
						)}
						{t("settings.travelExpenses.rates.remove", "Remove conversion")}
					</Button>
				)}
			</div>
		</li>
	);
}

/**
 * Foreign-currency expenses of draft reports (#607). Expense administrators
 * document a rate where no card charge is available; employees never can.
 */
export function ForeignExpenseConversionsCard() {
	const { t } = useTranslate();
	const [editing, setEditing] = useState<ForeignDraftItem | null>(null);
	const { data, isLoading, isError, isFetching, refetch } = useQuery(foreignDraftExpensesQuery);
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.travelExpenses.rates.title", "Foreign-currency expenses in drafts")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.travelExpenses.rates.intro",
						"Employees convert a foreign receipt with their evidenced card charge. Where there is none, document the rate here with its date and source. A documented rate is shown to the reviewer as an authorized rate.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading && <Skeleton aria-hidden="true" className="h-24 w-full" />}
				{isError && !data && (
					<div className="space-y-2">
						<p className="text-sm text-destructive" role="alert">
							{t(
								"settings.travelExpenses.rates.loadFailed",
								"Foreign-currency expenses could not be loaded.",
							)}
						</p>
						<Button
							type="button"
							variant="outline"
							onClick={() => void refetch()}
							disabled={isFetching}
						>
							{t("common.retry", "Retry")}
						</Button>
					</div>
				)}
				{data && data.length === 0 && (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.travelExpenses.rates.empty",
							"No draft report has an expense in another currency.",
						)}
					</p>
				)}
				{data && data.length > 0 && (
					<ul className="space-y-3">
						{data.map((expense) => (
							<ForeignExpenseRow
								key={expense.itemId}
								expense={expense}
								onRecordRate={() => setEditing(expense)}
							/>
						))}
					</ul>
				)}
				{editing && <ManualRateDialog expense={editing} onClose={() => setEditing(null)} />}
			</CardContent>
		</Card>
	);
}
