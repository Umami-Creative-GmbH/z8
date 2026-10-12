"use client";

import { IconCalendar, IconCash, IconUserMinus } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import {
	departureCutoffDate,
	formatDepartureCutoff,
} from "@/lib/employee-lifecycle/cutoff-display";
import type {
	EmployeeOffboardingView,
	OffboardingWorkBalance,
} from "@/lib/employee-lifecycle/view-types";
import { cn } from "@/lib/utils";
import { formatSignedWorkBalance, getWorkBalanceStatus } from "@/lib/work-balance/format";
import { Link } from "@/navigation";
import { useOffboardingLabels } from "./labels";

export type DepartureCardProps = {
	view: EmployeeOffboardingView;
	onSchedule: () => void;
	onOffboardNow: () => void;
	onCancelDeparture: () => void;
	onRehire: () => void;
	/** Opens the final overtime payout form; offered only when the view carries one. */
	onRecordFinalPayout: () => void;
	isMutating: boolean;
	/** Follow-up list, rendered independently of the departure state. */
	followUpList: ReactNode;
};

/**
 * Lifecycle status and the actions the server offers the viewer. The
 * departure's state is shown on its own; follow-up progress never changes
 * whether the departure is effective.
 */
export function DepartureCard(props: DepartureCardProps) {
	const { t } = useTranslate();
	const labels = useOffboardingLabels();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() || "en";
	const { view } = props;
	const { capabilities, followUp } = view;

	return (
		<Card id="offboarding">
			<CardHeader>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<CardTitle className="flex items-center gap-2">
						<IconUserMinus className="size-5" aria-hidden="true" />
						{t("settings.employees.offboarding.title", "Employment and departure")}
					</CardTitle>
					<Badge
						variant={view.state === "active" ? "secondary" : "outline"}
						data-testid="departure-state"
					>
						{labels.state(view.state)}
					</Badge>
				</div>
				<CardDescription>
					<DepartureDescription view={view} locale={locale} />
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{view.state === "legacy_inactive" && (
					<p className="text-sm text-muted-foreground">
						{t("settings.employees.offboarding.unknownLegacyDate", "Date not recorded")}
					</p>
				)}

				<FollowUpSummary followUp={followUp} />
				<FutureWorkLinks view={view} />
				<DeputyCoverLink view={view} />
				{view.workBalance && (
					<WorkBalanceSummary
						employeeId={view.employeeId}
						workBalance={view.workBalance}
						locale={locale}
						onRecordFinalPayout={props.onRecordFinalPayout}
					/>
				)}

				<div className="flex flex-wrap gap-2">
					{capabilities.schedule && (
						<Button
							type="button"
							variant="outline"
							disabled={props.isMutating}
							onClick={props.onSchedule}
						>
							{view.state === "scheduled"
								? t("settings.employees.offboarding.editDeparture", "Edit departure")
								: t("settings.employees.offboarding.schedule", "Schedule departure")}
						</Button>
					)}
					{capabilities.cancel && (
						<Button
							type="button"
							variant="outline"
							disabled={props.isMutating}
							onClick={props.onCancelDeparture}
						>
							{t("settings.employees.offboarding.cancelDeparture", "Cancel departure")}
						</Button>
					)}
					{capabilities.offboardNow && (
						<Button
							type="button"
							variant="destructive"
							disabled={props.isMutating}
							onClick={props.onOffboardNow}
						>
							{t("settings.employees.offboarding.offboardNow", "Offboard now")}
						</Button>
					)}
					{capabilities.rehire && (
						<Button type="button" disabled={props.isMutating} onClick={props.onRehire}>
							{t("settings.employees.offboarding.rehire", "Rehire employee")}
						</Button>
					)}
					{view.state === "offboarded" && (
						<Button asChild variant="ghost">
							<Link href={`/calendar/${view.employeeId}`}>
								<IconCalendar className="mr-1 size-4" aria-hidden="true" />
								{t("settings.employees.offboarding.historicalCalendar", "View historical calendar")}
							</Link>
						</Button>
					)}
				</div>

				{props.followUpList}
			</CardContent>
		</Card>
	);
}

/** One sentence about the departure, with its cutoff in the frozen zone. */
function DepartureDescription({ view, locale }: { view: EmployeeOffboardingView; locale: string }) {
	const { t } = useTranslate();
	const labels = useOffboardingLabels();
	const { departure } = view;
	if (view.state === "blocked") return labels.blocked(departure?.blockedReason ?? null);
	if (view.state === "legacy_inactive") {
		return t(
			"settings.employees.offboarding.legacyInactive",
			"This employee is inactive. The departure date was not recorded.",
		);
	}
	if (!departure) return null;
	const cutoff = {
		cutoff: formatDepartureCutoff(departure.cutoff, departure.timezone, locale),
		timezone: departure.timezone,
	};
	if (view.state === "offboarded") {
		return t(
			"settings.employees.offboarding.effectiveDescription",
			"Access ended at {cutoff} ({timezone}).",
			cutoff,
		);
	}
	if (view.state !== "scheduled") return null;
	const scheduled = t(
		"settings.employees.offboarding.scheduledDescription",
		"Access and paid-seat usage end at {cutoff} ({timezone}).",
		cutoff,
	);
	return departure.lastWorkingDay
		? `${t("settings.employees.offboarding.lastWorkingDayValue", "Last working day: {date}.", {
				date: departure.lastWorkingDay,
			})} ${scheduled}`
		: scheduled;
}

/** Follow-up progress, independent of whether the departure is effective. */
function FollowUpSummary({ followUp }: { followUp: EmployeeOffboardingView["followUp"] }) {
	const { t } = useTranslate();
	const parts = [
		followUp.pending > 0
			? t("settings.employees.offboarding.followUpPending", "Follow-up work pending")
			: null,
		followUp.failed > 0
			? t("settings.employees.offboarding.followUpFailed", "{count} failed", {
					count: followUp.failed,
				})
			: null,
		followUp.openReviews > 0
			? t("settings.employees.offboarding.followUpReviews", "{count} to review", {
					count: followUp.openReviews,
				})
			: null,
	].filter((part): part is string => part !== null);
	if (parts.length === 0) return null;
	return (
		<p className="text-sm" role="status">
			{parts.join(" · ")}
		</p>
	);
}

/**
 * Other employees' absences this employee is deputy on (#1014): the departure
 * clears them, so the handover can arrange new cover beforehand. Links to
 * exactly those absences on the team absences page of the cutoff's year.
 */
function DeputyCoverLink({ view }: { view: EmployeeOffboardingView }) {
	const { t } = useTranslate();
	const { departure, deputyAbsences } = view;
	if (!departure || deputyAbsences <= 0) return null;
	const year = departureCutoffDate(departure.cutoff, departure.timezone).slice(0, 4);
	const href = `/team/absences?${new URLSearchParams({
		year,
		deputy: view.employeeId,
		coverAt: departure.cutoff,
	})}`;
	const title = t("settings.employees.offboarding.deputyCover.title", "Cover to rearrange");
	return (
		<div className="space-y-1 text-sm">
			<p className="font-medium">{title}</p>
			<ul aria-label={title} className="space-y-1">
				<li>
					<Link className="underline underline-offset-4" href={href}>
						{t(
							"settings.employees.offboarding.deputyCover.absences",
							"Deputy on running or upcoming absences: {count}",
							{ count: deputyAbsences },
						)}
					</Link>
				</li>
			</ul>
		</div>
	);
}

/**
 * The departing employee's work balance (#1002), with a final overtime payout
 * when the server offers one. Information only: it never blocks the departure.
 */
function WorkBalanceSummary({
	employeeId,
	workBalance,
	locale,
	onRecordFinalPayout,
}: {
	employeeId: string;
	workBalance: OffboardingWorkBalance;
	locale: string;
	onRecordFinalPayout: () => void;
}) {
	const { t } = useTranslate();
	const { balance, finalPayout } = workBalance;
	const status = balance ? getWorkBalanceStatus(balance.balanceMinutes) : "neutral";
	const headingId = `offboarding-work-balance-${employeeId}`;
	return (
		<section aria-labelledby={headingId} className="space-y-1 text-sm">
			<p id={headingId} className="font-medium">
				{t("settings.employees.offboarding.workBalance.title", "Work balance")}
			</p>
			<p
				className={cn(
					"font-semibold text-lg tabular-nums",
					status === "positive" && "text-emerald-600 dark:text-emerald-400",
					status === "negative" && "text-destructive",
				)}
			>
				{balance
					? formatSignedWorkBalance(balance.balanceMinutes)
					: t("workBalance.notCalculated", "Not calculated yet")}
			</p>
			{balance && (
				<p className="text-muted-foreground text-xs">
					{t("settings.employees.offboarding.workBalance.through", "Through {date}", {
						date: formatPlainDate(
							parsePlainDate(balance.computedThroughDate),
							locale,
							"dateMedium",
						),
					})}
				</p>
			)}
			{finalPayout && (
				<Button type="button" variant="outline" size="sm" onClick={onRecordFinalPayout}>
					<IconCash className="size-4" aria-hidden="true" />
					{t(
						"settings.employees.offboarding.workBalance.recordFinalPayout",
						"Record final overtime payout",
					)}
				</Button>
			)}
		</section>
	);
}

/**
 * Work dated on or after the cutoff is kept, never deleted; each kind links to
 * the page that already manages it.
 */
function FutureWorkLinks({ view }: { view: EmployeeOffboardingView }) {
	const { t } = useTranslate();
	const { departure, futureWork } = view;
	if (!departure) return null;
	const cutoffDate = departureCutoffDate(departure.cutoff, departure.timezone);
	const links = [
		futureWork.shifts > 0 && {
			key: "shifts",
			href: `/scheduling?employeeId=${view.employeeId}&date=${cutoffDate}`,
			label: t(
				"settings.employees.offboarding.futureWork.shifts",
				"Shifts on or after the cutoff: {count}",
				{ count: futureWork.shifts },
			),
		},
		futureWork.absences > 0 && {
			key: "absences",
			href: `/calendar/${view.employeeId}?date=${cutoffDate}`,
			label: t(
				"settings.employees.offboarding.futureWork.absences",
				"Absences on or after the cutoff: {count}",
				{ count: futureWork.absences },
			),
		},
		futureWork.employmentTerms > 0 && {
			key: "terms",
			href: "#employment-history",
			label: t(
				"settings.employees.offboarding.futureWork.employmentTerms",
				"Employment terms starting after the cutoff: {count}",
				{ count: futureWork.employmentTerms },
			),
		},
	].filter((link): link is { key: string; href: string; label: string } => Boolean(link));
	if (links.length === 0) return null;
	const title = t("settings.employees.offboarding.futureWork.title", "Kept after the departure");
	return (
		<div className="space-y-1 text-sm">
			<p className="font-medium">{title}</p>
			<ul aria-label={title} className="space-y-1">
				{links.map((link) => (
					<li key={link.key}>
						{link.href.startsWith("#") ? (
							<a className="underline underline-offset-4" href={link.href}>
								{link.label}
							</a>
						) : (
							<Link className="underline underline-offset-4" href={link.href}>
								{link.label}
							</Link>
						)}
					</li>
				))}
			</ul>
		</div>
	);
}
