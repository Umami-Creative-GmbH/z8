"use client";

import {
	IconAlertCircle,
	IconArrowBackUp,
	IconChevronDown,
	IconCircleCheck,
	IconClock,
	IconLoader2,
	IconRefresh,
	IconSend,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { startTransition, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
	submitPeriod,
	withdrawPeriod,
} from "@/app/[locale]/(app)/time-tracking/actions/period-submissions";
import { useTimeFormat } from "@/components/providers/user-preferences-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	formatInstant,
	formatPlainDate,
	formatPlainDateRange,
} from "@/lib/datetime/temporal-format";
import {
	periodBlockerHref,
	periodSubmissionBlockerKey,
} from "@/lib/time-tracking/period-submissions/blocker-navigation";
import type { EmployeePeriodViewRow } from "@/lib/time-tracking/period-submissions/employee-period-view";
import type { PeriodSubmissionBlocker } from "@/lib/time-tracking/period-submissions/submission-blockers";
import type { PeriodSubmissionReadiness } from "@/lib/time-tracking/period-submissions/submission-readiness";
import type { PeriodSubmissionRefusal } from "@/lib/time-tracking/period-submissions/submission-service";
import {
	isPeriodSubmittable,
	type PeriodSubmissionViewStatus,
} from "@/lib/time-tracking/period-submissions/submission-status";
import { Link, useRouter } from "@/navigation";
import { announcePeriodBlockerArrival } from "./period-blocker-focus";
import {
	type PeriodReadinessScope,
	type PeriodReadinessState,
	periodReadinessState,
	usePeriodReadinessRecheck,
	usePeriodSubmissionReadiness,
} from "./use-period-submission-readiness";

const CHECKING: PeriodReadinessState = { kind: "checking" };

interface Props extends PeriodReadinessScope {
	/** The rows the page was rendered with; shown until the first readiness read answers. */
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
 * The employee's period view (#1059): their recent submission periods with each one's status.
 * Every displayed period is checked for submission readiness (#1348) as the card opens; Submit is
 * enabled only while the current check says the period is ready. A pending submission can be
 * withdrawn. A refusal is explained and readiness is checked again.
 *
 * Readiness stays current (#1350): after the employee's own changes, on return or focus, through
 * the view's Refresh, and every 30 seconds while visible. A background check keeps the last
 * successful result; a failed one disables Submit until a check succeeds.
 */
export function PeriodSubmissionsCard({ periods, organizationId, employeeId }: Props) {
	const { t } = useTranslate();
	const locale = useLocale();
	const timeFormat = useTimeFormat();
	const { refresh } = useRouter();
	const idPrefix = useId();
	const readinessQuery = usePeriodSubmissionReadiness({ organizationId, employeeId });
	const { rechecking, recheck } = usePeriodReadinessRecheck();
	const [submitting, setSubmitting] = useState<string | null>(null);
	const [refusal, setRefusal] = useState<{
		startDate: string;
		reason: PeriodSubmissionRefusal;
	} | null>(null);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
	const inFlight = useRef(false);
	// Row summaries and statuses are announced only when a later check changes them: the first
	// result fills every row at once and is not read out (#1302 review).
	const [announcing, setAnnouncing] = useState(false);
	useEffect(() => {
		if (readinessQuery.isSuccess) setAnnouncing(true);
	}, [readinessQuery.isSuccess]);
	const liveRegion = announcing ? "polite" : "off";

	// The rows of the latest successful read (statuses included), else the rendered ones.
	const rows: EmployeePeriodViewRow[] =
		readinessQuery.data === undefined ? periods : (readinessQuery.data?.periods ?? []);
	// Kept while a background check runs after a failure, so the alert is not announced again.
	const unavailable = readinessQuery.isError;

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

	// A blocker's work time in the period's own zone, never the viewer's.
	const at = (instant: string, timezone: string) =>
		formatInstant(parseInstant(instant), { locale, timezone, timeFormat }, "dateTimeMedium");
	const day = (date: string) => formatPlainDate(parsePlainDate(date), locale, "dateMedium");
	const days = (start: string, end: string) =>
		formatPlainDateRange(parsePlainDate(start), parsePlainDate(end), locale, "dateMedium");

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
					{ dates: days(blocker.startDate, blocker.endDate) },
				);
		}
	};

	/**
	 * What the employee can do about a blocker, or that an approver decides, and the label of the
	 * link to where that happens. The actions named are the ones those views offer today: cancelling
	 * a pending correction or absence in My Requests, clocking out at the clock. Manual work (and a
	 * pending policy clock-out) has no request view and no withdrawal, so only an approver acts; so
	 * too for a correction My Requests cannot show.
	 */
	const blockerNextAction = (blocker: PeriodSubmissionBlocker) => {
		switch (blocker.kind) {
			case "live_work":
				return {
					explanation: t(
						"timeTracking.periodSubmissions.blocker.liveWorkAction",
						"Clock out when this work ends.",
					),
					link: t("timeTracking.periodSubmissions.blocker.openClock", "Go to the clock"),
				};
			case "time_correction":
				if (!blocker.listedInMyRequests) {
					return {
						explanation: t(
							"timeTracking.periodSubmissions.blocker.timeCorrectionWaitAction",
							"An approver decides this correction. You can only wait for their decision.",
						),
						link: t("timeTracking.periodSubmissions.blocker.openTimeline", "Show on timeline"),
					};
				}
				return {
					explanation: t(
						"timeTracking.periodSubmissions.blocker.timeCorrectionAction",
						"An approver decides this correction. While it waits, you can cancel it in My Requests.",
					),
					link: t("timeTracking.periodSubmissions.blocker.openRequest", "Open request"),
				};
			case "manual_work":
				return {
					explanation: t(
						"timeTracking.periodSubmissions.blocker.manualWorkAction",
						"An approver decides this work. You don't need to do anything.",
					),
					link: t("timeTracking.periodSubmissions.blocker.openTimeline", "Show on timeline"),
				};
			case "absence_request":
				return {
					explanation: t(
						"timeTracking.periodSubmissions.blocker.absenceRequestAction",
						"An approver decides this absence. While it waits, you can cancel it in My Requests.",
					),
					link: t("timeTracking.periodSubmissions.blocker.openRequest", "Open request"),
				};
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
			case "write_gate_closed":
				return t(
					"timeTracking.periodSubmissions.refusal.writeGateClosed",
					"Period submissions are paused in your organization right now. Try again later, or ask an administrator.",
				);
			case "not_expected":
			case "not_employee":
				return t(
					"timeTracking.periodSubmissions.refusal.notExpected",
					"This period does not need to be submitted.",
				);
		}
	};

	/** What keeps an assessed period from being ready, one line per refusal, in submission's order. */
	const readinessLines = (readiness: PeriodSubmissionReadiness) =>
		readiness.refusals.flatMap((reason) => {
			switch (reason) {
				case "period_not_ended":
					return readiness.opensOn
						? [
								t(
									"timeTracking.periodSubmissions.readiness.opensOn",
									"Submitting opens on {date}.",
									{ date: day(readiness.opensOn) },
								),
							]
						: [];
				case "period_open":
					return [
						t(
							"timeTracking.periodSubmissions.readiness.openItems",
							"{count, plural, one {# item keeps this period open.} other {# items keep this period open.}}",
							{ count: readiness.blockers.length },
						),
					];
				// The period's status says it; a not expected period needs no submission.
				case "already_submitted":
				case "not_expected":
					return [];
				default:
					return [refusalMessage(reason)];
			}
		});

	function toggle(startDate: string) {
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(startDate)) next.delete(startDate);
			else next.add(startDate);
			return next;
		});
	}

	async function handleSubmit(startDate: string) {
		if (inFlight.current) return;
		inFlight.current = true;
		setSubmitting(startDate);
		setRefusal(null);
		// Promise#finally rather than try/finally: the React Compiler cannot
		// compile try statements without a catch clause.
		await submitPeriod({ periodStartDate: startDate })
			.then((result) => {
				if (!result.success) {
					toast.error(
						t("timeTracking.periodSubmissions.submitFailed", "The period could not be submitted"),
					);
					return;
				}
				if (result.data.kind === "refused") {
					// Submitting repeats every check: explain (the row's alert says it, so no toast
					// repeats it), show what blocks, and check again.
					setRefusal({ startDate, reason: result.data.reason });
					if (result.data.reason === "period_open") {
						setExpanded((current) => new Set(current).add(startDate));
					}
					return;
				}
				toast.success(
					t("timeTracking.periodSubmissions.submitted", "Period submitted for approval"),
				);
				startTransition(() => refresh());
			})
			.finally(() => {
				inFlight.current = false;
				setSubmitting(null);
				// The shown result predates this attempt: Submit checks until the new one arrives.
				void recheck();
			});
	}

	async function handleWithdraw(startDate: string) {
		if (inFlight.current) return;
		inFlight.current = true;
		setSubmitting(startDate);
		setRefusal(null);
		// Promise#finally rather than try/finally: the React Compiler cannot
		// compile try statements without a catch clause.
		await withdrawPeriod({ periodStartDate: startDate })
			.then((result) => {
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
			})
			.finally(() => {
				inFlight.current = false;
				setSubmitting(null);
				void recheck();
			});
	}

	function readinessSummary(state: PeriodReadinessState, status: PeriodSubmissionViewStatus) {
		if (state.kind !== "assessed" || !isPeriodSubmittable(status)) return null;
		const { readiness } = state;
		if (readiness.ready) {
			return (
				<span className="flex items-center gap-1.5 text-sm">
					<IconCircleCheck
						className="size-4 text-emerald-600 dark:text-emerald-400"
						aria-hidden="true"
					/>
					{t("timeTracking.periodSubmissions.readiness.ready", "Ready to submit")}
				</span>
			);
		}
		const lines = readinessLines(readiness);
		if (lines.length === 0) return null;
		const Icon = readiness.refusals[0] === "period_not_ended" ? IconClock : IconAlertCircle;
		return (
			<span className="flex items-start gap-1.5 text-sm text-muted-foreground">
				<Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
				<span className="flex flex-col">
					{lines.map((line) => (
						<span key={line}>{line}</span>
					))}
				</span>
			</span>
		);
	}

	/** Why Submit is disabled, when it is; null while it may be pressed. */
	function disabledReason(state: PeriodReadinessState): string | null {
		switch (state.kind) {
			case "checking":
				return t(
					"timeTracking.periodSubmissions.readiness.checking",
					"Checking whether this period is ready…",
				);
			case "unavailable":
				return t(
					"timeTracking.periodSubmissions.readiness.submitUnavailable",
					"Submit is unavailable until readiness can be checked.",
				);
			// A background check keeps the last successful result's Submit (#1350, decision 1).
			case "assessed":
				return state.readiness.ready
					? null
					: t(
							"timeTracking.periodSubmissions.readiness.notReady",
							"Submit is available once this period is ready.",
						);
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
			<CardContent className="flex flex-col gap-3">
				{unavailable ? (
					<div
						role="alert"
						className="flex flex-col gap-2 rounded-md border border-destructive/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
					>
						<span className="flex items-start gap-1.5">
							<IconAlertCircle
								className="mt-0.5 size-4 shrink-0 text-destructive"
								aria-hidden="true"
							/>
							{t(
								"timeTracking.periodSubmissions.readiness.unavailable",
								"Submission readiness is unavailable right now, so Submit is disabled.",
							)}
						</span>
						<Button
							size="sm"
							variant="outline"
							aria-busy={rechecking}
							onClick={() => {
								if (!rechecking) void recheck();
							}}
						>
							{rechecking ? (
								<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
							) : (
								<IconRefresh className="size-4" aria-hidden="true" />
							)}
							{t("timeTracking.periodSubmissions.readiness.retry", "Retry")}
						</Button>
					</div>
				) : null}
				<ul className="divide-y">
					{rows.map((period) => {
						const state = periodReadinessState(readinessQuery, period.startDate);
						// The shown result is known stale (own submit or withdraw, Retry): Submit
						// checks while the result stays visible until the new one replaces it.
						const submitState: PeriodReadinessState = rechecking ? CHECKING : state;
						const submittable =
							isPeriodSubmittable(period.status) &&
							!(state.kind === "assessed" && state.readiness.refusals.includes("not_expected"));
						const reason = disabledReason(submitState);
						const blockers = state.kind === "assessed" ? state.readiness.blockers : [];
						const isExpanded = expanded.has(period.startDate);
						const detailsId = `${idPrefix}-details-${period.startDate}`;
						const reasonId = `${idPrefix}-reason-${period.startDate}`;
						return (
							<li
								key={period.startDate}
								className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
							>
								<div className="flex flex-col gap-1">
									<span className="font-medium tabular-nums">
										{days(period.startDate, period.endDate)}
									</span>
									{period.status === "rejected" && period.rejectionReason ? (
										<span className="text-sm text-muted-foreground">
											{t("timeTracking.periodSubmissions.rejectionReason", "Reason: {reason}", {
												reason: period.rejectionReason,
											})}
										</span>
									) : null}
									<div aria-live={liveRegion}>{readinessSummary(state, period.status)}</div>
									{refusal?.startDate === period.startDate &&
									!(state.kind === "assessed" && state.readiness.ready) ? (
										<p role="alert" className="text-sm text-destructive">
											{refusalMessage(refusal.reason)}
										</p>
									) : null}
									{blockers.length > 0 ? (
										<div className="flex flex-col gap-1">
											<Button
												size="sm"
												variant="ghost"
												className="h-7 w-fit px-2"
												aria-expanded={isExpanded}
												aria-controls={detailsId}
												onClick={() => toggle(period.startDate)}
											>
												<IconChevronDown
													className={`size-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
													aria-hidden="true"
												/>
												{isExpanded
													? t(
															"timeTracking.periodSubmissions.readiness.hideDetails",
															"Hide details",
														)
													: t(
															"timeTracking.periodSubmissions.readiness.showDetails",
															"Show details",
														)}
											</Button>
											<ul
												id={detailsId}
												hidden={!isExpanded}
												className="flex list-disc flex-col gap-2 ps-5 text-sm"
											>
												{blockers.map((blocker) => {
													const key = periodSubmissionBlockerKey(blocker);
													const sourceId = `${detailsId}-${key}`;
													const next = blockerNextAction(blocker);
													return (
														<li key={key}>
															<span id={sourceId} data-blocker-source="">
																{blockerMessage(blocker)}
															</span>{" "}
															<span className="text-muted-foreground">{next.explanation}</span>{" "}
															<Link
																href={periodBlockerHref(blocker, period)}
																// The page it opens may be this one, at the same URL.
																onClick={() => announcePeriodBlockerArrival(key)}
																aria-describedby={sourceId}
																className="font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
															>
																{next.link}
															</Link>
														</li>
													);
												})}
											</ul>
										</div>
									) : null}
								</div>
								<div className="flex flex-col items-start gap-1 sm:items-end">
									<div className="flex items-center gap-3">
										{/* A status another person changed is announced once, when it changes. */}
										<span aria-live={liveRegion}>
											<Badge variant={STATUS_VARIANTS[period.status]}>
												{statusLabel(period.status)}
											</Badge>
										</span>
										{submittable ? (
											<Button
												size="sm"
												onClick={() => handleSubmit(period.startDate)}
												disabled={reason !== null || submitting !== null}
												aria-describedby={reason ? reasonId : undefined}
											>
												{submitState.kind === "checking" ? (
													<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
												) : (
													<IconSend className="size-4" aria-hidden="true" />
												)}
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
									{submittable && reason ? (
										<span id={reasonId} className="text-xs text-muted-foreground">
											{reason}
										</span>
									) : null}
								</div>
							</li>
						);
					})}
				</ul>
			</CardContent>
		</Card>
	);
}
