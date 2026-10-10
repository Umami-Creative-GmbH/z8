"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
	type RecordReimbursementResult,
	recordTravelExpenseReimbursementAction,
} from "@/app/[locale]/(app)/travel-expenses/finance-actions";
import { recordTravelExpenseRecoveryAction } from "@/app/[locale]/(app)/travel-expenses/finance-recovery-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
import { systemClock } from "@/lib/datetime/temporal-core";
import { latestCalendarDate } from "@/lib/travel-expenses/future-dates";
import {
	type CurrencySettlement,
	parseSettlementCommand,
	SETTLEMENT_NOTE_MAX_LENGTH,
	SETTLEMENT_REFERENCE_MAX_LENGTH,
	type SettlementCommandFieldError,
	type SettlementEntryKind,
	type SettlementPlanRefusal,
} from "@/lib/travel-expenses/settlement";
import type { SettlementAccount, SettlementSource } from "@/lib/travel-expenses/settlement-store";

type Translate = ReturnType<typeof useTranslate>["t"];
const FORM_FIELDS = ["amount", "occurredOn", "reference", "note"] as const;
type FormField = (typeof FORM_FIELDS)[number];

function isFormField(field: string): field is FormField {
	return (FORM_FIELDS as readonly string[]).includes(field);
}

interface FormValues {
	amount: string;
	occurredOn: string;
	reference: string;
	note: string;
}

/** Field error copy shared with bulk reimbursement (#754). */
export function settlementFieldMessage(t: Translate, error: SettlementCommandFieldError): string {
	switch (`${error.field}:${error.code}`) {
		case "amount:required":
			return t("travelExpenses.settlement.errors.amountRequired", "Enter the amount paid.");
		case "amount:precision":
			return t(
				"travelExpenses.settlement.errors.amountPrecision",
				"This currency does not have that many decimal places.",
			);
		case "occurredOn:required":
			return t("travelExpenses.settlement.errors.dateRequired", "Enter the payment date.");
		case "occurredOn:future":
			return t(
				"travelExpenses.settlement.errors.dateFuture",
				"A payment cannot be dated in the future.",
			);
		case "reference:required":
			return t(
				"travelExpenses.settlement.errors.referenceRequired",
				"Enter the payment reference, e.g. the bank transfer reference.",
			);
		case "reference:too_long":
		case "note:too_long":
			return t("travelExpenses.settlement.errors.tooLong", "This text is too long.");
		case "occurredOn:invalid":
			return t("travelExpenses.settlement.errors.dateInvalid", "Enter a valid date.");
		default:
			return t("travelExpenses.settlement.errors.amountInvalid", "Enter a positive amount.");
	}
}

function refusalMessage(t: Translate, reason: SettlementPlanRefusal): string {
	switch (reason) {
		case "stale_balance":
			return t(
				"travelExpenses.settlement.errors.staleBalance",
				"The balance changed while you were entering this payment. Check the updated balance and record it again.",
			);
		case "exceeds_outstanding":
			return t(
				"travelExpenses.settlement.errors.exceedsOutstanding",
				"The amount is more than is outstanding.",
			);
		case "nothing_outstanding":
			return t(
				"travelExpenses.settlement.errors.nothingOutstanding",
				"Nothing is outstanding for this expense.",
			);
		case "exceeds_overpayment":
			return t(
				"travelExpenses.settlement.errors.exceedsOverpayment",
				"The amount is more than was overpaid.",
			);
		case "no_overpayment":
			return t(
				"travelExpenses.settlement.errors.noOverpayment",
				"Nothing was overpaid for this expense.",
			);
		default:
			return t(
				"travelExpenses.settlement.errors.refused",
				"This payment cannot be recorded for this expense.",
			);
	}
}

function outcomeMessage(t: Translate, result: RecordReimbursementResult): string | null {
	switch (result.status) {
		case "refused":
			return refusalMessage(t, result.reason);
		case "idempotency_conflict":
			return t(
				"travelExpenses.settlement.errors.conflict",
				"An earlier attempt with other values was already recorded. Check the history before recording again.",
			);
		case "not_approved":
			return t(
				"travelExpenses.settlement.errors.notApproved",
				"This expense is no longer approved, so no payment can be recorded.",
			);
		case "own_expense":
			return t(
				"travelExpenses.settlement.errors.ownExpense",
				"You cannot record payments for your own expenses.",
			);
		case "in_payroll_run":
			return t(
				"travelExpenses.settlement.errors.inPayrollRun",
				"A payroll run now includes this expense, so it is paid with payroll. Remove it from the run before recording a payment.",
			);
		default:
			return null;
	}
}

/**
 * Records a reimbursement finance paid outside Z8 (#612). One idempotency key
 * is kept for as long as the same values are resubmitted, so a retry after a
 * lost response can never record the payment twice; the balance shown is sent
 * along, so a payment recorded meanwhile by someone else is not applied twice.
 */
export function RecordReimbursementForm({
	source,
	line,
	onSettled,
	kind = "reimbursement",
}: {
	source: SettlementSource;
	/** The outstanding (or, for a recovery, overpaid) currency line the entry settles. */
	line: CurrencySettlement;
	/** Called with the fresh account after any server answer that changes what is shown. */
	onSettled: (account: SettlementAccount | null) => void;
	/** `recovery` (#615): money the employee returned against an overpayment. */
	kind?: SettlementEntryKind;
}) {
	const { t } = useTranslate();
	const recovery = kind === "recovery";
	const record = recovery ? recordTravelExpenseRecoveryAction : recordTravelExpenseReimbursementAction;
	// The overpayment is the negative balance; a recovery is entered as a positive amount.
	const suggested = recovery ? line.balance.replace(/^-/, "") : line.balance;
	const attempt = useRef<{ values: string; key: string } | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const parse = (value: FormValues) =>
		parseSettlementCommand(
			{ kind, currency: line.currency, ...value },
			{ latestDate: latestCalendarDate(systemClock.nowInstant()) },
		);
	// The same parser the server runs, so a field's error clears as soon as its value is valid.
	const validators = (name: FormField) => ({
		onChange: ({ fieldApi }: { fieldApi: { form: { state: { values: FormValues } } } }) => {
			const parsed = parse(fieldApi.form.state.values);
			const error = parsed.ok ? undefined : parsed.errors.find((e) => e.field === name);
			return error ? settlementFieldMessage(t, error) : undefined;
		},
	});

	const form = useForm({
		defaultValues: {
			amount: suggested,
			occurredOn: "",
			reference: "",
			note: "",
		} satisfies FormValues,
		onSubmit: async ({ value, formApi }) => {
			setProblem(null);
			// A refusal stays on its field until that field changes.
			const showFieldErrors = (errors: SettlementCommandFieldError[]) => {
				let shown = false;
				for (const error of errors) {
					if (!isFormField(error.field)) continue;
					shown = true;
					const message = settlementFieldMessage(t, error);
					formApi.setFieldMeta(error.field, (meta) => ({
						...meta,
						errorMap: { ...meta.errorMap, onSubmit: message },
					}));
				}
				if (!shown) {
					setProblem(
						t(
							"travelExpenses.settlement.errors.failed",
							"The payment could not be recorded. Please retry.",
						),
					);
				}
			};
			const parsed = parse(value);
			if (!parsed.ok) {
				showFieldErrors(parsed.errors);
				return;
			}
			const values = JSON.stringify(parsed.command);
			if (attempt.current?.values !== values) {
				attempt.current = { values, key: crypto.randomUUID() };
			}
			const result = await record({
				source,
				idempotencyKey: attempt.current.key,
				amount: parsed.command.amount,
				occurredOn: parsed.command.occurredOn,
				reference: parsed.command.reference,
				note: parsed.command.note,
				expectedBalance: { currency: line.currency, amount: line.balance },
			});
			if (!result.success) {
				// Keep the key: resubmitting the same values is a safe retry.
				setProblem(
					t(
						"travelExpenses.settlement.errors.failed",
						"The payment could not be recorded. Please retry.",
					),
				);
				return;
			}
			const outcome = result.data;
			if (outcome.status === "invalid") {
				showFieldErrors(outcome.errors);
				return;
			}
			attempt.current = null;
			if (outcome.status === "recorded") {
				toast.success(
					outcome.replayed
						? t("travelExpenses.settlement.recordedAlready", "This payment was already recorded.")
						: recovery
							? t("travelExpenses.settlement.recoveryRecorded", "Recovery recorded.")
							: t("travelExpenses.settlement.recorded", "Reimbursement recorded."),
				);
				formApi.reset();
				onSettled(outcome.account);
				return;
			}
			setProblem(outcomeMessage(t, outcome));
			onSettled(outcome.status === "refused" ? outcome.account : null);
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
			aria-label={
				recovery
					? t("travelExpenses.settlement.recoveryForm.label", "Record a recovery")
					: t("travelExpenses.settlement.form.label", "Record a reimbursement")
			}
		>
			<p className="text-sm text-muted-foreground">
				{recovery
					? t(
							"travelExpenses.settlement.recoveryForm.explanation",
							"The employee was paid more than is now approved. Record money they already paid back to cover the overpayment; the original reimbursement stays as recorded and nothing is offset against other reports. Z8 does not transfer any money.",
						)
					: t(
							"travelExpenses.settlement.form.notice",
							"Record money already paid to the employee. Z8 does not transfer any money.",
						)}
			</p>
			<div className="grid gap-4 sm:grid-cols-2">
				<form.Field name="amount" validators={validators("amount")}>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{recovery
									? t("travelExpenses.settlement.recoveryForm.amount", "Amount recovered ({currency})", {
											currency: line.currency,
										})
									: t("travelExpenses.settlement.form.amount", "Amount paid ({currency})", {
											currency: line.currency,
										})}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<Input
									name="amount"
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
				<form.Field name="occurredOn" validators={validators("occurredOn")}>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{recovery
									? t("travelExpenses.settlement.recoveryForm.date", "Recovery date")
									: t("travelExpenses.settlement.form.date", "Payment date")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<DatePicker
									name="occurredOn"
									value={field.state.value}
									onChange={field.handleChange}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
			</div>
			<form.Field name="reference" validators={validators("reference")}>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
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
								"travelExpenses.settlement.form.referenceHint",
								"For example the bank transfer or payroll run reference.",
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
					<AlertDescription>{problem}</AlertDescription>
				</Alert>
			)}
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<Button type="submit" disabled={isSubmitting} className="justify-self-start">
						{isSubmitting && <IconLoader2 aria-hidden="true" className="size-4 animate-spin" />}
						{recovery
							? t("travelExpenses.settlement.recoveryForm.submit", "Record recovery")
							: t("travelExpenses.settlement.form.submit", "Record reimbursement")}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}
