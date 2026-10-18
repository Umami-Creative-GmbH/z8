export interface TimeTrackingPageSearchParams {
	date?: string;
	/** The work a period blocker link focuses (#1349); see `parseTimeTrackingFocus`. */
	focus?: string | string[];
}
