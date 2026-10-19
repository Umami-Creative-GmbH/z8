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
import { startTransition, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
	submitPeriod,
	withdrawPeriod,
} from "@/app/[locale]/(app)/time-tracking/actions/period-submissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	periodBlockerHref,
	periodSubmissionBlockerKey,
} from "@/lib/time-tracking/period-submissions/blocker-navigation";
import type { EmployeePeriodViewRow } from "@/lib/time-tracking/period-submissions/employee-period-view";
import type { PeriodSubmissionBlocker } from "@/lib/time-tracking/period-submissions/submission-blockers";
import type { PeriodSubmissionRefusal } from "@/lib/time-tracking/period-submissions/submission-service";
import {
	isPeriodSubmittable,
	type PeriodSubmissionViewStatus,
} from "@/lib/time-tracking/period-submissions/submission-status";
import { Link, useRouter } from "@/navigation";
import { announcePeriodBlockerArrival } from "./period-blocker-arrival";
import {
	type PeriodSubmissionMessages,
	usePeriodSubmissionMessages,
} from "./period-submission-messages";
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

type Refusal = { startDate: string; reason: PeriodSubmissionRefusal };

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
	const messages = usePeriodSubmissionMessages();
	const { t } = messages;
	const { refresh } = useRouter();
	const idPrefix = useId();
	const readinessQuery = usePeriodSubmissionReadiness({ organizationId, employeeId });
	const { rechecking, recheck } = usePeriodReadinessRecheck();
	const [submitting, setSubmitting] = useState<string | null>(null);
	const [refusal, setRefusal] = useState<Refusal | null>(null);
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
					<ReadinessUnavailableAlert rechecking={rechecking} recheck={recheck} t={t} />
				) : null}
				<ul className="divide-y">
					{rows.map((period) => {
						const state = periodReadinessState(readinessQuery, period.startDate);
						return (
							<PeriodRow
								key={period.startDate}
								period={period}
								state={state}
								// The shown result is known stale (own submit or withdraw, Retry): Submit
								// checks while the result stays visible until the new one replaces it.
								submitState={rechecking ? CHECKING : state}
								idPrefix={idPrefix}
								liveRegion={liveRegion}
								refusal={refusal?.startDate === period.startDate ? refusal.reason : null}
								isExpanded={expanded.has(period.startDate)}
								onToggle={() => toggle(period.startDate)}
								busy={submitting !== null}
								onSubmit={() => handleSubmit(period.startDate)}
								onWithdraw={() => handleWithdraw(period.startDate)}
								messages={messages}
							/>
						);
					})}
				</ul>
			</CardContent>
		</Card>
	);
}

function ReadinessUnavailableAlert({
	rechecking,
	recheck,
	t,
}: {
	rechecking: boolean;
	recheck: () => Promise<void>;
	t: PeriodSubmissionMessages["t"];
}) {
	return (
		<div
			role="alert"
			className="flex flex-col gap-2 rounded-md border border-destructive/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
		>
			<span className="flex items-start gap-1.5">
				<IconAlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
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
	);
}

type PeriodRowProps = {
	period: EmployeePeriodViewRow;
	state: PeriodReadinessState;
	submitState: PeriodReadinessState;
	idPrefix: string;
	liveRegion: "polite" | "off";
	/** The refusal of this period's last submit, if any. */
	refusal: PeriodSubmissionRefusal | null;
	isExpanded: boolean;
	onToggle: () => void;
	/** A submit or withdraw is in flight for any period. */
	busy: boolean;
	onSubmit: () => void;
	onWithdraw: () => void;
	messages: PeriodSubmissionMessages;
};

function PeriodRow(props: PeriodRowProps) {
	const { period, state } = props;
	const submittable =
		isPeriodSubmittable(period.status) &&
		!(state.kind === "assessed" && state.readiness.refusals.includes("not_expected"));
	return (
		<li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
			<PeriodRowSummary {...props} />
			<PeriodRowActions {...props} submittable={submittable} />
		</li>
	);
}

/** The period's dates, rejection reason, readiness, refusal and blockers. */
function PeriodRowSummary({
	period,
	state,
	idPrefix,
	liveRegion,
	refusal,
	isExpanded,
	onToggle,
	messages,
}: PeriodRowProps) {
	const { t, days, refusalMessage } = messages;
	const blockers = state.kind === "assessed" ? state.readiness.blockers : [];
	const ready = state.kind === "assessed" && state.readiness.ready;
	return (
		<div className="flex flex-col gap-1">
			<span className="font-medium tabular-nums">{days(period.startDate, period.endDate)}</span>
			{period.status === "rejected" && period.rejectionReason ? (
				<span className="text-sm text-muted-foreground">
					{t("timeTracking.periodSubmissions.rejectionReason", "Reason: {reason}", {
						reason: period.rejectionReason,
					})}
				</span>
			) : null}
			<div aria-live={liveRegion}>
				<ReadinessSummary state={state} status={period.status} messages={messages} />
			</div>
			{refusal !== null && !ready ? (
				<p role="alert" className="text-sm text-destructive">
					{refusalMessage(refusal)}
				</p>
			) : null}
			{blockers.length > 0 ? (
				<BlockerDetails
					period={period}
					blockers={blockers}
					detailsId={`${idPrefix}-details-${period.startDate}`}
					isExpanded={isExpanded}
					onToggle={onToggle}
					messages={messages}
				/>
			) : null}
		</div>
	);
}

/** The period's status, its Submit or Withdraw, and why Submit is disabled. */
function PeriodRowActions({
	period,
	submitState,
	idPrefix,
	liveRegion,
	busy,
	onSubmit,
	onWithdraw,
	messages,
	submittable,
}: PeriodRowProps & { submittable: boolean }) {
	const { t, statusLabel, disabledReason } = messages;
	const reason = disabledReason(submitState);
	const reasonId = `${idPrefix}-reason-${period.startDate}`;
	return (
		<div className="flex flex-col items-start gap-1 sm:items-end">
			<div className="flex items-center gap-3">
				{/* A status another person changed is announced once, when it changes. */}
				<span aria-live={liveRegion}>
					<Badge variant={STATUS_VARIANTS[period.status]}>{statusLabel(period.status)}</Badge>
				</span>
				{submittable ? (
					<Button
						size="sm"
						onClick={onSubmit}
						disabled={reason !== null || busy}
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
					<Button size="sm" variant="outline" onClick={onWithdraw} disabled={busy}>
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
	);
}

function ReadinessSummary({
	state,
	status,
	messages,
}: {
	state: PeriodReadinessState;
	status: PeriodSubmissionViewStatus;
	messages: PeriodSubmissionMessages;
}) {
	const { t, readinessLines } = messages;
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

function BlockerDetails({
	period,
	blockers,
	detailsId,
	isExpanded,
	onToggle,
	messages,
}: {
	period: EmployeePeriodViewRow;
	blockers: PeriodSubmissionBlocker[];
	detailsId: string;
	isExpanded: boolean;
	onToggle: () => void;
	messages: PeriodSubmissionMessages;
}) {
	const { t, blockerMessage, blockerNextAction } = messages;
	return (
		<div className="flex flex-col gap-1">
			<Button
				size="sm"
				variant="ghost"
				className="h-7 w-fit px-2"
				aria-expanded={isExpanded}
				aria-controls={detailsId}
				onClick={onToggle}
			>
				<IconChevronDown
					className={`size-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
					aria-hidden="true"
				/>
				{isExpanded
					? t("timeTracking.periodSubmissions.readiness.hideDetails", "Hide details")
					: t("timeTracking.periodSubmissions.readiness.showDetails", "Show details")}
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
	);
}
