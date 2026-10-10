"use client";

import { IconArrowBackUp, IconSend } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { startTransition, useRef, useState } from "react";
import { toast } from "sonner";
import {
	submitPeriod,
	withdrawPeriod,
} from "@/app/[locale]/(app)/time-tracking/actions/period-submissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { EmployeePeriodViewRow } from "@/lib/time-tracking/period-submissions/employee-period-view";
import type { PeriodSubmissionBlocker } from "@/lib/time-tracking/period-submissions/submission-blockers";
import type { PeriodSubmissionRefusal } from "@/lib/time-tracking/period-submissions/submission-service";
import type { PeriodSubmissionViewStatus } from "@/lib/time-tracking/period-submissions/submission-status";
import { formatPlainDate, formatPlainDateRange } from "@/lib/travel-expenses/format";
import { useRouter } from "@/navigation";

interface Props {
	periods: EmployeePeriodViewRow[];
}

const STATUS_VARIANTS: Record<
	PeriodSubmissionViewStatus,
	"default" | "secondary" | "destructive" | "outline"
> = {
	awaiting_submission: "outline",
	submitted: "secondary",
	approved: "default",
	rejected: "destructive",
	sent_back_after_change: "destructive",
};

/**
 * The employee's period view (#1059): their recent submission periods with each one's status,
 * and Submit from the period's last day onward. A pending submission can be withdrawn; a refusal
 * of an open period lists what keeps it open (#1060).
 */
export function PeriodSubmissionsCard({ periods }: Props) {
	const { t } = useTranslate();
	const locale = useLocale();
	const { refresh } = useRouter();
	const [submitting, setSubmitting] = useState<string | null>(null);
	const [openPeriod, setOpenPeriod] = useState<{
		startDate: string;
		blockers: PeriodSubmissionBlocker[];
	} | null>(null);
	const inFlight = useRef(false);

	const statusLabel = (status: PeriodSubmissionViewStatus) => {
		switch (status) {
			case "awaiting_submission":
				return t("timeTracking.periodSubmissions.status.awaiting", "Awaiting submission");
			case "submitted":
				return t("timeTracking.periodSubmissions.status.submitted", "Submitted");
			case "approved":
				return t("timeTracking.periodSubmissions.status.approved", "Approved");
			case "rejected":
				return t("timeTracking.periodSubmissions.status.rejected", "Rejected");
			case "sent_back_after_change":
				return t("timeTracking.periodSubmissions.status.sentBack", "Sent back after a change");
		}
	};

	const at = (instant: string, timeZone: string) =>
		new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(
			new Date(instant),
		);

	const blockerMessage = (blocker: PeriodSubmissionBlocker) => {
		switch (blocker.kind) {
			case "live_work":
				return t(
					"timeTracking.periodSubmissions.blocker.liveWork",
					"Work started {start} is still running.",
					{ start: at(blocker.startTime, blocker.timezone) },
				);
			case "time_correction":
				return t(
					"timeTracking.periodSubmissions.blocker.timeCorrection",
					"A time correction for work on {start} is undecided.",
					{ start: at(blocker.startTime, blocker.timezone) },
				);
			case "manual_work":
				return t(
					"timeTracking.periodSubmissions.blocker.manualWork",
					"Manual work on {start} is undecided.",
					{ start: at(blocker.startTime, blocker.timezone) },
				);
			case "absence_request":
				return t(
					"timeTracking.periodSubmissions.blocker.absenceRequest",
					"An absence request for {dates} is undecided.",
					{
						dates:
							blocker.startDate === blocker.endDate
								? formatPlainDate(locale, blocker.startDate)
								: formatPlainDateRange(locale, blocker.startDate, blocker.endDate),
					},
				);
		}
	};

	const refusalMessage = (reason: PeriodSubmissionRefusal) => {
		switch (reason) {
			case "period_open":
				return t("timeTracking.periodSubmissions.refusal.periodOpen", "This period is still open");
			case "period_not_ended":
				return t(
					"timeTracking.periodSubmissions.refusal.notEnded",
					"You can submit this period from its last day onward.",
				);
			case "already_submitted":
				return t(
					"timeTracking.periodSubmissions.refusal.alreadySubmitted",
					"This period has already been submitted.",
				);
			case "no_approver":
				return t(
					"timeTracking.periodSubmissions.refusal.noApprover",
					"No one can approve this period yet. Ask an administrator to assign you a manager.",
				);
			case "not_expected":
			case "not_employee":
				return t(
					"timeTracking.periodSubmissions.refusal.notExpected",
					"This period does not need to be submitted.",
				);
		}
	};

	async function handleSubmit(startDate: string) {
		if (inFlight.current) return;
		inFlight.current = true;
		setSubmitting(startDate);
		setOpenPeriod(null);
		try {
			const result = await submitPeriod({ periodStartDate: startDate });
			if (!result.success) {
				toast.error(
					t("timeTracking.periodSubmissions.submitFailed", "The period could not be submitted"),
				);
				return;
			}
			if (result.data.kind === "refused") {
				if (result.data.reason === "period_open") {
					setOpenPeriod({ startDate, blockers: result.data.blockers });
				}
				toast.error(refusalMessage(result.data.reason));
				return;
			}
			toast.success(t("timeTracking.periodSubmissions.submitted", "Period submitted for approval"));
			startTransition(() => refresh());
		} finally {
			inFlight.current = false;
			setSubmitting(null);
		}
	}

	async function handleWithdraw(startDate: string) {
		if (inFlight.current) return;
		inFlight.current = true;
		setSubmitting(startDate);
		try {
			const result = await withdrawPeriod({ periodStartDate: startDate });
			if (!result.success) {
				toast.error(
					t(
						"timeTracking.periodSubmissions.withdrawFailed",
						"The submission could not be withdrawn",
					),
				);
				return;
			}
			if (result.data.kind === "refused") {
				toast.error(
					t(
						"timeTracking.periodSubmissions.withdrawRefused",
						"This submission was already decided and can no longer be withdrawn.",
					),
				);
			} else {
				toast.success(t("timeTracking.periodSubmissions.withdrawn", "Submission withdrawn"));
			}
			startTransition(() => refresh());
		} finally {
			inFlight.current = false;
			setSubmitting(null);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("timeTracking.periodSubmissions.title", "Period submissions")}</CardTitle>
				<CardDescription>
					{t(
						"timeTracking.periodSubmissions.description",
						"Confirm that your work and absences for each period are complete and correct.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ul className="divide-y">
					{periods.map((period) => (
						<li
							key={period.startDate}
							className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
						>
							<div className="flex flex-col gap-1">
								<span className="font-medium tabular-nums">
									{period.startDate === period.endDate
										? formatPlainDate(locale, period.startDate)
										: formatPlainDateRange(locale, period.startDate, period.endDate)}
								</span>
								{period.status === "rejected" && period.rejectionReason ? (
									<span className="text-sm text-muted-foreground">
										{t("timeTracking.periodSubmissions.rejectionReason", "Reason: {reason}", {
											reason: period.rejectionReason,
										})}
									</span>
								) : null}
								{!period.canSubmit &&
								(period.status === "awaiting_submission" ||
									period.status === "sent_back_after_change") ? (
									<span className="text-sm text-muted-foreground">
										{t("timeTracking.periodSubmissions.opensOn", "You can submit from {date}.", {
											date: formatPlainDate(locale, period.opensOn),
										})}
									</span>
								) : null}
								{openPeriod?.startDate === period.startDate ? (
									<div role="alert" className="text-sm text-destructive">
										<p className="font-medium">
											{t(
												"timeTracking.periodSubmissions.refusal.periodOpen",
												"This period is still open",
											)}
										</p>
										<ul className="list-disc ps-5">
											{openPeriod.blockers.map((blocker) => (
												<li
													key={
														blocker.kind === "absence_request"
															? `absence:${blocker.absenceId}`
															: `${blocker.kind}:${blocker.workPeriodId}`
													}
												>
													{blockerMessage(blocker)}
												</li>
											))}
										</ul>
									</div>
								) : null}
							</div>
							<div className="flex items-center gap-3">
								<Badge variant={STATUS_VARIANTS[period.status]}>{statusLabel(period.status)}</Badge>
								{period.canSubmit ? (
									<Button
										size="sm"
										onClick={() => handleSubmit(period.startDate)}
										disabled={submitting !== null}
									>
										<IconSend className="size-4" aria-hidden="true" />
										{t("timeTracking.periodSubmissions.submit", "Submit")}
									</Button>
								) : null}
								{period.status === "submitted" ? (
									<Button
										size="sm"
										variant="outline"
										onClick={() => handleWithdraw(period.startDate)}
										disabled={submitting !== null}
									>
										<IconArrowBackUp className="size-4" aria-hidden="true" />
										{t("timeTracking.periodSubmissions.withdraw", "Withdraw")}
									</Button>
								) : null}
							</div>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
