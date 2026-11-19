"use client";

import { PlatformAnalyticsHeading } from "./analytics-heading";
import { AnalyticsReadFailure } from "./analytics-read-failure";

export default function AnalyticsError({ reset }: { reset: () => void }) {
	return (
		<div className="min-w-0 space-y-6">
			<PlatformAnalyticsHeading />
			<AnalyticsReadFailure retry={reset} />
		</div>
	);
}
