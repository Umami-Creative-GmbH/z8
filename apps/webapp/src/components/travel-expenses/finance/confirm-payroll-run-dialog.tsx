"use client";

import { IconAlertTriangle, IconCircleCheck, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { confirmPayrollRunAction } from "@/app/[locale]/(app)/travel-expenses/finance-actions";
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
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { systemClock } from "@/lib/datetime/temporal-core";
import { formatMoney, formatPlainDateRange } from "@/lib/travel-expenses/format";
import { latestCalendarDate } from "@/lib/travel-expenses/future-dates";
import type {
	PayrollRunConfirmationRow,
	PayrollRunToConfirm,
} from "@/lib/travel-expenses/payroll-run-confirmation";
import { parseSettlementPayment } from "@/lib/travel-expenses/settlement";
import { ResultRow } from "./bulk-reimbursement-dialog";
import { settlementFieldMessage } from "./record-reimbursement-form";

type Translate = ReturnType<typeof useTranslate>["t"];

function outcomeText(t: Translate, locale: string, row: PayrollRunConfirmationRow): string {
	const money = (amount: string | null) => (amount ? formatMoney(locale, amount, "EUR") : "");
	switch (row.outcome) {
		case "confirmed":
			return row.remaining
				? t(
						"travelExpenses.finance.payrollRun.confirm.outcome.confirmedWithRemainder",
						"Reimbursed {amount}. {remaining} still awaits reimbursement for the next run.",
						{ amount: money(row.amount), remaining: money(row.remaining) },
					)
				: t("travelExpenses.finance.payrollRun.confirm.outcome.confirmed", "Reimbursed {amount}", {
						amount: money(row.amount),
					});
		case "overpaid_by_payroll":
			return t(
				"travelExpenses.finance.payrollRun.confirm.outcome.overpaidByPayroll",
				"Reimbursed {amount}, {overpaid} more than was still owed. The expense is now overpaid: record the recovery by hand.",
				{ overpaid: money(row.overpaid), amount: money(row.amount) },
			);
		case "own_expense":
			return t(
				"travelExpenses.finance.payrollRun.confirm.outcome.ownExpense",
				"Not confirmed: your own expense. It stays in the run for someone else to confirm.",
			);
		case "out_of_scope":
			return t(
				"travelExpenses.finance.payrollRun.confirm.outcome.outOfScope",
				"Not confirmed: outside your scope. It stays in the run for an officer who covers it.",
			);
		case "failed":
			return t("travelExpenses.finance.bulk.outcome.failed", "Failed");
	}
}

/**
 * "Confirm as paid" for an unconfirmed payroll run (#853): the payday, then a
 * result per report in the bulk reimbursement style. Each report the reader
 * may confirm is recorded as reimbursed with the run; the others stay in it.
 */
export function ConfirmPayrollRunButton({
	run,
	defaultOpen = false,
	onConfirmed,
}: {
	run: Pick<
		PayrollRunToConfirm,
		"jobId" | "formatName" | "periodStart" | "periodEnd" | "defaultPayday"
	> &
		Partial<Pick<PayrollRunToConfirm, "confirmableReports" | "confirmableAmount">>;
	/** Opens the dialog on mount, as a link to this run's confirmation does. */
	defaultOpen?: boolean;
	/** Called once the results were shown and closed. */
	onConfirmed: () => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [open, setOpen] = useState(defaultOpen);
	const [rows, setRows] = useState<PayrollRunConfirmationRow[] | null>(null);
	const period = formatPlainDateRange(locale, run.periodStart, run.periodEnd);

	function close(next: boolean) {
		if (next) return;
		setOpen(false);
		if (rows) {
			setRows(null);
			onConfirmed();
		}
	}

	return (
		<>
			<Button type="button" size="sm" onClick={() => setOpen(true)}>
				{t("travelExpenses.finance.payrollRun.confirm.action", "Confirm as paid")}
			</Button>
			<Dialog open={open} onOpenChange={close}>
				<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
					{rows ? (
						<ConfirmationResults rows={rows} onDone={() => close(false)} />
					) : (
						<>
							<DialogHeader>
								<DialogTitle>
									{t(
										"travelExpenses.finance.payrollRun.confirm.title",
										"Confirm payroll run {period} as paid",
										{ period },
									)}
								</DialogTitle>
								<DialogDescription>
									{run.confirmableReports !== undefined && run.confirmableAmount !== undefined
										? t(
												"travelExpenses.finance.payrollRun.confirm.descriptionCounted",
												"Payroll paid this {format} run? {count, plural, one {# expense report} other {# expense reports}} in your scope ({amount}) are recorded as reimbursed with it. Your own reports and reports outside your scope stay in the run.",
												{
													format: run.formatName,
													count: run.confirmableReports,
													amount: formatMoney(locale, run.confirmableAmount, "EUR"),
												},
											)
										: t(
												"travelExpenses.finance.payrollRun.confirm.description",
												"Payroll paid this {format} run? The expense reports in your scope are recorded as reimbursed with it. Your own reports and reports outside your scope stay in the run.",
												{ format: run.formatName },
											)}
								</DialogDescription>
							</DialogHeader>
							{open && (
								<ConfirmForm
									jobId={run.jobId}
									defaultPayday={run.defaultPayday}
									onCancel={() => close(false)}
									onProcessed={setRows}
								/>
							)}
						</>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}

function ConfirmForm({
	jobId,
	defaultPayday,
	onCancel,
	onProcessed,
}: {
	jobId: string;
	defaultPayday: string;
	onCancel: () => void;
	onProcessed: (rows: PayrollRunConfirmationRow[]) => void;
}) {
	const { t } = useTranslate();
	const [problem, setProblem] = useState<string | null>(null);
	const latestDate = () => latestCalendarDate(systemClock.nowInstant());
	// The server's payday rules; the reference is the run's own.
	const paydayError = (payday: string) => {
		const parsed = parseSettlementPayment(
			{ occurredOn: payday, reference: "payroll" },
			{ latestDate: latestDate() },
		);
		const error = parsed.ok ? undefined : parsed.errors.find((e) => e.field === "occurredOn");
		return error ? settlementFieldMessage(t, error) : undefined;
	};

	const form = useForm({
		defaultValues: { payday: defaultPayday },
		canSubmitWhenInvalid: true,
		onSubmit: async ({ value, formApi }) => {
			setProblem(null);
			const error = paydayError(value.payday);
			if (error) {
				formApi.setFieldMeta("payday", (meta) => ({
					...meta,
					errorMap: { ...meta.errorMap, onSubmit: error },
				}));
				return;
			}
			const result = await confirmPayrollRunAction({ jobId, payday: value.payday });
			if (!result.success) {
				setProblem(
					t(
						"travelExpenses.finance.payrollRun.confirm.failed",
						"The payroll run could not be confirmed. Please retry; nothing is recorded twice.",
					),
				);
				return;
			}
			if (result.data.status === "invalid") {
				const invalid = result.data.errors.find((e) => e.field === "occurredOn");
				if (invalid) {
					formApi.setFieldMeta("payday", (meta) => ({
						...meta,
						errorMap: { ...meta.errorMap, onSubmit: settlementFieldMessage(t, invalid) },
					}));
				}
				return;
			}
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
			<form.Field
				name="payday"
				validators={{ onChange: ({ value }: { value: string }) => paydayError(value) }}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)} required>
							{t("travelExpenses.finance.payrollRun.confirm.payday", "Payday")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<DatePicker
								name="payday"
								value={field.state.value}
								max={latestDate()}
								onChange={field.handleChange}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormDescription>
							{t(
								"travelExpenses.finance.payrollRun.confirm.paydayHint",
								"The date the payslips were paid. Every reimbursement of this run is recorded on it.",
							)}
						</TFormDescription>
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
							{isSubmitting ? (
								<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
							) : (
								<IconCircleCheck aria-hidden="true" className="size-4" />
							)}
							{t("travelExpenses.finance.payrollRun.confirm.submit", "Confirm as paid")}
						</Button>
					</DialogFooter>
				)}
			</form.Subscribe>
		</form>
	);
}

function ConfirmationResults({
	rows,
	onDone,
}: {
	rows: readonly PayrollRunConfirmationRow[];
	onDone: () => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const confirmed = rows.filter(
		(row) => row.outcome === "confirmed" || row.outcome === "overpaid_by_payroll",
	).length;
	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{t("travelExpenses.finance.payrollRun.confirm.results.title", "Confirmation results")}
				</DialogTitle>
				<DialogDescription>
					{rows.length === 0
						? t(
								"travelExpenses.finance.payrollRun.confirm.results.nothing",
								"Nothing in this run was left to confirm. No reimbursement is recorded.",
							)
						: t(
								"travelExpenses.finance.payrollRun.confirm.results.summary",
								"{confirmed} of {total} confirmed",
								{ confirmed, total: rows.length },
							)}
				</DialogDescription>
			</DialogHeader>
			{rows.length > 0 && (
				<ul className="divide-y rounded-md border">
					{rows.map((row) => (
						<ResultRow
							key={row.reportId}
							label={`${row.employeeName ?? "—"} · ${formatMoney(locale, row.frozenAmount, "EUR")}`}
							done={row.outcome === "confirmed"}
							text={outcomeText(t, locale, row)}
						/>
					))}
				</ul>
			)}
			<DialogFooter>
				<Button type="button" onClick={onDone}>
					{t("travelExpenses.finance.bulk.results.done", "Done")}
				</Button>
			</DialogFooter>
		</>
	);
}
