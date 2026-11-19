"use client";

import {
	IconAlertTriangle,
	IconArrowBackUp,
	IconInfoCircle,
	IconLoader2,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
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
import { TravelExpenseLoadError } from "../travel-expense-load-error";
import { formatRecordedInstant } from "./format";
import { AdjustmentRequiredHint } from "./report-adjustments";
import { useReportLifecycleRefresh, useReportQueryKey } from "./report-read-scope";
import { useReportTask } from "./use-report-task";

const reopenSubmission = { task: null as { arrival: object; scope: string } | null };

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
	const { data, isError, isFetching, refetch } = useQuery({
		queryKey: useReportQueryKey(queryKeys.travelExpenses.reportReopen(reportId)),
		queryFn: async (): Promise<TravelExpenseReportReopenState> => {
			const result = await getTravelExpenseReportReopenState(reportId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	if (isError)
		return (
			<TravelExpenseLoadError
				message={t(
					"travelExpenses.report.errors.loadSubmission",
					"Unable to load the submitted report. Please retry.",
				)}
				retry={() => void refetch()}
				isRetrying={isFetching}
			/>
		);
	if (!data || data.status === "unavailable") return null;
	if (data.status === "adjustment_required") {
		return (
			<Alert>
				<IconInfoCircle aria-hidden="true" className="size-4" />
				<AlertDescription>
					{adjustmentText(t, data.reason)}
					<AdjustmentRequiredHint />
				</AlertDescription>
			</Alert>
		);
	}
	return (
		<ReopenReportControl
			key={`${reportId}:${data.submissionCycle}`}
			reportId={reportId}
			submissionCycle={data.submissionCycle}
		/>
	);
}

function ReopenReportControl({
	reportId,
	submissionCycle,
}: {
	reportId: string;
	submissionCycle: number;
}) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [reopened, setReopened] = useState(false);
	if (reopened) return null;
	return (
		<div className="flex flex-wrap items-center gap-2">
			<Button type="button" variant="outline" onClick={() => setOpen(true)}>
				<IconArrowBackUp aria-hidden="true" className="mr-2 size-4" />
				{t("travelExpenses.report.reopen.action", "Reopen for correction")}
			</Button>
			<Dialog
				open={open}
				onOpenChange={(next) => {
					if (!pending) setOpen(next);
				}}
			>
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
							submissionCycle={submissionCycle}
							onClose={() => setOpen(false)}
							onReopened={() => setReopened(true)}
							onPendingChange={setPending}
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
	onClose,
	onReopened,
	onPendingChange,
}: {
	reportId: string;
	submissionCycle: number;
	onClose: () => void;
	onReopened: () => void;
	onPendingChange: (pending: boolean) => void;
}) {
	const { t } = useTranslate();
	const refreshLifecycle = useReportLifecycleRefresh(reportId);
	const [failure, setFailure] = useState<string | null>(null);
	const task = useReportTask(`${reportId}:${submissionCycle}`);
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmitMeta: reopenSubmission,
		onSubmit: async ({ value, meta }) => {
			if (!meta.task || !task.isCurrent(meta.task)) return;
			setFailure(null);
			const result = await reopenTravelExpenseReportAction({
				reportId,
				submissionCycle,
				reason: value.reason,
			}).catch(() => null);
			if (result?.success && result.data.status === "reopened") {
				if (task.isCurrent(meta.task)) {
					toast.success(t("travelExpenses.report.reopen.done", "Report reopened for correction"));
				}
				onReopened();
				await refreshLifecycle();
				return;
			}
			if (!task.isCurrent(meta.task)) return;
			if (!result?.success) {
				// Server errors are English diagnostics; the reviewer sees a translated outcome.
				setFailure(
					t(
						"travelExpenses.report.reopen.failed",
						"The report could not be reopened. It may have changed, or you may no longer have access. Reload it and try again.",
					),
				);
				return;
			}
			toast.error(
				result.data.status === "adjustment_required"
					? adjustmentText(t, result.data.reason)
					: t(
							"travelExpenses.report.reopen.changed",
							"The report changed meanwhile and was not reopened. Review it again.",
						),
			);
			await refreshLifecycle();
			if (task.isCurrent(meta.task)) onClose();
		},
	});

	return (
		<form
			className="space-y-4"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				const activation = task.reserve();
				if (!activation) return;
				onPendingChange(true);
				void form.handleSubmit({ task: activation }).finally(() => {
					task.release(activation);
					onPendingChange(false);
				});
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
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							disabled={isSubmitting || task.working}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting || task.working}>
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
