"use client";

import {
	IconAlertTriangle,
	IconArrowBackUp,
	IconInfoCircle,
	IconLoader2,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
	getTravelExpenseReportReopenState,
	reopenTravelExpenseReportAction,
} from "@/app/[locale]/(app)/travel-expenses/report-reopen-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import type { TravelExpenseReportReopenState } from "@/lib/approvals/server/travel-expense-report-reopen";
import { queryKeys } from "@/lib/query/keys";
import type { SubmittedReportView } from "@/lib/travel-expenses/report-read";
import { REOPEN_REASON_MAX_LENGTH } from "@/lib/travel-expenses/report-reopen";
import { formatRecordedInstant } from "./report-status";

type Translate = ReturnType<typeof useTranslate>["t"];

/** Why and by whom an approved submission was reopened for correction (#614). */
export function ReopenedNotice({
	reopened,
}: {
	reopened: NonNullable<SubmittedReportView["reopened"]>;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<Alert className="border-amber-500/50 bg-amber-50/60 dark:border-amber-400/40 dark:bg-amber-950/20">
			<IconArrowBackUp aria-hidden="true" className="size-4" />
			<AlertTitle>
				{t(
					"travelExpenses.report.reopen.reopenedBy",
					"Reopened for correction by {name} on {date}",
					{
						name: reopened.actorName ?? "—",
						date: formatRecordedInstant(locale, reopened.reopenedAt),
					},
				)}
			</AlertTitle>
			<AlertDescription>
				<p className="whitespace-pre-line">{reopened.reason}</p>
			</AlertDescription>
		</Alert>
	);
}

function adjustmentText(
	t: Translate,
	reason: Extract<TravelExpenseReportReopenState, { status: "adjustment_required" }>["reason"],
): string {
	return reason === "reimbursed"
		? t(
				"travelExpenses.report.reopen.reimbursed",
				"A reimbursement was already recorded for this report, so it can no longer be reopened. Corrections need a linked adjustment.",
			)
		: t(
				"travelExpenses.report.reopen.exported",
				"This report was already exported to accounting, so it can no longer be reopened. Corrections need a linked adjustment.",
			);
}

/**
 * Lets an authorized approver reopen an approved report that was neither
 * exported nor reimbursed (#614). Once it was, the panel explains that a
 * linked adjustment is needed instead; #615 mounts its adjustment action here.
 */
export function ReopenReportPanel({ reportId }: { reportId: string }) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	const { data } = useQuery({
		queryKey: queryKeys.travelExpenses.reportReopen(reportId),
		queryFn: async (): Promise<TravelExpenseReportReopenState> => {
			const result = await getTravelExpenseReportReopenState(reportId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	if (!data || data.status === "unavailable") return null;
	if (data.status === "adjustment_required") {
		return (
			<Alert>
				<IconInfoCircle aria-hidden="true" className="size-4" />
				<AlertDescription>{adjustmentText(t, data.reason)}</AlertDescription>
			</Alert>
		);
	}
	return (
		<div className="flex flex-wrap items-center gap-2">
			<Button type="button" variant="outline" onClick={() => setOpen(true)}>
				<IconArrowBackUp aria-hidden="true" className="mr-2 size-4" />
				{t("travelExpenses.report.reopen.action", "Reopen for correction")}
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>
							{t("travelExpenses.report.reopen.title", "Reopen this approved report?")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"travelExpenses.report.reopen.description",
								"The employee can correct the report and must submit it again for a fresh approval. Until then it is not payable or exportable. The approved submission stays in its history.",
							)}
						</DialogDescription>
					</DialogHeader>
					{open && (
						<ReopenForm
							reportId={reportId}
							submissionCycle={data.submissionCycle}
							onCancel={() => setOpen(false)}
							onDone={() => setOpen(false)}
						/>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}

function reasonError(t: Translate, value: string): string | undefined {
	if (!value.trim()) {
		return t("travelExpenses.report.reopen.reasonRequired", "Tell the employee what to correct.");
	}
	if (value.trim().length > REOPEN_REASON_MAX_LENGTH) {
		return t(
			"travelExpenses.report.reopen.reasonTooLong",
			"Keep the reason under {max} characters.",
			{ max: REOPEN_REASON_MAX_LENGTH },
		);
	}
	return undefined;
}

function ReopenForm({
	reportId,
	submissionCycle,
	onCancel,
	onDone,
}: {
	reportId: string;
	submissionCycle: number;
	onCancel: () => void;
	onDone: () => void;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [failure, setFailure] = useState<string | null>(null);
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			setFailure(null);
			const result = await reopenTravelExpenseReportAction({
				reportId,
				submissionCycle,
				reason: value.reason,
			});
			if (!result.success) {
				setFailure(result.error);
				return;
			}
			switch (result.data.status) {
				case "reopened":
					toast.success(t("travelExpenses.report.reopen.done", "Report reopened for correction"));
					break;
				case "adjustment_required":
					toast.error(adjustmentText(t, result.data.reason));
					break;
				default:
					toast.error(
						t(
							"travelExpenses.report.reopen.changed",
							"The report changed meanwhile and was not reopened. Review it again.",
						),
					);
			}
			await queryClient.invalidateQueries({
				queryKey: queryKeys.travelExpenses.report(reportId),
			});
			onDone();
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
						value.trim().length > REOPEN_REASON_MAX_LENGTH ? reasonError(t, value) : undefined,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)} required>
							{t("travelExpenses.report.reopen.reason", "Reason for the employee")}
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
								<IconArrowBackUp className="mr-2 size-4" aria-hidden="true" />
							)}
							{t("travelExpenses.report.reopen.confirm", "Reopen report")}
						</Button>
					</DialogFooter>
				)}
			</form.Subscribe>
		</form>
	);
}
