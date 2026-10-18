"use client";

import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import {
	CLOCK_FOCUS_TARGET_ID,
	CLOCK_REGION_ID,
	parseTimeTrackingFocus,
	periodSubmissionBlockerKey,
	TIMELINE_REGION_ID,
	type TimeTrackingFocus,
	workPeriodFocusTargetId,
} from "@/lib/time-tracking/period-submissions/blocker-navigation";
import { ArrivalNotice, focusArrivalTarget } from "./arrival-focus";
import {
	type PeriodReadinessScope,
	usePeriodSubmissionReadiness,
} from "./use-period-submission-readiness";

interface Props extends PeriodReadinessScope {
	/** The `focus` query parameter of `/time-tracking`. */
	focus: string | undefined;
	/** How long to wait for the target once its region has rendered. */
	waitForTargetMs?: number;
}

const ARRIVAL_EVENT = "period-blocker-arrival";

/**
 * Says that a period blocker link with this focus value (`periodSubmissionBlockerKey`) was just
 * followed. Following a link to the page already shown changes no URL, so the focus on
 * `/time-tracking` would not otherwise notice it arrived again.
 */
export function announcePeriodBlockerArrival(key: string): void {
	window.dispatchEvent(new CustomEvent<string>(ARRIVAL_EVENT, { detail: key }));
}

/**
 * Focuses the work a period blocker link opened on `/time-tracking` (#1349): pending manual work's
 * (or a correction My Requests cannot show) timeline row, or the clock controls for live work.
 * Navigating never clocks out or acts on the work; it only moves focus.
 *
 * Readiness is checked again on arrival, and on every later arrival through the same link. When
 * that check no longer lists the blocker (decided, withdrawn, ended, or never the employee's), or
 * its target is not on the page once its region has rendered (another day, a region that failed),
 * a neutral notice says so instead. The link's identity only selects among what the page already
 * rendered for the signed-in employee.
 */
export function PeriodBlockerFocus({ focus, ...props }: Props) {
	const target = parseTimeTrackingFocus(focus);
	const targetKey = target?.key ?? null;
	const [arrivals, setArrivals] = useState(0);

	useEffect(() => {
		if (!targetKey) return;
		const onArrival = (event: Event) => {
			if ((event as CustomEvent<string>).detail === targetKey) setArrivals((count) => count + 1);
		};
		window.addEventListener(ARRIVAL_EVENT, onArrival);
		return () => window.removeEventListener(ARRIVAL_EVENT, onArrival);
	}, [targetKey]);

	if (!target) return null;
	// Each arrival is new: remount to check readiness again and move focus again.
	return <BlockerFocusArrival key={`${target.key}#${arrivals}`} target={target} {...props} />;
}

type Outcome = "focused" | "resolved" | "not_shown";

function BlockerFocusArrival({
	target,
	organizationId,
	employeeId,
	waitForTargetMs = 3000,
}: Omit<Props, "focus"> & { target: TimeTrackingFocus }) {
	const { t } = useTranslate();
	const readiness = usePeriodSubmissionReadiness({ organizationId, employeeId });
	const [outcome, setOutcome] = useState<Outcome | null>(null);

	// Settled: the check started on arrival has answered (after its retry, when it failed).
	const settled = readiness.isFetchedAfterMount && !readiness.isFetching;
	const stillBlocks = readiness.isError
		? null
		: (readiness.data?.periods.some((period) =>
				period.readiness.blockers.some(
					(blocker) => periodSubmissionBlockerKey(blocker) === target.key,
				),
			) ?? false);

	const live = target.kind === "live_work";
	const targetId = live ? CLOCK_FOCUS_TARGET_ID : workPeriodFocusTargetId(target.workPeriodId);
	const regionId = live ? CLOCK_REGION_ID : TIMELINE_REGION_ID;

	useEffect(() => {
		if (!settled || outcome !== null) return;
		if (stillBlocks === false) {
			setOutcome("resolved");
			return;
		}
		// The wait for the target starts once its region has streamed in, never before.
		let stopTarget = () => {};
		// The clock region is itself the clock target when it loaded.
		const stopRegion = whenElementAppears([regionId, targetId], null, () => {
			stopTarget = whenElementAppears([targetId], waitForTargetMs, (element) => {
				if (!element) {
					setOutcome("not_shown");
					return;
				}
				focusArrivalTarget(element);
				setOutcome("focused");
			});
		});
		return () => {
			stopRegion();
			stopTarget();
		};
	}, [settled, outcome, stillBlocks, targetId, regionId, waitForTargetMs]);

	if (outcome !== "resolved" && outcome !== "not_shown") return null;
	return (
		<div className="px-4 lg:px-6">
			<ArrivalNotice>
				{outcome === "resolved"
					? t(
							"timeTracking.periodSubmissions.focus.resolved",
							"This work no longer keeps a period open. Period readiness was checked again.",
						)
					: t(
							"timeTracking.periodSubmissions.focus.notShown",
							"This work can't be shown here. Period readiness was checked again.",
						)}
			</ArrivalNotice>
		</div>
	);
}

/**
 * Calls back with the first element with one of the ids once it is in the document, or with null
 * after `timeoutMs` (never, when null).
 */
function whenElementAppears(
	ids: string[],
	timeoutMs: number | null,
	callback: (element: HTMLElement | null) => void,
): () => void {
	const find = () =>
		ids.map((id) => document.getElementById(id)).find((element) => element !== null) ?? null;
	const existing = find();
	if (existing) {
		callback(existing);
		return () => {};
	}
	const observer = new MutationObserver(() => {
		const element = find();
		if (!element) return;
		stop();
		callback(element);
	});
	const timer =
		timeoutMs === null
			? null
			: window.setTimeout(() => {
					stop();
					callback(null);
				}, timeoutMs);
	function stop() {
		observer.disconnect();
		if (timer !== null) window.clearTimeout(timer);
	}
	observer.observe(document.body, { childList: true, subtree: true });
	return stop;
}
