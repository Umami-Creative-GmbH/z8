import { Suspense } from "react";
import { AnalyticsHealthSections, AnalyticsHealthSkeleton } from "./analytics-health-sections";
import { AnalyticsOverviewBottlenecks } from "./analytics-overview-bottlenecks";

export default function AnalyticsOverviewPage() {
	return (
		<div className="min-w-0 space-y-8">
			<Suspense fallback={<AnalyticsHealthSkeleton />}>
				<AnalyticsHealthSections />
			</Suspense>
			<AnalyticsOverviewBottlenecks />
		</div>
	);
}
