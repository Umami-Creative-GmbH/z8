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
import { Textarea } from "@/components/ui/textarea";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	type CurrencySettlement,
	latestCalendarDate,
	parseSettlementCommand,
	SETTLEMENT_NOTE_MAX_LENGTH,
	SETTLEMENT_REFERENCE_MAX_LENGTH,
	type SettlementCommandFieldError,
	type SettlementEntryKind,
	type SettlementPlanRefusal,
} from "@/lib/travel-expenses/settlement";
import type { SettlementAccount, SettlementSource } from "@/lib/travel-expenses/settlement-store";

type Translate = ReturnType<typeof useTranslate>["t"];
type FormField = "amount" | "occurredOn" | "reference" | "note";

interface FormValues {
	amount: string;
	occurredOn: string;
	reference: string;
	note: string;
}

function fieldMessage(t: Translate, error: SettlementCommandFieldError): string {
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
	const [errors, setErrors] = useState<SettlementCommandFieldError[]>([]);
	const [problem, setProblem] = useState<string | null>(null);

	const form = useForm({
		defaultValues: {
			amount: suggested,
			occurredOn: "",
			reference: "",
			note: "",
		} satisfies FormValues,
		onSubmit: async ({ value, formApi }) => {
			setProblem(null);
			const parsed = parseSettlementCommand(
				{ kind, currency: line.currency, ...value },
				{ latestDate: latestCalendarDate(systemClock.nowInstant()) },
			);
			if (!parsed.ok) {
				setErrors(parsed.errors);
				return;
			}
			setErrors([]);
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
				setErrors(outcome.errors);
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

	const errorFor = (field: FormField) => {
		const error = errors.find((candidate) => candidate.field === field);
		return error ? fieldMessage(t, error) : null;
	};

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
							"travelExpenses.settlement.recoveryForm.notice",
							"The employee was paid more than is now approved. Record money they already returned to settle the overpayment; the original reimbursement stays as recorded and nothing is offset against other reports. Z8 does not transfer any money.",
						)
					: t(
							"travelExpenses.settlement.form.notice",
							"Record money already paid to the employee. Z8 does not transfer any money.",
						)}
			</p>
			<div className="grid gap-4 sm:grid-cols-2">
				<form.Field name="amount">
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={!!errorFor("amount")}>
								{recovery
									? t("travelExpenses.settlement.recoveryForm.amount", "Amount recovered ({currency})", {
											currency: line.currency,
										})
									: t("travelExpenses.settlement.form.amount", "Amount paid ({currency})", {
											currency: line.currency,
										})}
							</TFormLabel>
							<TFormControl hasError={!!errorFor("amount")}>
								<Input
									name="amount"
									inputMode="decimal"
									autoComplete="off"
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage>{errorFor("amount")}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>
				<form.Field name="occurredOn">
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={!!errorFor("occurredOn")}>
								{recovery
									? t("travelExpenses.settlement.recoveryForm.date", "Recovery date")
									: t("travelExpenses.settlement.form.date", "Payment date")}
							</TFormLabel>
							<TFormControl hasError={!!errorFor("occurredOn")}>
								<DatePicker
									name="occurredOn"
									value={field.state.value}
									onChange={field.handleChange}
									onBlur={field.handleBlur}
								/>
							</TFormControl>
							<TFormMessage>{errorFor("occurredOn")}</TFormMessage>
						</TFormItem>
					)}
				</form.Field>
			</div>
			<form.Field name="reference">
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={!!errorFor("reference")}>
							{t("travelExpenses.settlement.form.reference", "Payment reference")}
						</TFormLabel>
						<TFormControl hasError={!!errorFor("reference")}>
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
						<TFormMessage>{errorFor("reference")}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="note">
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={!!errorFor("note")}>
							{t("travelExpenses.settlement.form.note", "Note (optional)")}
						</TFormLabel>
						<TFormControl hasError={!!errorFor("note")}>
							<Textarea
								name="note"
								rows={2}
								maxLength={SETTLEMENT_NOTE_MAX_LENGTH}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormMessage>{errorFor("note")}</TFormMessage>
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
