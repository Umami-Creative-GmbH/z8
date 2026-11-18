"use client";

import type { ReactNode } from "react";
import {
	type PlatformReadIdentity,
	usePlatformReadStatus,
} from "@/components/platform-admin/use-platform-read-status";
import { LoadingRegion } from "@/components/ui/loading-region";
import { AnalyticsReadFailure } from "./analytics-read-failure";

export function AnalyticsSnapshot({
	children,
	...identity
}: PlatformReadIdentity & { children: ReactNode }) {
	const status = usePlatformReadStatus(identity);
	if (status === "available") return children;
	if (status === "retired") return <AnalyticsReadFailure />;
	return (
		<LoadingRegion
			label={{
				labelKey: "common.loadingRegions.platformAnalytics",
				labelDefault: "Loading platform analytics",
			}}
		/>
	);
}
