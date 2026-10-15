"use client";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { useTranslate } from "@tolgee/react";
import { previewHistoricalVacationReconciliation } from "@/app/[locale]/(app)/settings/vacation/reconciliation-actions";
import type { VacationReconciliationReview } from "@/lib/absences/vacation-reconciliation";
import type {
	ReconciliationProof,
	ReconciliationSource,
} from "@/lib/absences/vacation-reconciliation-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormDescription,
	TFormMessage,
} from "@/components/ui/tanstack-form";

/** Explicit review: dates come from the containing editor; amounts are always supplied by the reviewer. */
export function HistoricalVacationReconciliationPanel({
	source,
	onReviewed,
}: {
	source: ReconciliationSource;
	onReviewed: (proof: ReconciliationProof | null) => void;
}) {
	const { t } = useTranslate();
	const [review, setReview] = useState<VacationReconciliationReview | null>(
		null,
	);
	const [error, setError] = useState("");
	const form = useForm({
		defaultValues: { reason: "", remaining: [] as string[] },
		onSubmit: async ({ value }) => {
			onReviewed(null);
			setError("");
			const decisions =
				review?.totals.flatMap((total, index) =>
					value.remaining[index]?.trim()
						? [
								{
									employeeId: total.employeeId,
									year: total.year,
									remainingDays: Number(value.remaining[index]),
								},
							]
						: [],
				) ?? [];
			try {
				const result = await previewHistoricalVacationReconciliation({
					...source,
					reason: value.reason,
					decisions,
				});
				if (!result.success) {
					setError(result.error);
					return;
				}
				if (
					!review ||
					review.totals.map((row) => row.id).join() !==
						result.data.totals.map((row) => row.id).join()
				)
					form.setFieldValue(
						"remaining",
						result.data.totals.map(() => ""),
					);
				setReview(result.data);
				if (!result.data.blockers.length)
					onReviewed({
						operationId: result.data.operationId,
						fingerprint: result.data.fingerprint,
					});
			} catch {
				setError(
					t(
						"absences.reconciliation.failed",
						"Could not review the historical vacation. Try again.",
					),
				);
			}
		},
	});
	return (
		<section
			className="space-y-3 rounded-lg border p-4"
			aria-label={t(
				"absences.reconciliation.title",
				"Reconcile previously taken vacation",
			)}
		>
			<h3 className="font-medium">
				{t(
					"absences.reconciliation.title",
					"Reconcile previously taken vacation",
				)}
			</h3>
			<p className="text-sm text-muted-foreground">
				{t(
					"absences.reconciliation.help",
					"When these dates replace vacation already included in a historical total, review the remaining total explicitly. The dated records and total are saved together. Date changes still require another approver.",
				)}
			</p>
			<form.Field
				name="reason"
				validators={{
					onSubmit: ({ value }) =>
						value.trim()
							? undefined
							: t(
									"absences.reconciliation.reasonRequired",
									"A review reason is required.",
								),
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t(
								"absences.reconciliation.reason",
								"Reconciliation reason and source",
							)}
						</TFormLabel>
						<TFormControl>
							<Textarea
								name={field.name}
								autoComplete="off"
								maxLength={2000}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => {
									field.handleChange(event.target.value);
									onReviewed(null);
								}}
							/>
						</TFormControl>
						<TFormDescription>
							{t(
								"absences.reconciliation.reasonHint",
								"Explain which payroll or absence records establish the replacement.",
							)}
						</TFormDescription>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			{review?.totals.map((total, index) => (
				<div key={total.id} className="space-y-2">
					<p className="text-sm">
						{total.employeeName} · {total.year}: {total.currentDays}{" "}
						{t("absences.reconciliation.current", "previously taken days")};{" "}
						{total.coverageStart} – {total.coverageEnd}.{" "}
						{t("absences.reconciliation.dated", "Newly dated days")}:{" "}
						{total.datedDays}.
					</p>
					<form.Field
						name={`remaining[${index}]`}
						validators={{
							onSubmit: ({ value }) =>
								value !== "" &&
								Number(value) >= 0 &&
								Number(value) <= total.currentDays &&
								Number(value) % 0.5 === 0
									? undefined
									: t(
											"absences.reconciliation.amountRequired",
											"Enter the reviewed remaining total in half-day steps.",
										),
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel>
									{t(
										"absences.reconciliation.remaining",
										"Remaining previously taken days",
									)}{" "}
									({total.employeeName} · {total.year})
								</TFormLabel>
								<TFormControl>
									<Input
										name={field.name}
										autoComplete="off"
										type="number"
										min="0"
										max={total.currentDays}
										step="0.5"
										value={field.state.value ?? ""}
										onBlur={field.handleBlur}
										onChange={(event) => {
											field.handleChange(event.target.value);
											onReviewed(null);
										}}
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"absences.reconciliation.amountHint",
										"Only reduce the amount already represented by these dated records. Enter zero for a complete replacement.",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
				</div>
			))}
			{review?.balances.map((balance) => (
				<p className="text-sm" key={`${balance.employeeId}:${balance.year}`}>
					{balance.employeeName} · {balance.year}{" "}
					{t("absences.reconciliation.balance", "available vacation")}:{" "}
					{balance.before?.remainingDays ?? "—"} →{" "}
					{balance.after?.remainingDays ?? "—"}
				</p>
			))}
			{review?.absences.map((absence) => (
				<p className="text-xs text-muted-foreground" key={absence.id}>
					{absence.employeeName} · {absence.categoryName}: {absence.startDate} (
					{absence.startPeriod}) – {absence.endDate} ({absence.endPeriod})
				</p>
			))}
			{error || review?.blockers.length ? (
				<p role="alert" className="text-sm text-destructive">
					{error || review?.blockers.join(" ")}
				</p>
			) : review ? (
				<p role="status" className="text-sm">
					{t(
						"absences.reconciliation.ready",
						"Review confirmed. Save the absence or queue the import to apply this reconciliation.",
					)}
				</p>
			) : null}
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(busy) => (
					<Button
						type="button"
						variant="outline"
						disabled={busy}
						onClick={() => void form.handleSubmit()}
					>
						{busy
							? t("common.loading", "Loading…")
							: t("absences.reconciliation.review", "Review reconciliation")}
					</Button>
				)}
			</form.Subscribe>
		</section>
	);
}
