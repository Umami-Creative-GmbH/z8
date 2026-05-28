"use client";

import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { getPlatformAnalyticsBucketOptions } from "@/lib/platform-analytics/range";
import type {
	PlatformAnalyticsBucket,
	PlatformAnalyticsRange,
} from "@/lib/platform-analytics/types";
import { useRouter } from "@/navigation";

const RANGE_LABELS: Record<PlatformAnalyticsRange, string> = {
	"7d": "Last 7 days",
	"30d": "Last 30 days",
	"90d": "Last 90 days",
	"12m": "Last 12 months",
};

const BUCKET_LABELS: Record<PlatformAnalyticsBucket, string> = {
	day: "Daily",
	week: "Weekly",
	month: "Monthly",
};

const RANGE_OPTIONS = Object.keys(RANGE_LABELS) as PlatformAnalyticsRange[];

export function PlatformAnalyticsControls({
	range,
	bucket,
}: {
	range: PlatformAnalyticsRange;
	bucket: PlatformAnalyticsBucket;
}) {
	return (
		<Suspense fallback={null}>
			<PlatformAnalyticsControlsContent range={range} bucket={bucket} />
		</Suspense>
	);
}

function PlatformAnalyticsControlsContent({
	range,
	bucket,
}: {
	range: PlatformAnalyticsRange;
	bucket: PlatformAnalyticsBucket;
}) {
	const { t } = useTranslate();
	const { push } = useRouter();
	const searchParams = useSearchParams();
	const bucketOptions = getPlatformAnalyticsBucketOptions(range);

	function pushParams(nextRange: PlatformAnalyticsRange, nextBucket: PlatformAnalyticsBucket) {
		const params = new URLSearchParams(searchParams.toString());
		params.set("range", nextRange);
		params.set("bucket", nextBucket);
		push(`/platform-admin/analytics?${params.toString()}`);
	}

	function handleRangeChange(value: string) {
		const nextRange = value as PlatformAnalyticsRange;
		const nextBucketOptions = getPlatformAnalyticsBucketOptions(nextRange);
		const nextBucket = nextBucketOptions.includes(bucket) ? bucket : nextBucketOptions[0];

		pushParams(nextRange, nextBucket);
	}

	function handleBucketChange(value: string) {
		pushParams(range, value as PlatformAnalyticsBucket);
	}

	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
			<div className="grid gap-1.5">
				<label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
					{t("admin:admin.analytics.controls.range.label", "Range")}
				</label>
				<Select value={range} onValueChange={handleRangeChange}>
					<SelectTrigger
						className="w-full sm:w-[180px]"
						aria-label={t("admin:admin.analytics.controls.range.ariaLabel", "Analytics range")}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{RANGE_OPTIONS.map((option) => (
							<SelectItem key={option} value={option}>
								{t(`admin:admin.analytics.controls.range.${option}`, RANGE_LABELS[option])}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="grid gap-1.5">
				<label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
					{t("admin:admin.analytics.controls.bucket.label", "Bucket")}
				</label>
				<Select value={bucket} onValueChange={handleBucketChange}>
					<SelectTrigger
						className="w-full sm:w-[160px]"
						aria-label={t("admin:admin.analytics.controls.bucket.ariaLabel", "Analytics bucket")}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{bucketOptions.map((option) => (
							<SelectItem key={option} value={option}>
								{t(`admin:admin.analytics.controls.bucket.${option}`, BUCKET_LABELS[option])}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}
