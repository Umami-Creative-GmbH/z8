import { Suspense } from "react";
import type { TimeTrackingPageSearchParams } from "./page-data";
import {
	ClockLoading,
	HistoryLoading,
	SummaryLoading,
	TimelineLoading,
} from "./region-fallbacks";
import { TimeTrackingPageContent } from "./regions";

interface TimeTrackingPageProps {
	searchParams: Promise<TimeTrackingPageSearchParams>;
}

function TimeTrackingPageLoading() {
	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<ClockLoading />
			<TimelineLoading />
			<SummaryLoading />
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
