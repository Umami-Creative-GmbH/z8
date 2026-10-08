"use client";

import { IconAlertTriangle, IconCircleCheck, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useRef, useState } from "react";
import { markTravelExpensesReimbursedAction } from "@/app/[locale]/(app)/travel-expenses/finance-actions";
import { useUserTimezone } from "@/components/providers/user-preferences-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { comparePlainDates, parsePlainDate, systemClock } from "@/lib/datetime/temporal-core";
import type { BulkReimbursementRow } from "@/lib/travel-expenses/bulk-reimbursement";
import { latestCalendarDate } from "@/lib/travel-expenses/future-dates";
import {
	type CurrencySettlement,
	parseSettlementPayment,
	SETTLEMENT_NOTE_MAX_LENGTH,
	SETTLEMENT_REFERENCE_MAX_LENGTH,
	type SettlementCommandFieldError,
} from "@/lib/travel-expenses/settlement";
import type { SettlementAccount, SettlementSource } from "@/lib/travel-expenses/settlement-store";
import { formatMoney } from "../report/format";
import { settlementFieldMessage } from "./record-reimbursement-form";

type Translate = ReturnType<typeof useTranslate>["t"];

/** A selected account and how the queue names it. */
export interface BulkReimbursementItem {
	account: SettlementAccount;
	label: string;
}

interface FormValues {
	occurredOn: string;
	reference: string;
	note: string;
}
type FormField = keyof FormValues;

export function settlementSourceKey(source: SettlementSource): string {
	return `${source.type}:${source.id}`;
}

/** The account currency's line, when it is all that awaits reimbursement. */
function payableLine(account: SettlementAccount): CurrencySettlement | null {
	const line = account.summary.currencies.find((entry) => entry.currency === account.currency);
	if (!line || line.state !== "outstanding") return null;
	const othersSettled = account.summary.currencies.every(
		(entry) => entry === line || entry.state === "settled",
	);
	return othersSettled ? line : null;
}

/** Whether one payment in the account currency reimburses the account in full. */
export function isReimbursableInFull(account: SettlementAccount): boolean {
	return payableLine(account) !== null;
}

/**
 * Today in the officer's own time zone (their preference), as the proposed
 * payment date; never after the latest date the server accepts.
 */
function defaultPaymentDate(timeZone: string): string {
	const now = systemClock.nowInstant();
	const today = now.toZonedDateTimeISO(timeZone).toPlainDate();
	const latest = parsePlainDate(latestCalendarDate(now));
	return (comparePlainDates(today, latest) > 0 ? latest : today).toString();
}

function outcomeText(t: Translate, locale: string, row: BulkReimbursementRow): string {
	switch (row.outcome) {
		case "reimbursed":
			return t("travelExpenses.finance.bulk.outcome.reimbursed", "Reimbursed {amount}", {
				amount: row.amount && row.currency ? formatMoney(locale, row.amount, row.currency) : "",
			});
		case "own_expense":
			return t("travelExpenses.finance.bulk.outcome.ownExpense", "Skipped: your own expense");
		case "overpaid_or_review":
			return t(
				"travelExpenses.finance.bulk.outcome.overpaidOrReview",
				"Skipped: overpaid or needs review",
			);
		case "already_reimbursed":
			return t(
				"travelExpenses.finance.bulk.outcome.alreadyReimbursed",
				"Skipped: already reimbursed",
			);
		case "balance_changed":
			return t("travelExpenses.finance.bulk.outcome.balanceChanged", "Skipped: balance changed");
		case "out_of_scope":
			return t("travelExpenses.finance.bulk.outcome.outOfScope", "Skipped: out of scope");
		case "failed":
			return t("travelExpenses.finance.bulk.outcome.failed", "Failed");
	}
}

/**
 * Bulk "Mark as reimbursed" (#754): one payment date, reference and note for
 * every selected expense; each is reimbursed in full in its own currency and
 * reported on its own. One request key is kept while the same payment and
 * selection are resubmitted, so a retry after a lost response records nothing
 * twice.
 */
export function BulkReimbursementDialog({
	items,
	open,
	onOpenChange,
	onFinished,
}: {
	items: readonly BulkReimbursementItem[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Called once the results were shown and closed: the queue reloads and the selection clears. */
	onFinished: () => void;
}) {
	const { t } = useTranslate();
	const [rows, setRows] = useState<BulkReimbursementRow[] | null>(null);

	function close(next: boolean) {
		if (next) return;
		onOpenChange(false);
		if (rows) {
			setRows(null);
			onFinished();
		}
	}

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
				{rows ? (
					<BulkReimbursementResults items={items} rows={rows} onDone={() => close(false)} />
				) : (
					<>
						<DialogHeader>
							<DialogTitle>
								{t("travelExpenses.finance.bulk.title", "Mark as reimbursed")}
							</DialogTitle>
							<DialogDescription>
								{t(
									"travelExpenses.finance.bulk.description",
									"Each selected expense is reimbursed in full, in its own currency, with this payment date and reference. Z8 does not transfer any money.",
								)}
							</DialogDescription>
						</DialogHeader>
						{open && (
							<BulkReimbursementForm
								items={items}
								onCancel={() => close(false)}
								onProcessed={setRows}
							/>
						)}
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

function BulkReimbursementForm({
	items,
	onCancel,
	onProcessed,
}: {
	items: readonly BulkReimbursementItem[];
	onCancel: () => void;
	onProcessed: (rows: BulkReimbursementRow[]) => void;
}) {
	const { t } = useTranslate();
	const timeZone = useUserTimezone();
	const attempt = useRef<{ values: string; key: string } | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const parse = (value: FormValues) =>
		parseSettlementPayment(value, {
			latestDate: latestCalendarDate(systemClock.nowInstant()),
		});
	// The same rules the server applies, so a field's error clears as soon as its value is valid.
	const validators = (name: FormField) => ({
		onChange: ({ fieldApi }: { fieldApi: { form: { state: { values: FormValues } } } }) => {
			const parsed = parse(fieldApi.form.state.values);
			const error = parsed.ok ? undefined : parsed.errors.find((e) => e.field === name);
			return error ? settlementFieldMessage(t, error) : undefined;
		},
	});
	const failed = t(
		"travelExpenses.finance.bulk.failed",
		"The expenses could not be marked as reimbursed. Please retry.",
	);

	const form = useForm({
		defaultValues: {
			occurredOn: defaultPaymentDate(timeZone),
			reference: "",
			note: "",
		} satisfies FormValues,
		// A field that was never touched has no error yet: submitting shows them all.
		canSubmitWhenInvalid: true,
		onSubmit: async ({ value, formApi }) => {
			setProblem(null);
			const showFieldErrors = (errors: SettlementCommandFieldError[]) => {
				for (const error of errors) {
					if (!(error.field in value)) continue;
					const name = error.field as FormField;
					// Shown once: a change already reported this field.
					if (formApi.getFieldMeta(name)?.errorMap.onChange) continue;
					formApi.setFieldMeta(name, (meta) => ({
						...meta,
						errorMap: { ...meta.errorMap, onSubmit: settlementFieldMessage(t, error) },
					}));
				}
			};
			const parsed = parse(value);
			if (!parsed.ok) {
				showFieldErrors(parsed.errors);
				return;
			}
			const accounts = items.map(({ account }) => ({
				source: account.source,
				// The balance shown: exactly this is reimbursed, or nothing if it changed.
				expectedBalance: {
					currency: account.currency ?? "",
					amount: payableLine(account)?.balance ?? "0.00",
				},
			}));
			const values = JSON.stringify([parsed.payment, accounts]);
			if (attempt.current?.values !== values) {
				attempt.current = { values, key: crypto.randomUUID() };
			}
			const result = await markTravelExpensesReimbursedAction({
				requestKey: attempt.current.key,
				accounts,
				...parsed.payment,
			});
			if (!result.success) {
				// Keep the key: resubmitting the same payment is a safe retry.
				setProblem(failed);
				return;
			}
			if (result.data.status === "invalid") {
				showFieldErrors(result.data.errors);
				return;
			}
			attempt.current = null;
			onProcessed(result.data.rows);
		},
	});

	return (
		<form
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
			className="grid gap-4"
		>
			<form.Field name="occurredOn" validators={validators("occurredOn")}>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)} required>
							{t("travelExpenses.settlement.form.date", "Payment date")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<DatePicker
								name="occurredOn"
								value={field.state.value}
								max={latestCalendarDate(systemClock.nowInstant())}
								onChange={field.handleChange}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="reference" validators={validators("reference")}>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)} required>
							{t("travelExpenses.settlement.form.reference", "Payment reference")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								name="reference"
								autoComplete="off"
								maxLength={SETTLEMENT_REFERENCE_MAX_LENGTH}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormDescription>
							{t(
								"travelExpenses.finance.bulk.referenceHint",
								"The same reference is recorded for every selected expense, e.g. the bank transfer batch.",
							)}
						</TFormDescription>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="note" validators={validators("note")}>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("travelExpenses.settlement.form.note", "Note (optional)")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Textarea
								name="note"
								rows={2}
								maxLength={SETTLEMENT_NOTE_MAX_LENGTH}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			{problem && (
				<Alert variant="destructive" role="alert">
					<IconAlertTriangle aria-hidden="true" className="size-4" />
					<AlertDescription>{problem}</AlertDescription>
				</Alert>
			)}
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting && <IconLoader2 aria-hidden="true" className="size-4 animate-spin" />}
							{t("travelExpenses.finance.bulk.submit", "Mark {count} as reimbursed", {
								count: items.length,
							})}
						</Button>
					</DialogFooter>
				)}
			</form.Subscribe>
		</form>
	);
}

function BulkReimbursementResults({
	items,
	rows,
	onDone,
}: {
	items: readonly BulkReimbursementItem[];
	rows: readonly BulkReimbursementRow[];
	onDone: () => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const labels = new Map(
		items.map((item) => [settlementSourceKey(item.account.source), item.label]),
	);
	const reimbursed = rows.filter((row) => row.outcome === "reimbursed").length;
	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{t("travelExpenses.finance.bulk.results.title", "Reimbursement results")}
				</DialogTitle>
				<DialogDescription>
					{t("travelExpenses.finance.bulk.results.summary", "{reimbursed} of {total} reimbursed", {
						reimbursed,
						total: rows.length,
					})}
				</DialogDescription>
			</DialogHeader>
			<ul className="divide-y rounded-md border">
				{rows.map((row) => {
					const key = settlementSourceKey(row.source);
					const done = row.outcome === "reimbursed";
					return (
						<li key={key} className="flex items-start gap-3 px-3 py-2 text-sm">
							{done ? (
								<IconCircleCheck
									aria-hidden="true"
									className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
								/>
							) : (
								<IconAlertTriangle
									aria-hidden="true"
									className="mt-0.5 size-4 shrink-0 text-muted-foreground"
								/>
							)}
							<div className="min-w-0 flex-1">
								<p className="truncate font-medium">{labels.get(key) ?? "—"}</p>
								<p className={done ? "tabular-nums" : "text-muted-foreground"}>
									{outcomeText(t, locale, row)}
								</p>
							</div>
						</li>
					);
				})}
			</ul>
			<DialogFooter>
				<Button type="button" onClick={onDone}>
					{t("travelExpenses.finance.bulk.results.done", "Done")}
				</Button>
			</DialogFooter>
		</>
	);
}
