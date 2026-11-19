"use client";

import { IconArrowRight, IconClock } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useSyncExternalStore } from "react";
import { BreakInProgressNotice } from "@/components/time-tracking/break-in-progress-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLiveWorkNow } from "@/hooks/use-live-work-now";
import { useTimeSummaryClockSync } from "@/hooks/use-time-summary-clock-sync";
import { useElapsedTimer, useTimeClock } from "@/lib/query/use-time-clock";
import {
	summarizeTimeKpis,
	type TimeKpiRead,
} from "@/lib/time-tracking/time-kpis";
import {
	formatDuration,
	formatDurationWithSeconds,
} from "@/lib/time-tracking/time-utils";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";

type Clock = ReturnType<typeof useTimeClock>;

const subscribeToHydration = () => () => {};
const getHydratedSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

function useHasHydrated() {
	return useSyncExternalStore(
		subscribeToHydration,
		getHydratedSnapshot,
		getServerHydrationSnapshot,
	);
}

function DayTotal({ timeKpis }: { timeKpis: TimeKpiRead }) {
	const { t } = useTranslate();
	const now = useLiveWorkNow(timeKpis.basis.liveWork);
	const today = now
		? summarizeTimeKpis(timeKpis.basis, now).today
		: timeKpis.kpis.today;
	return (
		<div className="min-w-0 space-y-1">
			<p className="text-3xl font-semibold tabular-nums">
				{formatDuration(today.workedMinutes)}
			</p>
			<p className="text-sm text-muted-foreground">
				{today.requiredMinutes === null
					? t("timeTracking.summary.noRequiredToday", "No required time today")
					: t("dashboard.refresh.todayTarget", "Today · {target} required", {
							target: formatDuration(today.requiredMinutes),
						})}
			</p>
		</div>
	);
}

/** Read the same query as the header; the operational flow remains on time tracking. */
export function PersonalDay({
	timeKpis,
}: {
	timeKpis?: TimeKpiRead | null;
} = {}) {
	const { t } = useTranslate();
	const clock = useTimeClock();
	const hydrated = useHasHydrated();
	const matchesClock = useTimeSummaryClockSync(timeKpis);
	if (hydrated && !clock.isPending && !clock.isError && !clock.hasEmployee)
		return null;
	// The header can resolve the shared query before this streamed slot hydrates.
	const clockReady = hydrated && !clock.isPending && !clock.isError;
	return (
		<Card className="gap-4 py-5 shadow-none">
			<CardHeader className="px-5">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<CardTitle>
						<h2 className="flex items-center gap-2 text-base font-semibold">
							<IconClock
								className="size-4 shrink-0 text-blue-500"
								aria-hidden="true"
							/>
							{t("dashboard.refresh.personalDay", "Your working day")}
						</h2>
					</CardTitle>
					{clockReady ? <ClockStatus clock={clock} /> : null}
				</div>
			</CardHeader>
			<CardContent className="space-y-4 px-5">
				<div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-4">
					{timeKpis && (!hydrated || matchesClock) ? (
						<DayTotal timeKpis={timeKpis} />
					) : (
						<p role="status" className="text-sm text-muted-foreground">
							{timeKpis === null
								? t(
										"dashboard.refresh.dayUnavailable",
										"Today's total is unavailable. Refresh to try again.",
									)
								: t("common.loading", "Loading…")}
						</p>
					)}
					{clockReady && clock.isClockedIn ? (
						<SessionElapsed clock={clock} />
					) : null}
				</div>
				<ClockFeedback clock={clock} hydrated={hydrated} />
				{hydrated && clock.isOffline ? (
					<p className="text-sm text-muted-foreground">
						{t("common.offline", "Offline")}
					</p>
				) : null}
				<Button asChild className="w-full">
					<Link href="/time-tracking">
						{t("dashboard.refresh.openTimeTracking", "Go to time tracking")}
						<IconArrowRight className="size-4" aria-hidden="true" />
					</Link>
				</Button>
			</CardContent>
		</Card>
	);
}

function ClockStatus({ clock }: { clock: Clock }) {
	const { t } = useTranslate();
	const onBreak = Boolean(clock.activeWorkPeriod?.breakStartedAt);
	return (
		<p className="flex items-center gap-2 text-sm text-muted-foreground">
			<span
				aria-hidden="true"
				className={cn(
					"size-2 rounded-full",
					onBreak
						? "bg-amber-500"
						: clock.isClockedIn
							? "bg-emerald-500"
							: "bg-muted-foreground/50",
				)}
			/>
			{onBreak
				? t("timeTracking.onBreak", "On break")
				: clock.isClockedIn
					? t("timeTracking.clockedIn", "Clocked in")
					: t("timeTracking.notClockedIn", "Not clocked in")}
		</p>
	);
}

function SessionElapsed({ clock }: { clock: Clock }) {
	const { t } = useTranslate();
	const elapsed = useElapsedTimer(clock.activeWorkPeriod?.startTime ?? null);
	return (
		<div className="min-w-0 space-y-1">
			<p className="text-3xl font-semibold tabular-nums">
				{formatDurationWithSeconds(elapsed)}
			</p>
			<p className="text-sm text-muted-foreground">
				{t("dashboard.refresh.currentSession", "Current session")}
			</p>
		</div>
	);
}

function ClockFeedback({
	clock,
	hydrated,
}: {
	clock: Clock;
	hydrated: boolean;
}) {
	const { t } = useTranslate();
	if (!hydrated || clock.isPending) {
		return (
			<p role="status" className="text-sm text-muted-foreground">
				{t("common.loading", "Loading…")}
			</p>
		);
	}
	if (clock.isError) {
		return (
			<div role="status" className="space-y-2 text-sm">
				<p>
					{t(
						"timeTracking.statusUnavailable",
						"Clock status is unavailable. Refresh to try again.",
					)}
				</p>
				<Button
					variant="outline"
					size="sm"
					onClick={() => void clock.refetchStatus()}
				>
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	}
	return clock.activeWorkPeriod?.breakStartedAt ? (
		<BreakInProgressNotice
			since={clock.activeWorkPeriod.breakStartedAt}
			zone={clock.activeWorkPeriod.breakStartedZone ?? null}
		/>
	) : null;
}
