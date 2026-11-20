"use client";

import {
	IconAlertCircle,
	IconAlertTriangle,
	IconCircleCheck,
	IconLoader2,
	IconRotate,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
	getPayrollDaySettlementHistoryAction,
	unsettlePayrollDayAction,
} from "@/app/[locale]/(app)/payroll/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import type { PayrollSettlementHistoryEntry } from "@/lib/payroll-period/settlement";
import type { PayrollPeriodDay, PayrollSettledDayValues } from "@/lib/payroll-period/types";
import { queryKeys } from "@/lib/query/keys";
import { absencePeriodLabel, type PayrollDaysFormat, settledChangeText } from "./payroll-days-grid";
import type { PayrollTranslate } from "./state";

/**
 * The settlement part of the Days tab's side panel (#1897): the day's settlement
 * state, what was paid and what changed since, the full settlement history, and
 * unsettling this one day with a required reason.
 */
export function PayrollDaySettlement({
	day,
	employeeId,
	format,
	t,
}: {
	day: PayrollPeriodDay;
	employeeId: string;
	format: PayrollDaysFormat;
	t: PayrollTranslate;
}) {
	const settlement = day.settlement ?? { state: "unsettled" as const };
	const [unsettling, setUnsettling] = useState(false);

	return (
		<section className="flex flex-col gap-2">
			<h3 className="font-medium text-sm">{t("payroll.days.panel.settlement", "Settlement")}</h3>

			{settlement.state === "unsettled" ? (
				<p className="text-muted-foreground text-sm">
					{t("payroll.days.panel.notSettled", "This day is not settled.")}
				</p>
			) : settlement.state === "settled" ? (
				<p className="flex flex-wrap items-center gap-2 text-sm">
					<IconCircleCheck
						aria-hidden="true"
						className="size-4 text-emerald-600 dark:text-emerald-400"
					/>
					{t("payroll.days.panel.settledPaid", "Settled. Paid: {values}", {
						values: paidValuesText(settlement.paid, format, t),
					})}
				</p>
			) : (
				<Alert>
					<IconAlertCircle aria-hidden="true" className="text-amber-600 dark:text-amber-400" />
					<AlertTitle>{settledChangeText(settlement.change, format, t)}</AlertTitle>
					<AlertDescription>
						<span className="block">
							{t("payroll.days.panel.paid", "Paid: {values}", {
								values: paidValuesText(settlement.paid, format, t),
							})}
						</span>
						<span className="block">
							{t("payroll.days.panel.now", "Now: {values}", {
								values: paidValuesText(settlement.change.current, format, t),
							})}
						</span>
					</AlertDescription>
				</Alert>
			)}

			{settlement.state !== "unsettled" ? (
				unsettling ? (
					<UnsettleDayForm
						date={day.date}
						employeeId={employeeId}
						onDone={() => setUnsettling(false)}
						t={t}
					/>
				) : (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="self-start"
						onClick={() => setUnsettling(true)}
					>
						<IconRotate aria-hidden="true" className="size-4" />
						{t("payroll.days.panel.unsettleDay", "Unsettle this day…")}
					</Button>
				)
			) : null}

			<SettlementHistory date={day.date} employeeId={employeeId} format={format} t={t} />
		</section>
	);
}

function UnsettleDayForm({
	date,
	employeeId,
	onDone,
	t,
}: {
	date: string;
	employeeId: string;
	onDone: () => void;
	t: PayrollTranslate;
}) {
	const queryClient = useQueryClient();
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			const result = await unsettlePayrollDayAction({ employeeId, date, reason: value.reason });
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			toast.success(
				result.data.unsettled
					? t("payroll.days.panel.dayUnsettled", "Day unsettled")
					: t("payroll.days.panel.dayWasNotSettled", "This day was not settled anymore"),
			);
			form.reset();
			onDone();
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["payroll", "period"] }),
				queryClient.invalidateQueries({
					queryKey: queryKeys.payroll.daySettlementHistory({ employeeId, date }),
				}),
			]);
		},
	});

	return (
		<form
			className="flex flex-col gap-3 rounded-lg border bg-background p-3"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<p className="text-muted-foreground text-sm">
				{t(
					"payroll.days.panel.unsettleDescription",
					"The day becomes unsettled, so a later payroll file can carry it again. The history keeps what was paid.",
				)}
			</p>
			<form.Field
				name="reason"
				validators={{
					onSubmit: ({ value }) =>
						value.trim()
							? undefined
							: t("payroll.settle.reasonRequired", "A reason is required to unsettle days"),
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)} required>
							{t("payroll.settle.reason", "Reason")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Textarea
								name={field.name}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
								rows={3}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<div className="flex flex-wrap justify-end gap-2">
				<Button type="button" variant="outline" size="sm" onClick={onDone}>
					{t("payroll.settle.cancel", "Cancel")}
				</Button>
				<form.Subscribe selector={(state) => state.isSubmitting}>
					{(isSubmitting) => (
						<Button type="submit" variant="destructive" size="sm" disabled={isSubmitting}>
							{isSubmitting ? (
								<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
							) : null}
							{t("payroll.days.panel.unsettleConfirm", "Unsettle day")}
						</Button>
					)}
				</form.Subscribe>
			</div>
		</form>
	);
}

function SettlementHistory({
	date,
	employeeId,
	format,
	t,
}: {
	date: string;
	employeeId: string;
	format: PayrollDaysFormat;
	t: PayrollTranslate;
}) {
	const locale = useLocale();
	const { data, error, isPending } = useQuery({
		queryKey: queryKeys.payroll.daySettlementHistory({ employeeId, date }),
		queryFn: async () => {
			const result = await getPayrollDaySettlementHistoryAction({ employeeId, date });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	if (error) {
		return (
			<p className="flex items-center gap-2 text-destructive text-sm">
				<IconAlertTriangle aria-hidden="true" className="size-4" />
				{t("payroll.days.panel.historyFailed", "The settlement history could not be loaded.")}
			</p>
		);
	}
	if (isPending || !data) {
		return <Skeleton className="h-12 w-full" aria-busy="true" />;
	}
	if (data.length === 0) return null;

	const occurredAt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
	return (
		<ol
			className="flex flex-col divide-y rounded-lg border bg-background text-sm"
			aria-label={t("payroll.days.panel.history", "Settlement history")}
		>
			{data.map((entry) => (
				<li key={entry.id} className="flex flex-col gap-0.5 px-3 py-2">
					<span className="font-medium">
						{entry.kind === "settled"
							? t("payroll.days.panel.historySettled", "Settled by {name}", {
									name: actorName(entry, t),
								})
							: t("payroll.days.panel.historyUnsettled", "Unsettled by {name}", {
									name: actorName(entry, t),
								})}
					</span>
					<span className="text-muted-foreground text-xs">
						{occurredAt.format(new Date(entry.occurredAt))}
						{" · "}
						{entry.method === "export"
							? t("payroll.days.panel.methodExport", "With export {file}", {
									file:
										entry.payrollExportFileName ??
										t("payroll.days.panel.unknownExport", "(file no longer available)"),
								})
							: t("payroll.days.panel.methodManual", "Manually")}
					</span>
					{entry.reason ? (
						<span className="text-xs">
							{t("payroll.days.panel.historyReason", "Reason: {reason}", { reason: entry.reason })}
						</span>
					) : null}
					<span className="text-muted-foreground text-xs">
						{t("payroll.days.panel.paid", "Paid: {values}", {
							values: paidValuesText(entry.paid, format, t),
						})}
					</span>
				</li>
			))}
		</ol>
	);
}

function actorName(entry: PayrollSettlementHistoryEntry, t: PayrollTranslate): string {
	return entry.actorName ?? t("payroll.days.panel.unknownActor", "a former user");
}

/** "8 h, Vacation (AM)": the credited hours and approved absences of a copy. */
function paidValuesText(
	values: PayrollSettledDayValues,
	format: PayrollDaysFormat,
	t: PayrollTranslate,
): string {
	return [
		t("payroll.days.panel.paidHours", "{hours} h", { hours: format.hours(values.creditedMinutes) }),
		...values.absences.map((absence) => {
			const period = absencePeriodLabel(absence.period, t);
			return period ? `${absence.categoryName} (${period})` : absence.categoryName;
		}),
	].join(", ");
}
