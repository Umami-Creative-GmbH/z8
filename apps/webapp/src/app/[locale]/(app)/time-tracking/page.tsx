import { Suspense } from "react";
import type { TimeTrackingPageSearchParams } from "./page-data";
import {
	ClockLoading,
	HistoryLoading,
	SummaryLoading,
	TimelineLoading,
} from "./region-fallbacks";
import { TimeTrackingPageContent } from "./regions";

export const instant = true;

interface TimeTrackingPageProps {
	searchParams: Promise<TimeTrackingPageSearchParams>;
}

function TimeTrackingPageLoading() {
	return (
		<div data-testid="time-tracking-shell" className="@container/main page-frame flex flex-1 flex-col gap-6">
			<ClockLoading />
			<SummaryLoading />
			<TimelineLoading />
			<HistoryLoading />
		</div>
	);
}

export default function TimeTrackingPage(props: TimeTrackingPageProps) {
	return (
		<Suspense fallback={<TimeTrackingPageLoading />}>
			<TimeTrackingPageContent {...props} />
		</Suspense>
	);
}
