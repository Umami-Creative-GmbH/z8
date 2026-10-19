/** The window event that says a period blocker link was just followed. */
export const PERIOD_BLOCKER_ARRIVAL_EVENT = "period-blocker-arrival";

/**
 * Says that a period blocker link with this focus value (`periodSubmissionBlockerKey`) was just
 * followed. Following a link to the page already shown changes no URL, so the focus on
 * `/time-tracking` would not otherwise notice it arrived again.
 */
export function announcePeriodBlockerArrival(key: string): void {
	window.dispatchEvent(new CustomEvent<string>(PERIOD_BLOCKER_ARRIVAL_EVENT, { detail: key }));
}
