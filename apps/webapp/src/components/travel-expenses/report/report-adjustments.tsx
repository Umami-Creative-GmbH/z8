"use client";

import {
	IconAdjustmentsDollar,
	IconAlertTriangle,
	IconArrowRight,
	IconLoader2,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useRef, useState } from "react";
import {
	createTravelExpenseAdjustmentAction,
	getTravelExpenseReportAdjustments,
} from "@/app/[locale]/(app)/travel-expenses/adjustment-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/query/keys";
import {
	ADJUSTMENT_REASON_MAX_LENGTH,
	type AdjustmentIneligibility,
	adjustmentDelta,
} from "@/lib/travel-expenses/adjustment";
import type { ReportAdjustmentView } from "@/lib/travel-expenses/adjustment-store";
import { Link, useRouter } from "@/navigation";
import { formatMoney } from "./format";
import { formatRecordedInstant, ReportStatusBadge } from "./report-status";

type Translate = ReturnType<typeof useTranslate>["t"];

const NOT_FOUND = "Expense report not found";

/** A signed amount: "+€30.00", "-€50.00". */
function signedMoney(locale: string, amount: string, currency: string): string {
	const formatted = formatMoney(locale, amount, currency);
	return amount.startsWith("-") || /^0(\.0+)?$/.test(amount) ? formatted : `+${formatted}`;
}

/** The owner's adjustment view of a report; null for anyone else (#615). */
function useReportAdjustments(reportId: string) {
	return useQuery({
		queryKey: queryKeys.travelExpenses.reportAdjustments(reportId),
		queryFn: async (): Promise<ReportAdjustmentView | null> => {
			const result = await getTravelExpenseReportAdjustments(reportId);
			if (!result.success) {
				if (result.error === NOT_FOUND) return null;
				throw new Error(result.error);
			}
			return result.data;
		},
	});
}

/**
 * On an adjustment report's page (#615): which report it corrects, why, and
 * the approved amount it is calculated against. Once submitted, the frozen
 * signed difference the reviewer decides.
 */
export function AdjustmentNotice({ reportId }: { reportId: string }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const { data } = useReportAdjustments(reportId);
	if (data?.role !== "adjustment") return null;
	const { baseline, frozen } = data;
	return (
		<Alert>
			<IconAdjustmentsDollar aria-hidden="true" className="size-4" />
			<AlertTitle>
				{t("travelExpenses.adjustment.notice.title", "Adjustment of an approved report")}
			</AlertTitle>
			<AlertDescription className="space-y-2">
				<p className="whitespace-pre-line">{data.reason}</p>
				<dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
					{baseline && (
						<>
							<dt className="text-muted-foreground">
								{t("travelExpenses.adjustment.notice.baseline", "Approved amount it corrects")}
							</dt>
							<dd className="text-right tabular-nums">
								{formatMoney(locale, baseline.entitlement, baseline.currency)}
							</dd>
						</>
					)}
					{frozen && (
						<>
							<dt className="text-muted-foreground">
								{t("travelExpenses.adjustment.notice.delta", "Signed difference")}
							</dt>
							<dd className="text-right font-medium tabular-nums">
								{signedMoney(locale, frozen.delta.amount, frozen.delta.currency)}
							</dd>
						</>
					)}
				</dl>
				{!frozen && (
					<p className="text-sm text-muted-foreground">
						{t(
							"travelExpenses.adjustment.notice.editing",
							"Correct the expenses below. When you submit, the difference to the approved amount is shown for your review and then reviewed afresh. The original report and its payments stay unchanged.",
						)}
					</p>
				)}
				<Link
					href={`/travel-expenses/reports/${data.originalReportId}`}
					className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
				>
					{t("travelExpenses.adjustment.notice.original", "Open the original report")}
					<IconArrowRight aria-hidden="true" className="size-4" />
				</Link>
			</AlertDescription>
		</Alert>
	);
}

/**
 * In the submission review step of an adjustment (#615): the signed
 * difference between the corrected total being submitted and the approved
 * amount in force now. The server recalculates it under lock at submission.
 */
export function AdjustmentDeltaPreview({
	reportId,
	corrected,
}: {
	reportId: string;
	corrected: { amount: string; currency: string };
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const { data } = useReportAdjustments(reportId);
	if (data?.role !== "adjustment" || !data.baseline) return null;
	let delta: { amount: string; currency: string } | null = null;
	try {
		delta = adjustmentDelta(corrected, data.baseline);
	} catch {
		delta = null;
	}
	return (
		<div className="rounded-md border p-3 text-sm" aria-live="polite">
			<p className="font-medium">
				{delta
					? t(
							"travelExpenses.adjustment.preview.delta",
							"This adjustment changes the approved amount of {baseline} by {delta}.",
							{
								baseline: formatMoney(locale, data.baseline.entitlement, data.baseline.currency),
								delta: signedMoney(locale, delta.amount, delta.currency),
							},
						)
					: t(
							"travelExpenses.adjustment.preview.currency",
							"The corrected total is not in the original report's currency, so it cannot be submitted as an adjustment.",
						)}
			</p>
			<p className="text-muted-foreground">
				{t(
					"travelExpenses.adjustment.preview.review",
					"It needs a fresh approval of the whole report, also when the amount goes down.",
				)}
			</p>
		</div>
	);
}

function ineligibleText(t: Translate, reason: AdjustmentIneligibility): string | null {
	switch (reason) {
		case "not_exported_or_reimbursed":
			return null;
		case "is_adjustment":
			return t(
				"travelExpenses.adjustment.ineligible.adjustment",
				"An adjustment is corrected through the report it adjusts.",
			);
		case "not_approved":
			return null;
	}
}

/**
 * The employee's adjustments of their approved report (#615): every linked
 * adjustment with its state and signed difference, and, once the report was
 * exported or reimbursed, the way to correct it with a new one.
 */
export function ReportAdjustmentsPanel({ reportId }: { reportId: string }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [open, setOpen] = useState(false);
	const { data } = useReportAdjustments(reportId);
	if (data?.role !== "original") return null;
	const { eligibility, adjustments, baseline } = data;
	if (!eligibility.ok && adjustments.length === 0) {
		const text = ineligibleText(t, eligibility.reason);
		return text ? <p className="text-sm text-muted-foreground">{text}</p> : null;
	}
	const headingId = `adjustments-${reportId}`;
	return (
		<Card>
			<CardContent className="space-y-4 pt-6">
				<section aria-labelledby={headingId} className="space-y-3">
					<h2 id={headingId} className="text-lg font-semibold">
						{t("travelExpenses.adjustment.panel.title", "Adjustments")}
					</h2>
					<p className="text-sm text-muted-foreground">
						{t(
							"travelExpenses.adjustment.panel.description",
							"This report was already exported or reimbursed, so it stays as approved. A correction is a linked adjustment: it is reviewed afresh and, once approved, changes the approved amount by its signed difference.",
						)}
					</p>
					{baseline && adjustments.some((adjustment) => adjustment.applied) && (
						<p className="text-sm">
							{t(
								"travelExpenses.adjustment.panel.effective",
								"Approved amount including adjustments: {amount}",
								{ amount: formatMoney(locale, baseline.entitlement, baseline.currency) },
							)}
						</p>
					)}
					{adjustments.length > 0 && (
						<ul className="divide-y rounded-md border text-sm">
							{adjustments.map((adjustment) => (
								<li
									key={adjustment.reportId}
									className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
								>
									<ReportStatusBadge status={adjustment.status} />
									{adjustment.delta && adjustment.currency && (
										<span className="font-medium tabular-nums">
											{signedMoney(locale, adjustment.delta, adjustment.currency)}
										</span>
									)}
									{adjustment.applied && (
										<span className="text-muted-foreground">
											{t("travelExpenses.adjustment.panel.applied", "Applied")}
										</span>
									)}
									<span className="text-muted-foreground">
										{formatRecordedInstant(locale, adjustment.createdAt)}
									</span>
									<span className="w-full break-words">{adjustment.reason}</span>
									<Link
										href={`/travel-expenses/reports/${adjustment.reportId}`}
										className="inline-flex items-center gap-1 font-medium underline underline-offset-4"
									>
										{t("travelExpenses.adjustment.panel.open", "Open adjustment")}
										<IconArrowRight aria-hidden="true" className="size-4" />
									</Link>
								</li>
							))}
						</ul>
					)}
				</section>
				{eligibility.ok && (
					<>
						<Button type="button" variant="outline" onClick={() => setOpen(true)}>
							<IconAdjustmentsDollar aria-hidden="true" className="mr-2 size-4" />
							{t("travelExpenses.adjustment.create.action", "Correct with an adjustment")}
						</Button>
						<Dialog open={open} onOpenChange={setOpen}>
							<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
								<DialogHeader>
									<DialogTitle>
										{t("travelExpenses.adjustment.create.title", "Create a linked adjustment?")}
									</DialogTitle>
									<DialogDescription>
										{t(
											"travelExpenses.adjustment.create.description",
											"You get a copy of the approved expenses to correct. Submitting it sends the whole corrected report for a fresh approval; only the difference to the approved amount is settled.",
										)}
									</DialogDescription>
								</DialogHeader>
								{open && (
									<CreateAdjustmentForm reportId={reportId} onCancel={() => setOpen(false)} />
								)}
							</DialogContent>
						</Dialog>
					</>
				)}
			</CardContent>
		</Card>
	);
}

function reasonError(t: Translate, value: string): string | undefined {
	if (!value.trim()) {
		return t("travelExpenses.adjustment.create.reasonRequired", "Explain what needs correcting.");
	}
	if (value.trim().length > ADJUSTMENT_REASON_MAX_LENGTH) {
		return t(
			"travelExpenses.adjustment.create.reasonTooLong",
			"Keep the reason under {max} characters.",
			{ max: ADJUSTMENT_REASON_MAX_LENGTH },
		);
	}
	return undefined;
}

function CreateAdjustmentForm({ reportId, onCancel }: { reportId: string; onCancel: () => void }) {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();
	const [failure, setFailure] = useState<string | null>(null);
	// One key per reason until answered: a retried request never creates a second adjustment.
	const attempt = useRef<{ reason: string; key: string } | null>(null);
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			setFailure(null);
			const reason = value.reason.trim();
			if (attempt.current?.reason !== reason) {
				attempt.current = { reason, key: crypto.randomUUID() };
			}
			const result = await createTravelExpenseAdjustmentAction({
				originalReportId: reportId,
				reason,
				idempotencyKey: attempt.current.key,
			});
			if (!result.success) {
				setFailure(
					t(
						"travelExpenses.adjustment.create.failed",
						"The adjustment could not be created. Please retry.",
					),
				);
				return;
			}
			const outcome = result.data;
			attempt.current = null;
			if (outcome.status === "created") {
				await queryClient.invalidateQueries({
					queryKey: queryKeys.travelExpenses.reportAdjustments(reportId),
				});
				router.push(`/travel-expenses/reports/${outcome.reportId}`);
				return;
			}
			setFailure(
				outcome.status === "ineligible"
					? t(
							"travelExpenses.adjustment.create.ineligible",
							"This report can no longer be adjusted. Reload the page to see its current state.",
						)
					: t(
							"travelExpenses.adjustment.create.failed",
							"The adjustment could not be created. Please retry.",
						),
			);
		},
	});

	return (
		<form
			className="space-y-4"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<form.Field
				name="reason"
				validators={{
					onSubmit: ({ value }) => reasonError(t, value),
					onChange: ({ value }) =>
						value.trim().length > ADJUSTMENT_REASON_MAX_LENGTH ? reasonError(t, value) : undefined,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)} required>
							{t("travelExpenses.adjustment.create.reason", "Reason for the correction")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Textarea
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								rows={3}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			{failure && (
				<Alert variant="destructive">
					<IconAlertTriangle aria-hidden="true" className="size-4" />
					<AlertDescription>{failure}</AlertDescription>
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
								<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
							) : (
								<IconAdjustmentsDollar className="mr-2 size-4" aria-hidden="true" />
							)}
							{t("travelExpenses.adjustment.create.confirm", "Create adjustment")}
						</Button>
					</DialogFooter>
				)}
			</form.Subscribe>
		</form>
	);
}

/**
 * Inside the reviewer's "adjustment required" notice (#614): how a correction
 * of an exported or reimbursed report reaches them instead of a reopen.
 */
export function AdjustmentRequiredHint() {
	const { t } = useTranslate();
	return (
		<p className="mt-1 text-sm">
			{t(
				"travelExpenses.adjustment.reviewerHint",
				"The employee creates the adjustment from this report; it comes back to you for a fresh review with its signed difference.",
			)}
		</p>
	);
}
