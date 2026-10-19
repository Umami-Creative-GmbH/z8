"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useTimeFormat } from "@/components/providers/user-preferences-provider";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	formatInstant,
	formatPlainDate,
	formatPlainDateRange,
} from "@/lib/datetime/temporal-format";
import type { PeriodSubmissionBlocker } from "@/lib/time-tracking/period-submissions/submission-blockers";
import type { PeriodSubmissionReadiness } from "@/lib/time-tracking/period-submissions/submission-readiness";
import type { PeriodSubmissionRefusal } from "@/lib/time-tracking/period-submissions/submission-service";
import type { PeriodSubmissionViewStatus } from "@/lib/time-tracking/period-submissions/submission-status";
import type { PeriodReadinessState } from "./use-period-submission-readiness";

/** The period view's copy (#1059, #1348): statuses, blockers, refusals and readiness. */
export function usePeriodSubmissionMessages() {
	const { t } = useTranslate();
	const locale = useLocale();
	const timeFormat = useTimeFormat();

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

	/** Why Submit is disabled, when it is; null while it may be pressed. */
	const disabledReason = (state: PeriodReadinessState): string | null => {
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
	};

	return {
		t,
		days,
		statusLabel,
		blockerMessage,
		blockerNextAction,
		refusalMessage,
		readinessLines,
		disabledReason,
	};
}

export type PeriodSubmissionMessages = ReturnType<typeof usePeriodSubmissionMessages>;
