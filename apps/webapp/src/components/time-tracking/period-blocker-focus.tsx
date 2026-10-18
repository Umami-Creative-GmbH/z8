"use client";

import { IconInfoCircle } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import {
	CLOCK_FOCUS_TARGET_ID,
	parseTimeTrackingFocus,
	periodSubmissionBlockerKey,
	type TimeTrackingFocus,
	workPeriodFocusTargetId,
} from "@/lib/time-tracking/period-submissions/blocker-navigation";
import {
	type PeriodReadinessScope,
	usePeriodSubmissionReadiness,
} from "./use-period-submission-readiness";

interface Props extends PeriodReadinessScope {
	/** The `focus` query parameter of `/time-tracking`. */
	focus: string | undefined;
	/** How long to wait for the target to stream in once readiness is known. */
	waitForTargetMs?: number;
}

/**
 * Focuses the work a period blocker link opened on `/time-tracking` (#1349): pending manual work's
 * timeline row, or the clock controls for live work. Navigating never clocks out or acts on the
 * work; it only moves focus.
 *
 * Readiness is checked again on arrival. When that check no longer lists the blocker (decided,
 * withdrawn, ended, or never the employee's), or its target is not on the page (another day, a
 * region that failed), a neutral notice says so instead. The link's identity only selects among
 * what the page already rendered for the signed-in employee.
 */
export function PeriodBlockerFocus({ focus, ...props }: Props) {
	const target = parseTimeTrackingFocus(focus);
	if (!target) return null;
	// Each new focus is a new arrival: remount to check readiness again.
	return <BlockerFocusArrival key={target.key} target={target} {...props} />;
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
	const noticeRef = useRef<HTMLDivElement>(null);

	// Settled: the check started on arrival has answered (after its retry, when it failed).
	const settled = readiness.isFetchedAfterMount && !readiness.isFetching;
	const stillBlocks = readiness.isError
		? null
		: (readiness.data?.periods.some((period) =>
				period.readiness.blockers.some(
					(blocker) => periodSubmissionBlockerKey(blocker) === target.key,
				),
			) ?? false);

	const targetId =
		target.kind === "live_work"
			? CLOCK_FOCUS_TARGET_ID
			: workPeriodFocusTargetId(target.workPeriodId);

	useEffect(() => {
		if (!settled || outcome !== null) return;
		if (stillBlocks === false) {
			setOutcome("resolved");
			return;
		}
		return whenElementAppears(targetId, waitForTargetMs, (element) => {
			if (!element) {
				setOutcome("not_shown");
				return;
			}
			element.scrollIntoView?.({ block: "center" });
			element.focus({ preventScroll: true });
			setOutcome("focused");
		});
	}, [settled, outcome, stillBlocks, targetId, waitForTargetMs]);

	useEffect(() => {
		if (outcome === "resolved" || outcome === "not_shown") noticeRef.current?.focus();
	}, [outcome]);

	if (outcome !== "resolved" && outcome !== "not_shown") return null;
	return (
		<div className="px-4 lg:px-6">
			<div
				ref={noticeRef}
				role="status"
				tabIndex={-1}
				className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
			>
				<IconInfoCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
				<span>
					{outcome === "resolved"
						? t(
								"timeTracking.periodSubmissions.focus.resolved",
								"This work no longer keeps a period open. Period readiness was checked again.",
							)
						: t(
								"timeTracking.periodSubmissions.focus.notShown",
								"This work can't be shown here. Period readiness was checked again.",
							)}
				</span>
			</div>
		</div>
	);
}

/** Calls back with the element once it is in the document, or with null after `timeoutMs`. */
function whenElementAppears(
	id: string,
	timeoutMs: number,
	callback: (element: HTMLElement | null) => void,
): () => void {
	const existing = document.getElementById(id);
	if (existing) {
		callback(existing);
		return () => {};
	}
	const observer = new MutationObserver(() => {
		const element = document.getElementById(id);
		if (!element) return;
		stop();
		callback(element);
	});
	const timer = window.setTimeout(() => {
		stop();
		callback(null);
	}, timeoutMs);
	function stop() {
		observer.disconnect();
		window.clearTimeout(timer);
	}
	observer.observe(document.body, { childList: true, subtree: true });
	return stop;
}
